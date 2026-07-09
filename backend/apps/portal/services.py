"""
portal/services.py — the single place notifications are created & sent.

Both cafeteria (purchase / low-balance alerts) and bookings (visit confirmations)
route through here. In dev, ``EMAIL_BACKEND`` is the console backend, so emails
print to stdout; in prod it's cPanel SMTP (see DEPLOYMENT.md §2/§4).

WhatsApp is a placeholder wired for Prompt 14 — passing ``whatsapp=True`` today
just logs an intent; no message is sent.
"""
import logging

from django.conf import settings
from django.core.mail import send_mail

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

    notification = Notification.objects.create(
        user=user,
        notif_type=notif_type,
        title=title,
        message=message,
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
