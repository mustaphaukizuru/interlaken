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
import time
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


def copy_to_family(student, notif_type, title, message) -> int:
    """In-app copy of a child's alert for the OTHER accounts of its Family.

    Families (hermanos, 2026-11-13) sign in with any child's login, so the bell
    of every family account shows every child's alerts. Bell only: the email,
    push and WhatsApp already went to the child's own recipients
    (``family_notify_recipients``), and each child's mailbox is read by the
    family, so a second email would only repeat it. Respects each account's
    category and in-app preferences like ``notify``. Returns the copies made.
    """
    from apps.accounts.family import family_alert_logins
    from apps.accounts.models import NotificationPreference
    from apps.portal.models import Notification

    logins = family_alert_logins(student)
    if not logins:
        return 0
    name = getattr(getattr(student, 'user', None), 'full_name', '') or ''
    first = getattr(getattr(student, 'user', None), 'first_name', '') or name
    if first and first not in message:
        message = f'{name}: {message}'
    skipped = Notification.Delivery.SKIPPED
    now = timezone.now()
    made = 0
    for user in logins:
        prefs = NotificationPreference.for_user(user)
        if not prefs.allows(notif_type) or not prefs.wants('in_app', notif_type):
            continue
        Notification.objects.create(
            user=user, notif_type=notif_type, title=title, message=message,
            email_status=skipped, push_status=skipped, delivered_at=now)
        made += 1
    return made


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


def audience_users(audience):
    """Active users a comunicado for ``audience`` reaches: ``_audience_roles``,
    with staff cafetería logins (2026-11-18) moved where they belong.

    A staff member who only has a cafetería account signs in with a
    ``role='student'`` login, so by role alone they would get the family
    comunicados (Padres / Alumnos). They are left out of those and join
    «Personal» instead; a parent who is also staff keeps the family ones and
    gets «Personal» too. «Todos» is unchanged. One queryset, used by the
    fan-out, the WhatsApp blast and the composer's recipient count, so the
    three can never disagree.
    """
    from django.db.models import Q

    from apps.accounts.models import User
    from apps.accounts.people import personal_user_ids, staff_only_login_q
    from apps.portal.models import Announcement

    roles = _audience_roles().get(audience, [])
    q = Q(role__in=roles)
    if audience in (Announcement.Audience.PARENTS, Announcement.Audience.STUDENTS):
        q &= ~staff_only_login_q()
    elif audience == Announcement.Audience.STAFF:
        q |= Q(role__in=[User.Role.PARENT, User.Role.STUDENT], pk__in=personal_user_ids())
    if not roles and audience != Announcement.Audience.STAFF:
        return User.objects.none()
    return User.objects.filter(q, is_active=True)


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

    from apps.portal.models import Notification

    if not getattr(announcement, 'is_active', False):
        return 0
    roles = _audience_roles().get(announcement.audience, [])
    if not roles:
        return 0

    audience = audience_users(announcement.audience)
    user_ids = list(audience.values_list('id', flat=True))
    if not user_ids:
        return 0

    message = Truncator(announcement.body or '').chars(280)
    kind = notif_type or Notification.NotifType.INFO
    # Accounts that turned in-app notices off, or muted this category, still
    # get their row (it carries the email and push they keep on), hidden from
    # the bell: never shown, created read. Urgent alerts are never muted.
    muted = in_app_muted_ids(audience, kind)
    Notification.objects.bulk_create(
        [Notification(user_id=uid, notif_type=kind,
                      title=announcement.title, message=message,
                      announcement=announcement,
                      in_app=uid not in muted, is_read=uid in muted)
         for uid in user_ids],
        batch_size=500,
    )
    return len(user_ids)


def in_app_muted_ids(users, notif_type) -> set[int]:
    """Ids of ``users`` (a queryset) whose preferences keep a ``notif_type``
    notice out of the app: ``NotificationPreference.wants('in_app', …)`` is
    False (channel off or category muted). Never an urgent type. One query;
    accounts that never saved preferences have everything on."""
    from django.db.models import Q

    from apps.accounts.models import NotificationPreference

    if notif_type in NotificationPreference.URGENT_TYPES:
        return set()
    muted = Q(in_app_enabled=False)
    field = NotificationPreference.CATEGORY_FIELD.get(notif_type)
    if field:
        muted |= Q(**{field: False})
    return set(NotificationPreference.objects.filter(muted, user__in=users.values('pk'))
               .values_list('user_id', flat=True))


# A publish request (comunicado or emergency broadcast) emails the first rows of
# its own comunicado itself: at most this many, for at most this many seconds,
# so a school-wide comunicado never keeps a sync gunicorn worker (60 s timeout)
# busy. The dispatch_notifications cron, every 5 minutes, sends the rest.
INLINE_DISPATCH_LIMIT = 20
INLINE_DISPATCH_SECONDS = 20


def fanout_and_stamp(
    announcement,
    *,
    notif_type=None,
    dispatch_limit: int = INLINE_DISPATCH_LIMIT,
) -> dict:
    """In-app fan-out + stamp ``fanout_at`` + a small first email/push batch.

    Shared by comunicado publish/activate and emergency broadcast: the first
    ``dispatch_limit`` rows of this comunicado go out at once (within
    ``INLINE_DISPATCH_SECONDS``), the ``dispatch_notifications`` cron sends the
    rest within 5 minutes. Fail-soft for dispatch: channel errors are logged,
    never raised. Returns ``{notified, dispatched}``.
    """
    notified = fanout_announcement(announcement, notif_type=notif_type)
    from apps.portal.models import Announcement
    Announcement.objects.filter(pk=announcement.pk).update(
        fanout_at=timezone.now())
    dispatched = 0
    if notified and dispatch_limit > 0:
        try:
            dispatched = dispatch_pending_notifications(
                limit=dispatch_limit, announcement=announcement,
                time_budget=INLINE_DISPATCH_SECONDS)
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
    dispatch_limit: int = INLINE_DISPATCH_LIMIT,
    whatsapp: bool = False,
    whatsapp_limit: int = 100,
) -> dict:
    """School-wide urgent alert (Phase D4).

    1. Persists an active ``Announcement`` so the aviso stays in Comunicados.
    2. Bulk-creates WARNING in-app notifications (``delivered_at=NULL``).
    3. Immediately dispatches a first batch of ``dispatch_limit`` email+push
       sends; the ``dispatch_notifications`` cron finishes the rest within 5
       minutes.
    4. Optionally records the WhatsApp blast (one pending row per number,
       capped) and sends it AFTER the response (``send_whatsapp_later``): a
       Cloud API call can take 10 s, so a blast inside the request could hit
       gunicorn's 60 s limit. The cron finishes what a killed thread left.

    Returns counts for the admin UI. Never raises into the view for channel
    failures — only validation errors should surface as 400s.
    """
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

    whatsapp_queued = 0
    whatsapp_ready = whatsapp_configured()
    if whatsapp and whatsapp_ready:
        try:
            whatsapp_queued = queue_whatsapp(announcement, limit=whatsapp_limit)
        except Exception:  # pragma: no cover - the in-app and email part already went out
            logger.exception('Announcement %s WhatsApp queue failed', announcement.pk)
        if whatsapp_queued:
            send_whatsapp_later(announcement.pk)
    elif whatsapp:
        logger.info('Emergency broadcast %s: WhatsApp requested but the Cloud API is not configured',
                    announcement.pk)

    return {
        'announcement_id': announcement.id,
        'notified': notified,
        'dispatched': dispatched,
        # Recorded now, sent after the response (progress: the delivery report).
        'whatsapp_queued': whatsapp_queued,
        'whatsapp_configured': whatsapp_ready,
    }


# ── WhatsApp blast (emergency broadcast) ──────────────────────────────────────
# A thread sends the blast after the response; it gives up after this long and
# the 5-minute cron finishes the rest (100 numbers x 10 s timeout = 17 min worst case).
WHATSAPP_THREAD_SECONDS = 15 * 60
# A WhatsApp row that failed this many times is closed as failed.
WHATSAPP_MAX_ATTEMPTS = 3
# An emergency message that waited this long (cron down) is no longer sent:
# «no habrá clases mañana» a day late would only confuse.
WHATSAPP_MAX_AGE = timedelta(hours=24)


def normalize_phone(raw: str) -> str:
    """Dedupe key of a phone number: its digits, the last 10 when longer
    (``+52 1 55 1234 5678``, ``5215512345678`` and ``55 1234 5678`` are one
    number). '' when it holds fewer than 8 digits (not a usable number)."""
    import re

    digits = re.sub(r'\D', '', raw or '')
    if len(digits) < 8:
        return ''
    return digits[-10:]


def whatsapp_configured() -> bool:
    """True when the WhatsApp Cloud API credentials are set (sends are real)."""
    return bool(getattr(settings, 'WHATSAPP_TOKEN', '') and getattr(settings, 'WHATSAPP_PHONE_ID', ''))


def queue_whatsapp(announcement, *, limit: int = 100) -> int:
    """Record one pending WhatsApp delivery per distinct number of the
    comunicado's audience (``audience_users``), oldest accounts first, at most
    ``limit`` numbers. Siblings' logins that share a number get ONE message.
    Idempotent: a number already recorded for this comunicado is not added
    twice. Returns the rows recorded."""
    from apps.portal.models import AnnouncementDelivery

    rows, seen = [], set()
    users = (audience_users(announcement.audience).exclude(whatsapp='')
             .order_by('id').values_list('id', 'whatsapp'))
    for user_id, number in users.iterator():
        key = normalize_phone(number)
        if not key or key in seen:
            continue
        seen.add(key)
        rows.append(AnnouncementDelivery(
            announcement=announcement, channel=AnnouncementDelivery.Channel.WHATSAPP,
            address=key, send_to=number.strip(), user_id=user_id))
        if len(rows) >= limit:
            break
    if not rows:
        return 0
    AnnouncementDelivery.objects.bulk_create(rows, ignore_conflicts=True)
    return AnnouncementDelivery.objects.filter(
        announcement=announcement, channel=AnnouncementDelivery.Channel.WHATSAPP).count()


def run_in_background(fn, *, name: str) -> None:
    """Run ``fn`` in a daemon thread that closes its own database connection.

    Only for work recorded as pending rows first: nothing here survives a
    worker restart, so the 5-minute cron must be able to finish it. Tests
    replace this with a synchronous call.
    """
    import threading

    from django.db import connections

    def target():
        try:
            fn()
        except Exception:  # noqa: BLE001 - logged; the cron finishes the rows
            logger.exception('Background task %s failed', name)
        finally:
            connections.close_all()

    threading.Thread(target=target, name=name, daemon=True).start()


def send_whatsapp_later(announcement_id: int) -> None:
    """Send this comunicado's pending WhatsApp rows after the response.

    Started once the request's transaction commits, so the thread sees the
    rows it has to send.
    """
    from django.db import transaction

    def start():
        run_in_background(
            lambda: dispatch_pending_whatsapp(announcement_id=announcement_id,
                                              time_budget=WHATSAPP_THREAD_SECONDS),
            name=f'whatsapp-broadcast-{announcement_id}')

    transaction.on_commit(start)


def _whatsapp_body(announcement) -> str:
    from django.utils.text import Truncator

    return f'{announcement.title}\n\n{Truncator(announcement.body or "").chars(400)}'


def dispatch_pending_whatsapp(*, limit: int = 500, announcement_id: int | None = None,
                              time_budget: float | None = None) -> int:
    """Send pending WhatsApp deliveries; returns the messages accepted.

    Each row is claimed on its own (``SELECT … FOR UPDATE SKIP LOCKED`` in a
    short transaction, the same pattern as ``dispatch_pending_notifications``)
    and stamped in that transaction: the after-response thread and the cron
    never send the same row, and a row whose sender died stays pending for the
    next cron run. A failed send is retried by the next runs, up to
    ``WHATSAPP_MAX_ATTEMPTS``; rows older than ``WHATSAPP_MAX_AGE`` are closed
    as skipped without sending. Without Cloud API credentials nothing is sent
    (the rows wait, then expire).
    """
    from django.db import transaction

    from apps.portal.models import AnnouncementDelivery, Notification

    Status = Notification.Delivery
    now = timezone.now()
    pending = AnnouncementDelivery.objects.filter(
        channel=AnnouncementDelivery.Channel.WHATSAPP, status=Status.PENDING)
    if announcement_id is not None:
        pending = pending.filter(announcement_id=announcement_id)
    pending.filter(created_at__lt=now - WHATSAPP_MAX_AGE).update(
        status=Status.SKIPPED, last_error='Caducó sin enviarse')
    if not whatsapp_configured():
        return 0
    ids = list(pending.order_by('created_at', 'pk').values_list('pk', flat=True)[:limit])
    if not ids:
        return 0

    from apps.portal.models import Announcement
    from apps.whatsapp.services import send_text

    bodies: dict[int, str] = {}  # announcement pk → message, read once per pass

    def body_of(announcement_id):
        if announcement_id not in bodies:
            bodies[announcement_id] = _whatsapp_body(
                Announcement.objects.only('title', 'body').get(pk=announcement_id))
        return bodies[announcement_id]

    started = time.monotonic()
    sent = 0
    for pk in ids:
        if time_budget is not None and time.monotonic() - started >= time_budget:
            break  # the rest waits for the next cron run
        try:
            with transaction.atomic():
                # Only this row is locked (no join): the comunicado itself stays
                # editable while its blast goes out.
                row = (AnnouncementDelivery.objects.select_for_update(skip_locked=True)
                       .filter(pk=pk, status=Status.PENDING).first())
                if row is None:
                    continue  # another sender has it, or already sent it
                try:
                    ok = bool(send_text(row.send_to, body_of(row.announcement_id)))
                    error = '' if ok else 'WhatsApp rechazó el envío'
                except Exception as exc:  # noqa: BLE001 - counts as a failed attempt
                    logger.warning('WhatsApp delivery %s raised', pk, exc_info=True)
                    ok, error = False, f'Error al enviar: {type(exc).__name__}'
                attempts = row.attempts + 1
                status = (Status.SENT if ok
                          else Status.FAILED if attempts >= WHATSAPP_MAX_ATTEMPTS else Status.PENDING)
                AnnouncementDelivery.objects.filter(pk=pk).update(
                    status=status, attempts=attempts, last_error=error[:200],
                    sent_at=timezone.now() if ok else None)
        except Exception:  # noqa: BLE001 - one bad row must not stop the others
            logger.exception('dispatch_pending_whatsapp: delivery %s raised', pk)
            continue
        sent += int(ok)
    return sent


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


# A row whose email failed is tried again only once it is this old (index =
# failed attempts so far; the last value repeats). With the cron every 5
# minutes, back-to-back retries would give up 10 minutes into an SMTP outage;
# until 2026-11-08 the daily cron spread them over days.
RETRY_AFTER = (timedelta(minutes=30), timedelta(hours=4))


def _due(now):
    """Pending rows ready for an attempt: never tried, or old enough for the next retry."""
    from django.db.models import Q

    if not RETRY_AFTER:
        return Q()
    due = Q(attempts=0)
    for made, wait in enumerate(RETRY_AFTER, start=1):
        tried = Q(attempts=made) if made < len(RETRY_AFTER) else Q(attempts__gte=made)
        due |= tried & Q(created_at__lte=now - wait)
    return due


def dispatch_pending_notifications(limit: int = 500, max_age_days: int = 7, *, announcement=None,
                                   time_budget: float | None = None) -> int:
    """Deliver email + web-push for notifications not yet dispatched.

    Bulk fan-out (``fanout_announcement``) creates in-app rows with
    ``delivered_at=NULL``; this batched, capped pass (run every 5 minutes by
    the ``dispatch_notifications`` cron, and for a first batch by the publish
    request) sends the out-of-band channels so a school-wide comunicado
    actually reaches inboxes without blocking the publish request. Every
    target is emailed / pushed only on the channels its own preferences keep
    on (urgent warnings always), and one notice reaches each address once
    (``_has_own_copy``, ``own_copy_reach``; for a comunicado also across
    siblings' rows that share an address, ``_claim_emails``).

    Each row is claimed on its own (``SELECT … FOR UPDATE SKIP LOCKED`` in a
    short transaction) and stamped ``delivered_at`` as soon as it is handled:
    two dispatchers (the cron and a publish request) never send the same row,
    and a worker killed half-way leaves pending only the row it was sending.
    A row that raises counts as a failed attempt, so it can never block the
    queue; a failed row is retried once ``RETRY_AFTER`` allows (30 min, then
    4 h). ``announcement`` limits the pass to that comunicado's rows;
    ``time_budget`` (seconds) stops taking new rows once spent. Rows older than
    ``max_age_days`` are marked delivered *without* sending, so a cron that was
    down for a while can't fire a surprise blast of stale announcements.
    Returns the number of rows delivered without an email failure.
    """
    from django.db import transaction

    from apps.portal.models import Notification

    now = timezone.now()
    pending = Notification.objects.filter(delivered_at__isnull=True)
    if announcement is not None:
        pending = pending.filter(announcement=announcement)
    pending.filter(created_at__lt=now - timedelta(days=max_age_days)).update(
        delivered_at=now, email_status=Notification.Delivery.SKIPPED,
        push_status=Notification.Delivery.SKIPPED, last_error='Caducó sin enviarse')
    ids = list(pending.filter(_due(now)).order_by('created_at', 'pk')
               .values_list('pk', flat=True)[:limit])

    max_attempts = getattr(settings, 'NOTIFICATION_MAX_ATTEMPTS', 3)
    prefs = {}  # user pk → NotificationPreference, read once per pass
    started = time.monotonic()
    sent, failures = 0, []
    for pk in ids:
        if time_budget is not None and time.monotonic() - started >= time_budget:
            break  # the rest waits for the next run
        try:
            with transaction.atomic():
                # The claim: a row another dispatcher is sending is skipped, one
                # it already delivered (or just retried) no longer matches.
                n = (Notification.objects.select_for_update(skip_locked=True)
                     .filter(_due(now), pk=pk, delivered_at__isnull=True).first())
                if n is None:
                    continue
                outcome = _deliver(n, prefs, max_attempts)
        except Exception as exc:  # noqa: BLE001 - one bad row must not stop the others
            logger.exception('dispatch_notifications: notification %s raised', pk)
            n, outcome = _count_crash(pk, exc, max_attempts)
        if outcome == 'sent':
            sent += 1
        elif outcome == 'failed' and n is not None:
            failures.append(n)

    if failures:
        _alert_ops_on_failures(failures)
    return sent


def _claim_emails(n, emails: list[str]) -> list[str]:
    """The addresses of ``emails`` this comunicado row may send to.

    Each address is claimed once per comunicado (``AnnouncementDelivery``,
    unique on comunicado + channel + lowercased address) by the account whose
    row sends to it first. A retry of that row keeps its claim; an address a
    deleted account claimed but never received is taken over. Runs inside the
    row's claim transaction: if the send is rolled back, so is the claim. On
    PostgreSQL a second dispatcher inserting the same address waits for the
    first to commit, then finds it taken.
    """
    from apps.portal.models import AnnouncementDelivery, Notification

    by_key: dict[str, str] = {}
    for addr in emails:
        by_key.setdefault(addr.strip().lower(), addr)
    claims = AnnouncementDelivery.objects.filter(
        announcement_id=n.announcement_id, channel=AnnouncementDelivery.Channel.EMAIL,
        address__in=list(by_key))
    AnnouncementDelivery.objects.bulk_create(
        [AnnouncementDelivery(announcement_id=n.announcement_id,
                              channel=AnnouncementDelivery.Channel.EMAIL,
                              address=key, send_to=addr, user_id=n.user_id)
         for key, addr in by_key.items()],
        ignore_conflicts=True)
    claims.filter(user__isnull=True).exclude(status=Notification.Delivery.SENT).update(user_id=n.user_id)
    mine = set(claims.filter(user_id=n.user_id).values_list('address', flat=True))
    return [addr for key, addr in by_key.items() if key in mine]


def _stamp_email_claims(n, emails: list[str], status: str) -> None:
    from apps.portal.models import AnnouncementDelivery

    sent = status == 'sent'
    (AnnouncementDelivery.objects
     .filter(announcement_id=n.announcement_id, channel=AnnouncementDelivery.Channel.EMAIL,
             user_id=n.user_id, address__in=[a.strip().lower() for a in emails])
     .update(status=status, attempts=n.attempts + 1, sent_at=timezone.now() if sent else None))


def _deliver(n, prefs: dict, max_attempts: int) -> str:
    """Email + push one claimed row and stamp it in the same transaction.

    Returns ``'sent'``, ``'retry'`` (the email failed; left pending for the
    next run) or ``'failed'`` (the email failed ``max_attempts`` times).
    """
    from apps.accounts.recipients import delivery_users, mailboxes_of, own_copy_reach, wants
    from apps.portal.models import Notification
    from apps.portal.push import send_web_push

    Delivery = Notification.Delivery
    ann, kind = n.announcement, n.notif_type
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
    if emails and ann is not None:
        # One email per address and comunicado: siblings whose logins share a
        # personal address each hold a row; the first row that sends to the
        # address claims it, the others leave it out (their in-app copy stays).
        emails = _claim_emails(n, emails)
    # A comunicado links to its notification, unless the row is hidden from
    # the app (the account turned in-app notices off): then to the portal.
    deep_link = f'/portal/notificaciones/{n.pk}' if ann and n.in_app else None
    email_status = Delivery.SKIPPED
    if emails:
        from .emailing import notification_content
        content = notification_content(user=n.user, notif_type=kind, title=n.title, message=n.message,
                                       comunicado=ann is not None, url=deep_link)
        ok = send_email(subject=n.title, message=n.message, recipients=emails, content=content)
        email_status = Delivery.SENT if ok else Delivery.FAILED
        if ann is not None:
            _stamp_email_claims(n, emails, email_status)
    # Comunicado rows deep-link the push to the notification (bitácora 10: the
    # family portal has no comunicados page) and honor the comunicado's
    # 'Enviar notificación push' toggle; standalone rows keep /portal. A retry
    # after a failed email never pushes a second time.
    push_status = Delivery.SENT if n.push_status == Delivery.SENT else Delivery.SKIPPED
    if n.push_status != Delivery.SENT and (ann is None or ann.push_enabled):
        url = deep_link or '/portal'
        delivered = sum(send_web_push(t, n.title, n.message, url=url)
                        for t in targets if wants(t, 'push', kind, prefs))
        push_status = Delivery.SENT if delivered else Delivery.SKIPPED

    attempts = n.attempts + 1
    failed = email_status == Delivery.FAILED
    retry = failed and attempts < max_attempts
    n.last_error = (f'Intento {attempts} falló' if retry
                    else f'Correo no entregado tras {attempts} intentos' if failed else '')
    Notification.objects.filter(pk=n.pk).update(
        attempts=attempts, email_status=email_status, push_status=push_status,
        last_error=n.last_error, delivered_at=None if retry else timezone.now())
    return 'retry' if retry else 'failed' if failed else 'sent'


def _count_crash(pk, exc, max_attempts: int):
    """A row whose delivery raised: one failed attempt, and once the attempts
    run out it is closed as failed, so it can never block the queue.
    Returns ``(row, 'retry' | 'failed')``."""
    from django.db.models import F

    from apps.portal.models import Notification

    error = f'Error al enviar: {type(exc).__name__}'[:200]
    Notification.objects.filter(pk=pk, delivered_at__isnull=True).update(
        attempts=F('attempts') + 1, last_error=error)
    n = Notification.objects.select_related('user').filter(pk=pk).first()
    if n is None or n.delivered_at is not None or n.attempts < max_attempts:
        return n, 'retry'
    n.last_error = f'{error} ({n.attempts} intentos)'[:200]
    Notification.objects.filter(pk=pk, delivered_at__isnull=True).update(
        delivered_at=timezone.now(), email_status=Notification.Delivery.FAILED, last_error=n.last_error)
    return n, 'failed'


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
