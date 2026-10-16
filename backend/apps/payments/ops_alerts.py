"""
payments/ops_alerts.py — email the school's admins about Banorte operations.

The VPS has no local `mail`, so cron output only reaches a log nobody reads.
These helpers go through the app's own email pipeline (like
``check_sync_fresh``) and keep their "already told them" stamps in
``OpsStatus`` so an unchanged problem is not emailed every day.
"""

from datetime import datetime, timedelta

from django.utils import timezone

from apps.core.models import OpsStatus

# An unchanged problem is re-sent at most this often.
REMIND_EVERY = timedelta(days=7)


def admin_recipients() -> list[str]:
    from apps.accounts.models import User

    return list(
        User.objects.filter(role=User.Role.ADMIN, is_active=True)
        .exclude(email="")
        .values_list("email", flat=True)
    )


def should_alert(key: str, fingerprint: str, now=None) -> bool:
    """True when ``fingerprint`` differs from the last alert or that was a week ago."""
    now = now or timezone.now()
    previous = OpsStatus.get(key) or {}
    if previous.get("fingerprint") != fingerprint:
        return True
    sent = previous.get("alerted_at")
    if not sent:
        return True
    try:
        return now - datetime.fromisoformat(sent) >= REMIND_EVERY
    except ValueError:
        return True


def mark_alerted(key: str, fingerprint: str, now=None) -> None:
    now = now or timezone.now()
    OpsStatus.set(key, {"fingerprint": fingerprint, "alerted_at": now.isoformat()})


def clear_alert(key: str) -> None:
    if OpsStatus.get(key):
        OpsStatus.set(key, {})


def email_admins(subject: str, body: str) -> int:
    """Send ``body`` to every active admin. Returns how many were addressed (0 = not sent)."""
    from apps.portal.services import send_email

    recipients = admin_recipients()
    if not recipients:
        return 0
    return len(recipients) if send_email(subject, body, recipients) else 0


CONFIG_ERROR_KEY = "banorte_config_error"


def alert_config_error(checkout, problem: str) -> int:
    """Email the admins that Banorte rejected an operation for a merchant set-up
    reason (AUT-10, Payworks R/E such as PAYW-3008). Once per distinct problem,
    then weekly while it repeats. Never includes credentials.

    Returns how many admins were addressed (0 = not sent or already told).
    """
    fingerprint = problem[:200]
    if not should_alert(CONFIG_ERROR_KEY, fingerprint):
        return 0
    body = (
        "Banorte rechazó un pago con tarjeta por un problema de configuración del "
        "comercio, no por la tarjeta de la familia. Mientras no se corrija, los pagos "
        "con tarjeta van a fallar.\n\n"
        f"- Problema: {problem}\n"
        f"- Número de control: {checkout.control_number} (pago #{checkout.payment_id}, "
        f"modo {checkout.mode})\n\n"
        "Qué revisar (docs/BANORTE-INTEGRATION.md, secciones 3 y 4): AUT-10 suele ser "
        "el certificado vencido o el usuario/contraseña del motor; PAYW-3008 significa "
        "que BANORTE_TERMINAL_ID no es una terminal de la afiliación (la terminal de "
        "Payworks no siempre es igual a la afiliación). Ejecute "
        "`python manage.py check_banorte` en el servidor después de corregir."
    )
    sent = email_admins("Interlaken: error de configuración en pagos Banorte", body)
    if sent:
        mark_alerted(CONFIG_ERROR_KEY, fingerprint)
    return sent
