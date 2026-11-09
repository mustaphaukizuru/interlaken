"""
portal/services.py — the single place notifications are created & sent.

Both cafeteria (purchase / low-balance alerts) and bookings (visit confirmations)
route through here. In dev, ``EMAIL_BACKEND`` is the console backend, so emails
print to stdout; in prod it's SMTP configured in deploy/.env (see DEPLOY_HOSTINGER_VPS.md).

WhatsApp: when ``whatsapp=True`` and the user has a ``whatsapp`` number, we call
``apps.whatsapp.services.send_text`` (fail-soft). If Cloud API creds are unset,
``send_text`` logs a no-op — same degradation as booking confirmations.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


def render_email_html(subject: str, message: str, *, cta_url: str = '', cta_label: str = '',
                      content=None, reply_to: str = '') -> str:
    """The branded HTML part (design system in ``portal/emailing.py``).

    Pass ``content`` (an ``EmailContent``) for a structured email; plain
    ``message`` text still renders in the same design (paragraphs on blank
    lines). The text is autoescaped, so callers never hand-roll markup. A
    rendering failure must never block the send: it returns ''.
    """
    from .emailing import content_from_text, render_html

    if content is None:
        content = content_from_text(subject, message, cta_url=cta_url, cta_label=cta_label)
    return render_html(subject, content, reply_to=reply_to)


def build_email(subject: str, message: str, recipients, *, reply_to: str | None = None,
                cta_url: str = '', cta_label: str = '', html: bool = True, content=None,
                text_from_content: bool = True):
    """The ``EmailMultiAlternatives`` ``send_email`` sends (callers that attach files use it directly).

    With ``content`` the plain-text part is rendered from it too, so both parts
    say the same thing in the same order; ``text_from_content=False`` keeps
    ``message`` as the text part (wording the school edits itself).
    """
    from django.core.mail import EmailMultiAlternatives

    from .emailing import render_text

    reply = reply_to or getattr(settings, 'CONTACT_EMAIL', '') or ''
    body = render_text(content, reply_to=reply) if content is not None and text_from_content else message
    msg = EmailMultiAlternatives(
        subject=f'{getattr(settings, "EMAIL_SUBJECT_PREFIX", "")}{subject}',
        body=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=recipients,
        reply_to=[reply] if reply else None,
    )
    if html:
        rendered = render_email_html(subject, message, cta_url=cta_url, cta_label=cta_label,
                                     content=content, reply_to=reply)
        if rendered:
            msg.attach_alternative(rendered, 'text/html')
    return msg


def send_email(subject: str, message: str, recipients, *, fail_silently: bool = True,
               reply_to: str | None = None, cta_url: str = '', cta_label: str = '',
               html: bool = True, content=None, text_from_content: bool = True) -> bool:
    """Send an email (plain text + branded HTML) from ``DEFAULT_FROM_EMAIL``.

    Best-effort by default: mail failures are **logged**, never raised, so a
    broken SMTP config can't block the action that triggered the notification.
    Returns ``True`` when at least one recipient was accepted.

    ``reply_to`` defaults to ``CONTACT_EMAIL`` so a family that hits "reply"
    reaches a monitored mailbox, never noreply@ (BACKLOG P1-C1). ``content``
    (an ``emailing.EmailContent``) gives the email its structure; without it
    ``message`` is rendered as paragraphs in the same design.
    """
    if isinstance(recipients, str):
        recipients = [recipients]
    recipients = [r for r in (recipients or []) if r]
    if not recipients:
        return False

    try:
        msg = build_email(subject, message, recipients, reply_to=reply_to, cta_url=cta_url,
                          cta_label=cta_label, html=html, content=content,
                          text_from_content=text_from_content)
        sent = msg.send(fail_silently=False)
        if not sent:
            logger.error('Email send returned 0 (%r → %s)', subject, recipients)
        return bool(sent)
    except Exception as e:
        logger.error('Email send failed (%r → %s): %s', subject, recipients, e)
        if not fail_silently:
            raise
        return False


def notify(user, notif_type, title, message, *, email: bool = True, whatsapp: bool = False,
           fanout: bool = True, details=None, highlight=None, tone: str | None = None,
           url: str | None = None, cta_label: str | None = None, intro: str | None = None):
    """Create an in-app ``Notification`` for ``user`` and optionally email them.

    Respects ``NotificationPreference`` toggles when present (defaults = all on);
    urgent warnings go out on every channel (``NotificationPreference.wants``).
    ``fanout`` (default) also delivers a student's email/push to every linked
    guardian who keeps that channel on; pass ``fanout=False`` when the caller
    already iterates the family (``family_notify_recipients``) so nobody is
    notified twice: a student's copy then leaves out the addresses a guardian's
    own copy reaches (``own_copy_mailboxes``).

    The email carries the same title and text, plus what only email shows:
    ``details`` (label/value rows), ``highlight`` (one big figure), the button
    to ``url`` (default: the portal page for ``notif_type``), ``tone`` and an
    email-only ``intro`` (a human sentence when the card already has the figures).
    """
    from apps.accounts.models import NotificationPreference
    from apps.portal.models import Notification

    if user is None:
        return None

    prefs = NotificationPreference.for_user(user)
    if not prefs.allows(notif_type):
        logger.info('Notification muted by category for %s: %s', user, title)
        return None
    want_in_app = prefs.wants('in_app', notif_type)
    want_email = email and prefs.wants('email', notif_type)
    want_push = prefs.wants('push', notif_type)

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

    # A student's notification must reach the student's real mailbox (if any)
    # AND every linked guardian; synthetic importer addresses are skipped. Each
    # guardian gets it on the channels they keep on (their own Avisos tab).
    from apps.accounts.recipients import delivery_users, mailboxes_of, own_copy_mailboxes, wants

    cache = {user.pk: prefs}
    guardians = [t for t in delivery_users(user) if t.pk != user.pk] if fanout else []
    if fanout:
        recipients = mailboxes_of(([user] if want_email else []) + [
            g for g in guardians if email and wants(g, 'email', notif_type, cache)])
    else:
        # The caller notifies every family member: this copy leaves out the
        # addresses a guardian's own copy already reaches (one email each).
        recipients = own_copy_mailboxes(user, notif_type, cache=cache) if want_email else []
    push_to = ([user] if want_push else []) + [
        g for g in guardians if wants(g, 'push', notif_type, cache)]
    email_status = Notification.Delivery.SKIPPED
    if recipients:
        from .emailing import notification_content
        content = notification_content(user=user, notif_type=notif_type, title=title, message=message,
                                       details=details, highlight=highlight, tone=tone, url=url,
                                       cta_label=cta_label, intro=intro)
        ok = send_email(subject=title, message=message, recipients=recipients, content=content)
        email_status = Notification.Delivery.SENT if ok else Notification.Delivery.FAILED

    push_status = Notification.Delivery.SKIPPED
    if push_to:
        from apps.portal.push import send_web_push
        delivered = 0
        for target in push_to:
            delivered += send_web_push(target, title, message)
        push_status = Notification.Delivery.SENT if delivered else Notification.Delivery.SKIPPED

    if notification is not None:
        notification.email_status = email_status
        notification.push_status = push_status
        notification.attempts = 1
        notification.save(update_fields=['email_status', 'push_status', 'attempts'])

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
                      title=announcement.title, message=message,
                      announcement=announcement)
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


# Rows of one notice queued for each family member together (the bulk top-up's
# late notices) share type, title and text and are created within moments.
SAME_NOTICE_WINDOW = timedelta(minutes=10)


def _has_own_copy(user, n) -> bool:
    """True when ``user`` holds a row of the same notice as ``n``: the same
    comunicado, or the same queued notice (type, title and text, created
    within ``SAME_NOTICE_WINDOW``)."""
    from apps.portal.models import Notification

    rows = Notification.objects.filter(user=user).exclude(pk=n.pk)
    if n.announcement_id:
        return rows.filter(announcement_id=n.announcement_id).exists()
    return rows.filter(
        announcement__isnull=True, notif_type=n.notif_type, title=n.title, message=n.message,
        created_at__gte=n.created_at - SAME_NOTICE_WINDOW,
        created_at__lte=n.created_at + SAME_NOTICE_WINDOW,
    ).exists()


def dispatch_pending_notifications(limit: int = 500, max_age_days: int = 7) -> int:
    """Deliver email + web-push for notifications not yet dispatched.

    Bulk fan-out (``fanout_announcement``) creates in-app rows with
    ``delivered_at=NULL``; this batched, capped pass (run from the
    ``dispatch_notifications`` cron) sends the out-of-band channels so a
    school-wide comunicado actually reaches inboxes without blocking the publish
    request. Every target is emailed / pushed only on the channels its own
    preferences keep on (urgent warnings always), and one notice reaches each
    address once (``_has_own_copy``, ``own_copy_reach``). Rows older than
    ``max_age_days`` are marked delivered *without* sending, so a cron that was
    down for a while can't fire a surprise blast of stale announcements.
    Returns the number actually sent.
    """
    from apps.portal.models import Notification
    from apps.portal.push import send_web_push

    now = timezone.now()
    cutoff = now - timedelta(days=max_age_days)
    pending = list(
        Notification.objects.filter(delivered_at__isnull=True)
        .select_related('user', 'announcement').order_by('created_at')[:limit])
    if not pending:
        return 0

    from apps.accounts.recipients import delivery_users, mailboxes_of, own_copy_reach, wants

    max_attempts = getattr(settings, 'NOTIFICATION_MAX_ATTEMPTS', 3)
    prefs = {}  # user pk → NotificationPreference, read once per pass
    sent, handled_ids, retry_ids, failures = 0, [], [], []
    for n in pending:
        if n.created_at < cutoff:
            handled_ids.append(n.id)
            Notification.objects.filter(pk=n.pk).update(
                email_status=Notification.Delivery.SKIPPED, push_status=Notification.Delivery.SKIPPED,
                last_error='Caducó sin enviarse')
            continue  # too old — mark delivered below, don't send
        ann = n.announcement
        kind = n.notif_type
        # Student rows also reach the guardians, unless a guardian holds their
        # own row of the same notice (the comunicado fan-out, the bulk top-up
        # queue): that row carries their copy, so this one neither goes to them
        # nor to an address their copy already reaches.
        family = delivery_users(n.user)
        own = [g for g in family if g.pk != n.user_id and _has_own_copy(g, n)]
        targets = [t for t in family if t not in own]
        covered = own_copy_reach(own, kind, cache=prefs)
        # Each target on the channels it keeps on (its own Avisos tab), so the
        # footer's «tiene activados los avisos por correo» is true; urgent
        # warnings reach everyone (NotificationPreference.wants).
        emails = [addr for addr in mailboxes_of([t for t in targets if wants(t, 'email', kind, prefs)])
                  if addr.lower() not in covered]
        email_status = Notification.Delivery.SKIPPED
        if emails:
            from .emailing import notification_content
            content = notification_content(user=n.user, notif_type=n.notif_type, title=n.title, message=n.message,
                                           comunicado=ann is not None,
                                           url=f'/portal/notificaciones/{n.pk}' if ann else None)
            ok = send_email(subject=n.title, message=n.message, recipients=emails, content=content)
            email_status = Notification.Delivery.SENT if ok else Notification.Delivery.FAILED
        # Comunicado rows deep-link the push to the announcement and honor its
        # 'Enviar notificación push' toggle; standalone rows keep /portal.
        push_status = Notification.Delivery.SKIPPED
        if ann is None or ann.push_enabled:
            # Bitácora 10: the family portal no longer has a comunicados page; the push opens the
            # notification itself, which carries the full text.
            url = f'/portal/notificaciones/{n.pk}' if ann else '/portal'
            delivered = 0
            for target in targets:
                if wants(target, 'push', kind, prefs):
                    delivered += send_web_push(target, n.title, n.message, url=url)
            push_status = Notification.Delivery.SENT if delivered else Notification.Delivery.SKIPPED

        attempts = n.attempts + 1
        failed = email_status == Notification.Delivery.FAILED
        if failed and attempts < max_attempts:
            # Leave delivered_at NULL so the next cron run retries the email.
            retry_ids.append(n.id)
            Notification.objects.filter(pk=n.pk).update(
                attempts=attempts, email_status=email_status, push_status=push_status,
                last_error=f'Intento {attempts} falló')
            continue
        handled_ids.append(n.id)
        Notification.objects.filter(pk=n.pk).update(
            attempts=attempts, email_status=email_status, push_status=push_status,
            last_error=f'Correo no entregado tras {attempts} intentos' if failed else '')
        if failed:
            failures.append(n)
        else:
            sent += 1

    Notification.objects.filter(id__in=handled_ids).update(delivered_at=now)
    if failures:
        _alert_ops_on_failures(failures)
    return sent


def _alert_ops_on_failures(failures) -> None:
    """One email to OPS_EMAIL per dispatch batch listing exhausted failures (P1-C5)."""
    ops = getattr(settings, 'OPS_EMAIL', '')
    if not ops:
        return
    lines = [f'- #{n.id} {n.title} → {n.user.email} ({n.last_error})' for n in failures[:50]]
    more = '' if len(failures) <= 50 else f'\n… y {len(failures) - 50} más'
    send_email(
        f'[Interlaken] {len(failures)} notificación(es) no entregada(s)',
        'El despachador agotó los reintentos de correo para:\n\n' + '\n'.join(lines) + more
        + '\n\nRevise la configuración SMTP y la bandeja de Auditoría.',
        [ops], html=False,
    )
    try:
        from apps.core.audit import record
        record('update', failures[0], {'undelivered': len(failures), 'ids': [n.id for n in failures[:50]]},
               actor_label='dispatch_notifications', context='notifications.delivery_failed')
    except Exception:  # pragma: no cover
        logger.warning('Audit write for delivery failures failed', exc_info=True)
