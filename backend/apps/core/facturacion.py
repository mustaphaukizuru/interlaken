"""
core/facturacion.py — the website's «Solicitud de facturación», after it arrives.

Owner 2026-11-26:

* every request reaches all the addresses in Ajustes → «Correos que reciben las
  solicitudes de factura» (``SiteSettings.billing_emails``: facturas@ and
  vvega@), or ``BILLING_EMAIL`` while that list is empty;
* the family is no longer told «Recibimos su solicitud» the moment it sends the
  form: it hears from the school when someone marks the request «Atendido» in
  Mensajes, so the email means the data was really registered. One email per
  request, ever: reopening and marking it again sends nothing, and the requests
  already «Atendido» before this change never get one.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.utils import timezone

logger = logging.getLogger(__name__)

SUBJECT_PREFIX = "[Facturación]"
MAX_RECIPIENTS = 5

# The seven fields, in the order of the form and of the stored message body
# («Label: value» lines, see FacturacionView).
FIELDS = (
    ("student", "Nombre del alumno"),
    ("razon_social", "Razón social"),
    ("rfc", "RFC"),
    ("cp", "Código postal"),
    ("regimen", "Régimen fiscal"),
    ("email", "Correo para enviar facturas"),
    ("phone", "Teléfono de contacto"),
)


def clean_recipients(values) -> list[str]:
    """Valid, lowercased, de-duplicated addresses (raises ``ValueError`` naming
    the first bad one). Accepts a list or a text with commas / new lines."""
    if isinstance(values, str):
        values = values.replace(";", ",").replace("\n", ",").split(",")
    if not isinstance(values, (list, tuple)):
        raise ValueError("Envíe una lista de correos.")
    out: list[str] = []
    for raw in values:
        email = str(raw or "").strip().lower()
        if not email:
            continue
        try:
            validate_email(email)
        except DjangoValidationError:
            raise ValueError(f"Revise el correo «{email}».") from None
        if email not in out:
            out.append(email)
    if len(out) > MAX_RECIPIENTS:
        raise ValueError(f"Máximo {MAX_RECIPIENTS} correos.")
    return out


def recipients() -> list[str]:
    """Who receives a new request: Ajustes, else the ``BILLING_EMAIL`` setting.
    Read from the database on every request (never the public settings cache)."""
    from apps.content.models import SiteSettings

    saved = SiteSettings.objects.filter(pk=1).values_list("billing_emails", flat=True).first()
    try:
        chosen = clean_recipients(saved or [])
    except ValueError:
        chosen = []
    if chosen:
        return chosen
    fallback = (
        getattr(settings, "BILLING_EMAIL", "")
        or settings.CONTACT_EMAIL
        or settings.DEFAULT_FROM_EMAIL
    )
    return [fallback] if fallback else []


def is_request(message) -> bool:
    return (message.subject or "").startswith(SUBJECT_PREFIX)


def request_data(message) -> dict | None:
    """The request's fields: stored with it, else read back from the body
    (requests sent before 2026-11-26). None when they cannot be recovered."""
    if isinstance(message.facturacion, dict) and message.facturacion.get("email"):
        return message.facturacion
    labels = {label: key for key, label in FIELDS}
    data: dict = {}
    for line in (message.message or "").splitlines():
        label, sep, value = line.partition(":")
        key = labels.get(label.strip())
        if sep and key:
            data[key] = value.strip()
    if not data.get("email"):
        return None
    try:
        validate_email(data["email"])
    except DjangoValidationError:
        return None
    return data


def confirmation_content(data: dict):
    """``(subject, EmailContent, text)`` of the email the family receives when
    the office marks the request «Atendido» (pure; render_emails previews it)."""
    from apps.portal.emailing import EmailContent

    rfc = str(data.get("rfc") or "").upper()
    details = [
        (label_es, value)
        for label_es, value in (
            ("Alumno", data.get("student")),
            ("Razón social", data.get("razon_social")),
            ("RFC", rfc),
            ("Código postal", data.get("cp")),
            ("Régimen fiscal", data.get("regimen")),
            ("Facturas a", data.get("email")),
        )
        if value
    ]
    intro = (
        "Registramos sus datos fiscales. A partir de ahora recibirá sus facturas cada mes, "
        "24 horas hábiles después de realizar sus pagos."
    )
    note = (
        "Solo se emiten facturas del mes en curso y no es posible cancelar ni cambiar facturas "
        "fuera del mes en que se realizó el pago. Si algún dato cambia, responda a este correo."
    )
    content = EmailContent(
        category="Facturación",
        tone="success",
        title="Sus datos de facturación quedaron registrados",
        intro=intro,
        details=details,
        note=note,
        reason="Recibe este correo porque envió una solicitud de facturación desde interlaken.edu.mx.",
    )
    text = "\n\n".join(
        [
            f"{intro}",
            "\n".join(f"{label_es}: {value}" for label_es, value in details),
            note,
        ]
    )
    return "Sus datos de facturación quedaron registrados", content, text


def send_confirmation(message, *, actor=None) -> dict | None:
    """Tell the family their request was registered, once.

    ``None`` for anything that is not a facturación request. Otherwise
    ``{"sent": bool, "to": str, "reason": str}``: ``reason`` is ``already_sent``
    (never twice), ``no_data`` (the address could not be read) or ``failed``
    (the mail server refused it; ``ack_sent_at`` stays empty so a later
    «Atendido» can try again). Never raises: the «Atendido» change stands.
    """
    from apps.portal.services import send_email

    from .audit import record
    from .models import ContactMessage

    if not is_request(message):
        return None
    if message.ack_sent_at is not None:
        return {"sent": False, "to": "", "reason": "already_sent"}
    data = request_data(message)
    if data is None:
        logger.warning("Facturación #%s: no address to confirm to", message.pk)
        return {"sent": False, "to": "", "reason": "no_data"}
    to = data["email"]
    subject, content, text = confirmation_content(data)
    billing = recipients()
    try:
        # A reply reaches the billing desk, not noreply@.
        sent = send_email(
            subject, text, [to], reply_to=billing[0] if billing else None, content=content
        )
    except Exception:  # noqa: BLE001 - a mail problem never undoes «Atendido»
        logger.exception("Facturación #%s: confirmation email failed", message.pk)
        sent = False
    if not sent:
        return {"sent": False, "to": to, "reason": "failed"}
    now = timezone.now()
    # Conditional write: two «Atendido» clicks racing never record (or send) twice.
    ContactMessage.objects.filter(pk=message.pk, ack_sent_at__isnull=True).update(ack_sent_at=now)
    message.ack_sent_at = now
    record(
        "update",
        message,
        {"confirmation_sent_to": to},
        actor=actor,
        context="contact.facturacion_confirmada",
    )
    return {"sent": True, "to": to, "reason": ""}
