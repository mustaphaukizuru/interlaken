"""
portal/services.py — the single place notifications are created & sent.

Both cafeteria (purchase / low-balance alerts) and bookings (visit confirmations)
route through here. In dev, ``EMAIL_BACKEND`` is the console backend, so emails
print to stdout; in prod it's cPanel SMTP (see DEPLOYMENT.md §2/§4).

WhatsApp is a placeholder wired for Prompt 14 — passing ``whatsapp=True`` today
just logs an intent; no message is sent.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

logger = logging.getLogger(__name__)


def send_email(subject: str, message: str, recipients, *, fail_silently: bool = True) -> bool:
    """Send a plain-text email from ``DEFAULT_FROM_EMAIL``.

    Best-effort by default: mail failures are logged, never raised, so a broken
    SMTP config can't block the action that triggered the notification. Returns
    ``True`` when at least one recipient was accepted.
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
            fail_silently=fail_silently,
        )
        return bool(sent)
    except Exception as e:  # pragma: no cover - only hit when fail_silently=False
        logger.error(f'Email send failed ({subject!r} → {recipients}): {e}')
        if not fail_silently:
            raise
        return False


def notify(user, notif_type, title, message, *, email: bool = True, whatsapp: bool = False):
    """Create an in-app ``Notification`` for ``user`` and optionally email them.

    Args:
        user: the recipient ``accounts.User`` (in-app notifications need one).
        notif_type: a ``Notification.NotifType`` value (e.g. ``'cafeteria'``).
        title / message: notification contents (Spanish UI copy).
        email: also send an email to ``user.email`` (best-effort).
        whatsapp: placeholder — logs intent only until Prompt 14 wires WhatsApp.

    Returns the created ``Notification`` (or ``None`` if ``user`` is falsy).
    """
    from apps.portal.models import Notification

    if user is None:
        return None

    # Per-user notify() delivers email + push inline below, so stamp it dispatched
    # immediately — the dispatch_notifications cron only picks up bulk fan-out rows.
    notification = Notification.objects.create(
        user=user,
        notif_type=notif_type,
        title=title,
        message=message,
        delivered_at=timezone.now(),
    )

    if email and getattr(user, 'email', ''):
        send_email(subject=title, message=message, recipients=[user.email])

    # Web push: fail-soft, inert without VAPID keys or subscriptions.
    from apps.portal.push import send_web_push
    send_web_push(user, title, message)

    if whatsapp:
        # Prompt 14 wires the WhatsApp Business API. For now, record the intent.
        logger.info(f'WhatsApp notification requested for {user} (not yet enabled): {title}')

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


def fanout_announcement(announcement) -> int:
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
    Notification.objects.bulk_create(
        [Notification(user_id=uid, notif_type=Notification.NotifType.INFO,
                      title=announcement.title, message=message)
         for uid in user_ids],
        batch_size=500,
    )
    return len(user_ids)


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
