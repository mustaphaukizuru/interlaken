"""
portal/services.py — the single place notifications are created & sent.

Both cafeteria (purchase / low-balance alerts) and bookings (visit confirmations)
route through here. In dev, ``EMAIL_BACKEND`` is the console backend, so emails
print to stdout; in prod it's cPanel SMTP (see DEPLOYMENT.md §2/§4).

WhatsApp: when ``whatsapp=True`` and the user has a ``whatsapp`` number, we call
``apps.whatsapp.services.send_text`` (fail-soft). If Cloud API creds are unset,
``send_text`` logs a no-op — same degradation as booking confirmations.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

logger = logging.getLogger(__name__)


def send_email(subject: str, message: str, recipients, *, fail_silently: bool = True) -> bool:
    """Send a plain-text email from ``DEFAULT_FROM_EMAIL``.

    Best-effort by default: mail failures are **logged**, never raised, so a
    broken SMTP config can't block the action that triggered the notification.
    Returns ``True`` when at least one recipient was accepted.

    Internally always calls Django with ``fail_silently=False`` so exceptions
    surface into this helper (Django's own fail_silently=True would swallow
    without a log line).
    """
    if isinstance(recipients, str):
        recipients = [recipients]
    recipients = [r for r in (recipients or []) if r]
    if not recipients:
        return False

    try:
        sent = send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=recipients,
            fail_silently=False,
        )
        if not sent:
            logger.error('Email send returned 0 (%r → %s)', subject, recipients)
        return bool(sent)
    except Exception as e:
        logger.error('Email send failed (%r → %s): %s', subject, recipients, e)
        if not fail_silently:
            raise
        return False


def notify(user, notif_type, title, message, *, email: bool = True, whatsapp: bool = False):
    """Create an in-app ``Notification`` for ``user`` and optionally email them.

    Respects ``NotificationPreference`` toggles when present (defaults = all on).
    """
    from apps.accounts.models import NotificationPreference
    from apps.portal.models import Notification

    if user is None:
        return None

    prefs = NotificationPreference.for_user(user)
    want_in_app = prefs.in_app_enabled
    want_email = email and prefs.email_enabled
    want_push = prefs.push_enabled

    notification = None
    if want_in_app:
        # Per-user notify() delivers email + push inline below, so stamp it dispatched
        # immediately — the dispatch_notifications cron only picks up bulk fan-out rows.
        notification = Notification.objects.create(
            user=user,
            notif_type=notif_type,
            title=title,
            message=message,
            delivered_at=timezone.now(),
        )

    if want_email and getattr(user, 'email', ''):
        send_email(subject=title, message=message, recipients=[user.email])

    if want_push:
        from apps.portal.push import send_web_push
        send_web_push(user, title, message)

    if whatsapp:
        wa = (getattr(user, 'whatsapp', '') or '').strip()
        if not wa:
            logger.info('WhatsApp notification skipped (no number) for %s: %s', user, title)
        else:
            try:
                from apps.whatsapp.services import send_text
                send_text(wa, f'{title}\n\n{message}')
            except Exception as e:  # pragma: no cover — send_text is already fail-soft
                logger.warning('WhatsApp notify failed for %s: %s', user, e)

    return notification


# Audience value → the roles it targets (inverse of audiences_for_user).
_AUDIENCE_ROLES = None


def _audience_roles():
    global _AUDIENCE_ROLES
    if _AUDIENCE_ROLES is None:
        from apps.accounts.models import User
        from apps.portal.models import Announcement
        # Families are a merged parent/student account, so PARENTS- and
        # STUDENTS-targeted comunicados both fan out to every family login
        # (either role) — mirroring audiences_for_user on the read side.
        _AUDIENCE_ROLES = {
            Announcement.Audience.ALL:      [User.Role.PARENT, User.Role.STUDENT, User.Role.STAFF],
            Announcement.Audience.PARENTS:  [User.Role.PARENT, User.Role.STUDENT],
            Announcement.Audience.STUDENTS: [User.Role.PARENT, User.Role.STUDENT],
            Announcement.Audience.STAFF:    [User.Role.STAFF],
        }
    return _AUDIENCE_ROLES


def fanout_announcement(announcement, *, notif_type=None) -> int:
    """Create an in-app ``Notification`` for every active user in the
    announcement's audience, so a newly published comunicado actually alerts the
    people it targets (they could already *find* it in the announcements list,
    but nothing notified them).

    Deliberately in-app only and bulk (one INSERT, fast): a school-wide email +
    web-push blast to thousands of parents can't run inline on this queue-less
    (no Celery) host without timing out the request — that belongs in a batched
    cron over unsent notifications. Fail-soft is the caller's job. Returns the
    number of notifications created.
    """
    from django.utils.text import Truncator

    from apps.accounts.models import User
    from apps.portal.models import Notification

    if not getattr(announcement, 'is_active', False):
        return 0
    roles = _audience_roles().get(announcement.audience, [])
    if not roles:
        return 0

    user_ids = list(
        User.objects.filter(is_active=True, role__in=roles)
        .values_list('id', flat=True))
    if not user_ids:
        return 0

    message = Truncator(announcement.body or '').chars(280)
    kind = notif_type or Notification.NotifType.INFO
    Notification.objects.bulk_create(
        [Notification(user_id=uid, notif_type=kind,
                      title=announcement.title, message=message)
         for uid in user_ids],
        batch_size=500,
    )
    return len(user_ids)


def fanout_and_stamp(
    announcement,
    *,
    notif_type=None,
    dispatch_limit: int = 200,
) -> dict:
    """In-app fan-out + stamp ``fanout_at`` + first email/push batch.

    Shared by comunicado publish/activate and emergency broadcast so cron lag
    does not leave families waiting for the next ``dispatch_notifications`` run.
    Fail-soft for dispatch: channel errors are logged, never raised.
    Returns ``{notified, dispatched}``.
    """
    notified = fanout_announcement(announcement, notif_type=notif_type)
    from apps.portal.models import Announcement
    Announcement.objects.filter(pk=announcement.pk).update(
        fanout_at=timezone.now())
    dispatched = 0
    if notified and dispatch_limit > 0:
        try:
            dispatched = dispatch_pending_notifications(limit=dispatch_limit)
        except Exception:  # pragma: no cover — channel failures must not 500
            logger.exception(
                'Announcement %s first-batch dispatch failed', announcement.pk)
    return {'notified': notified, 'dispatched': dispatched}


def emergency_broadcast(
    *,
    title: str,
    message: str,
    audience: str,
    created_by=None,
    dispatch_limit: int = 200,
    whatsapp: bool = False,
    whatsapp_limit: int = 100,
) -> dict:
    """School-wide urgent alert (Phase D4).

    1. Persists an active ``Announcement`` so the aviso stays in Comunicados.
    2. Bulk-creates WARNING in-app notifications (``delivered_at=NULL``).
    3. Immediately dispatches up to ``dispatch_limit`` email+push sends; the
       ``dispatch_notifications`` cron finishes the rest.
    4. Optionally WhatsApp-blasts users who have a number (capped, fail-soft).

    Returns counts for the admin UI. Never raises into the view for channel
    failures — only validation errors should surface as 400s.
    """
    from django.utils.text import Truncator

    from apps.accounts.models import User
    from apps.portal.models import Announcement, Notification

    title = (title or '').strip()
    message = (message or '').strip()
    if not title or not message:
        raise ValueError('Título y mensaje son obligatorios.')
    if audience not in {c.value for c in Announcement.Audience}:
        raise ValueError('Audiencia no válida.')

    announcement = Announcement.objects.create(
        title=title,
        body=message,
        audience=audience,
        is_active=True,
        created_by=created_by,
    )
    stats = fanout_and_stamp(
        announcement,
        notif_type=Notification.NotifType.WARNING,
        dispatch_limit=dispatch_limit,
    )
    notified = stats['notified']
    dispatched = stats['dispatched']

    whatsapp_sent = 0
    if whatsapp:
        roles = _audience_roles().get(audience, [])
        qs = (
            User.objects.filter(is_active=True, role__in=roles)
            .exclude(whatsapp='')
            .order_by('id')[:whatsapp_limit]
        )
        body = f'{title}\n\n{Truncator(message).chars(400)}'
        try:
            from apps.whatsapp.services import send_text
        except Exception:  # pragma: no cover
            send_text = None
            logger.exception('WhatsApp import failed during emergency broadcast')
        if send_text:
            for user in qs:
                wa = (user.whatsapp or '').strip()
                if not wa:
                    continue
                try:
                    if send_text(wa, body):
                        whatsapp_sent += 1
                except Exception:
                    logger.warning('Emergency WhatsApp failed for %s', user, exc_info=True)

    return {
        'announcement_id': announcement.id,
        'notified': notified,
        'dispatched': dispatched,
        'whatsapp_sent': whatsapp_sent,
    }


def dispatch_pending_notifications(limit: int = 500, max_age_days: int = 7) -> int:
    """Deliver email + web-push for notifications not yet dispatched.

    Bulk fan-out (``fanout_announcement``) creates in-app rows with
    ``delivered_at=NULL``; this batched, capped pass (run from the
    ``dispatch_notifications`` cron) sends the out-of-band channels so a
    school-wide comunicado actually reaches inboxes without blocking the publish
    request. Rows older than ``max_age_days`` are marked delivered *without*
    sending, so a cron that was down for a while can't fire a surprise blast of
    stale announcements. Returns the number actually sent.
    """
    from apps.portal.models import Notification
    from apps.portal.push import send_web_push

    now = timezone.now()
    cutoff = now - timedelta(days=max_age_days)
    pending = list(
        Notification.objects.filter(delivered_at__isnull=True)
        .select_related('user').order_by('created_at')[:limit])
    if not pending:
        return 0

    sent, handled_ids = 0, []
    for n in pending:
        handled_ids.append(n.id)
        if n.created_at < cutoff:
            continue  # too old — mark delivered below, don't send
        if getattr(n.user, 'email', ''):
            send_email(subject=n.title, message=n.message, recipients=[n.user.email])
        send_web_push(n.user, n.title, n.message)
        sent += 1

    Notification.objects.filter(id__in=handled_ids).update(delivered_at=now)
    return sent
