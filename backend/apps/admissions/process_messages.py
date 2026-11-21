"""
admissions/process_messages.py — what the Expediente sends to a family.

Each action returns ``{sent, channel, whatsapp_text, whatsapp_url, link,
sent_to, sent_at}``: ``channel='email'`` when the email went out, otherwise
``'whatsapp'`` (the office copies ``whatsapp_text`` or opens ``whatsapp_url``).
Most «Informes» arrive by WhatsApp, so the text is always returned.

Wording comes from editable templates (``SiteSettings.tpl_process``, a
``{key: text}`` dict; an empty key uses ``DEFAULTS``). Placeholders are a
closed list per template and are substituted by hand (no ``str.format``), so a
template can never reach attributes or indexes.
"""

from __future__ import annotations

import string
from dataclasses import dataclass
from urllib.parse import quote

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.audit import record

from .models import PreRegistration
from .process import (
    CASE_CONTEXT,
    CaseConflict,
    ficha_link_gate,
    is_admin_role,
    lead_token,
    stage_label,
)
from .services import ADM_REASON

SCHOOL = "Colegio Interlaken"

# ── templates ─────────────────────────────────────────────────────────────
COMMON = ("alumno", "tutor", "grado", "nivel", "ciclo", "colegio", "telefono")
PLACEHOLDERS: dict[str, tuple[str, ...]] = {
    "costs": COMMON + ("liga",),
    "visit_link": COMMON + ("liga",),
    "ficha_link": COMMON + ("liga", "vence"),
    "exam_date": COMMON + ("fecha", "fecha_resultados"),
    "exam_result_accepted": COMMON + ("fecha_resultados",),
    "exam_result_not_accepted": COMMON,
}
LABELS = {
    "costs": "Cuotas por nivel",
    "visit_link": "Liga para agendar la visita guiada",
    "ficha_link": "Liga de la ficha de inscripción",
    "exam_date": "Fecha del examen",
    "exam_result_accepted": "Resultado: aceptado",
    "exam_result_not_accepted": "Resultado: no aceptado",
}
DEFAULTS = {
    "costs": (
        "Hola {tutor}, gracias por su interés en el {colegio}. Le compartimos las cuotas de {nivel}: {liga}\n\n"
        "Con gusto le agendamos una visita guiada para que conozca el colegio."
    ),
    "visit_link": (
        "Hola {tutor}, le invitamos a una visita guiada por el {colegio}. Elija el día y la hora "
        "que mejor le acomoden en este enlace: {liga}"
    ),
    "ficha_link": (
        "Hola {tutor}, para continuar con la admisión de {alumno} le pedimos llenar la ficha de "
        "inscripción en este enlace personal: {liga}\n\n"
        "El enlace vence el {vence}. Si tiene dudas, con gusto le ayudamos."
    ),
    "exam_date": (
        "Hola {tutor}, el examen de admisión de {alumno} para {grado} quedó agendado para el {fecha}.\n\n"
        "Si necesita cambiar la fecha, avísenos por este medio."
    ),
    "exam_result_accepted": (
        "Hola {tutor}, nos da mucho gusto informarle que {alumno} fue aceptado(a) para cursar {grado} "
        "en el ciclo {ciclo}.\n\nEl siguiente paso es la documentación y la inscripción: en breve "
        "le compartimos los detalles."
    ),
    "exam_result_not_accepted": (
        "Hola {tutor}, gracias por la confianza en el {colegio}. Después de revisar el examen de "
        "admisión de {alumno}, por ahora no nos es posible ofrecerle un lugar en {grado}.\n\n"
        "Con gusto le atendemos si desea comentar el resultado."
    ),
}
MAX_TEMPLATE = 2000


def _parse(text: str):
    return list(string.Formatter().parse(text))


def template_errors(key: str, text: str) -> list[str]:
    allowed = PLACEHOLDERS[key]
    hint = "Use solo " + ", ".join("{" + p + "}" for p in allowed) + "."
    if len(text) > MAX_TEMPLATE:
        return [f"El texto no puede pasar de {MAX_TEMPLATE} caracteres."]
    try:
        parts = _parse(text)
    except ValueError:
        return ["Revise las llaves { }: hay una sin cerrar. " + hint]
    for _literal, name, spec, conversion in parts:
        if name is None:
            continue
        if name not in allowed or spec or conversion:
            return [f"«{{{name}}}» no es un dato disponible. " + hint]
    return []


def stored_templates() -> dict:
    from apps.content.models import SiteSettings

    data = SiteSettings.load().tpl_process
    return data if isinstance(data, dict) else {}


def template_text(key: str) -> str:
    text = stored_templates().get(key)
    return text if isinstance(text, str) and text.strip() else DEFAULTS[key]


def render(text: str, values: dict) -> str:
    """Substitute ``{name}`` from ``values``; anything unknown is kept as written."""
    try:
        parts = _parse(text)
    except ValueError:
        return text
    out = []
    for literal, name, spec, conversion in parts:
        out.append(literal)
        if name is None:
            continue
        if name in values and not spec and not conversion:
            out.append(str(values[name] or ""))
        else:
            out.append("{" + name + "}")
    return "".join(out)


def save_templates(data: dict, actor) -> dict:
    """``{key: text}``; ``''`` restores the built-in text. Raises ``ValidationError``."""
    from apps.content.models import SiteSettings

    errors = {}
    clean = {}
    for key, value in (data or {}).items():
        if key not in DEFAULTS:
            errors[key] = ["Plantilla desconocida."]
            continue
        text = str(value or "").strip()
        problems = template_errors(key, text) if text else []
        if problems:
            errors[key] = problems
        else:
            clean[key] = text
    if errors:
        raise ValidationError(errors)
    s = SiteSettings.load()
    current = dict(s.tpl_process or {}) if isinstance(s.tpl_process, dict) else {}
    changed = [k for k, v in clean.items() if (current.get(k) or "") != v]
    for key, text in clean.items():
        if text:
            current[key] = text
        else:
            current.pop(key, None)
    s.tpl_process = current
    s.save()
    if changed:
        record(
            "update",
            s,
            {"tpl_process": sorted(changed)},
            actor=actor,
            context="admissions: plantillas del expediente",
        )
    return templates_payload()


def templates_payload() -> dict:
    stored = stored_templates()
    return {
        "templates": {k: template_text(k) for k in DEFAULTS},
        "customized": sorted(
            k for k in DEFAULTS if isinstance(stored.get(k), str) and stored[k].strip()
        ),
        "defaults": dict(DEFAULTS),
        "placeholders": {k: ["{" + p + "}" for p in v] for k, v in PLACEHOLDERS.items()},
        "labels": dict(LABELS),
    }


# ── values ────────────────────────────────────────────────────────────────
WEEKDAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")


def when_text(dt) -> str:
    """«lunes 7 de diciembre de 2026 a las 9:00» (school time)."""
    if not dt:
        return ""
    from apps.portal.emailing import long_date

    local = timezone.localtime(dt)
    return f"{WEEKDAYS[local.weekday()]} {long_date(local.date())} a las {local.hour}:{local:%M}"


def child_name(lead) -> str:
    return f"{lead.child_first_name} {lead.child_last_name}".strip()


def base_values(lead) -> dict:
    from apps.content.models import SiteSettings

    from .ficha_schema import level_label

    return {
        "alumno": child_name(lead),
        "tutor": lead.parent_name,
        "grado": lead.grade_applying,
        "nivel": level_label(lead.level) or lead.level,
        "ciclo": lead.cycle,
        "colegio": SCHOOL,
        "telefono": SiteSettings.load().phone_display,
    }


def whatsapp_url(phone: str, text: str) -> str:
    """wa.me link with the text ready; '' without a 10-digit number."""
    from .process import phone_key

    key = phone_key(phone)
    if not key:
        return ""
    return f"https://wa.me/52{key}?text={quote(text)}"


def public_base() -> str:
    return (getattr(settings, "BACKEND_URL", "") or settings.FRONTEND_URL or "").rstrip("/")


def cuotas_url(level: str) -> str:
    return f"{public_base()}/api/v1/admissions/cuotas/{level or 'todos'}.pdf"


def visit_booking_url(lead) -> str:
    return (
        f"{(settings.FRONTEND_URL or '').rstrip('/')}/agendar-visita?lead={quote(lead_token(lead))}"
    )


# ── delivery ──────────────────────────────────────────────────────────────
@dataclass
class Message:
    key: str
    subject: str
    title: str
    text: str
    link: str = ""
    cta_label: str = ""
    attachment: tuple[str, bytes, str] | None = None
    tone: str = "brand"


def resolve_channel(lead, requested) -> str:
    if requested in (None, ""):
        return "email" if lead.parent_email else "whatsapp"
    if requested not in ("email", "whatsapp"):
        raise ValidationError({"channel": ["Elija «email» o «whatsapp»."]})
    if requested == "email" and not lead.parent_email:
        raise ValidationError({"channel": ["El expediente no tiene correo: envíelo por WhatsApp."]})
    return requested


def send_email_message(lead, msg: Message) -> bool:
    """Branded email (the template text is the plain part, verbatim). Fail-soft."""
    import logging

    from apps.portal.emailing import EmailContent
    from apps.portal.services import build_email

    paragraphs = [p.strip() for p in msg.text.split("\n\n") if p.strip()]
    if msg.link and msg.cta_label:
        paragraphs = [p.replace(msg.link, "").rstrip(" :") for p in paragraphs]
    content = EmailContent(
        category="Admisiones",
        tone=msg.tone,
        title=msg.title,
        intro=paragraphs[0] if paragraphs else "",
        paragraphs=paragraphs[1:],
        cta_label=msg.cta_label if msg.link else "",
        cta_url=msg.link if msg.cta_label else "",
        signoff="Equipo de Admisiones",
        reason=ADM_REASON,
    )
    try:
        email = build_email(
            msg.subject,
            msg.text,
            [lead.parent_email],
            reply_to=settings.ADMISSIONS_EMAIL,
            content=content,
            text_from_content=False,
        )
        if msg.attachment:
            email.attach(*msg.attachment)
        return bool(email.send(fail_silently=False))
    except Exception as exc:  # mail must never break the action
        logging.getLogger(__name__).error(
            "Expediente email failed (%s → %s): %s", msg.key, lead.parent_email, exc
        )
        return False


def deliver(lead, msg: Message, *, channel, stamp: str, actor, extra: dict | None = None) -> dict:
    sent = send_email_message(lead, msg) if channel == "email" else False
    now = timezone.now()
    if channel == "whatsapp" or sent:
        setattr(lead, stamp, now)
        lead.save(update_fields=[stamp, "updated_at"])
    record(
        "update",
        lead,
        {"sent": msg.key, "channel": channel, "email_sent": sent, **(extra or {})},
        actor=actor,
        context=f"{CASE_CONTEXT}: envío ({LABELS[msg.key].lower()})",
    )
    return {
        "sent": sent,
        "channel": "email" if sent else "whatsapp",
        "whatsapp_text": msg.text,
        "whatsapp_url": whatsapp_url(lead.parent_phone, msg.text),
        "link": msg.link,
        "sent_to": lead.parent_email if sent else "",
        "sent_at": getattr(lead, stamp),
    }


def _ensure_not_closed(lead):
    if lead.stage in (PreRegistration.Stage.CERRADO, PreRegistration.Stage.INSCRITO):
        raise CaseConflict(f"El expediente está «{stage_label(lead.stage)}».", code=lead.stage)


# ── the five actions ──────────────────────────────────────────────────────
def send_costs(lead, actor, *, channel=None) -> dict:
    from .cuotas_pdf import LEVELS, render_cuotas_pdf

    channel = resolve_channel(lead, channel)
    level = lead.level if lead.level in LEVELS else "todos"
    values = base_values(lead) | {"liga": cuotas_url(level)}
    text = render(template_text("costs"), values)
    attachment = None
    if channel == "email":
        pdf = render_cuotas_pdf([level] if level in LEVELS else list(LEVELS))
        attachment = (f"cuotas-{level}.pdf", pdf, "application/pdf")
    msg = Message(
        "costs",
        f"Cuotas de {values['nivel'] or 'admisión'}: {SCHOOL}",
        f"Cuotas de {values['nivel'] or 'admisión'}",
        text,
        link=values["liga"],
        cta_label="Ver las cuotas",
        attachment=attachment,
    )
    return deliver(lead, msg, channel=channel, stamp="costs_sent_at", actor=actor)


def send_visit_link(lead, actor, *, channel=None) -> dict:
    _ensure_not_closed(lead)
    channel = resolve_channel(lead, channel)
    link = visit_booking_url(lead)
    text = render(template_text("visit_link"), base_values(lead) | {"liga": link})
    msg = Message(
        "visit_link",
        f"Agende su visita guiada al {SCHOOL}",
        "Le invitamos a una visita guiada",
        text,
        link=link,
        cta_label="Agendar visita",
    )
    return deliver(lead, msg, channel=channel, stamp="visit_link_sent_at", actor=actor)


def send_ficha_link(lead, actor, *, channel=None, override=False) -> dict:
    """Reuses the invite (draft + single-use token). Refused before «Examen
    agendado» unless an admin overrides it (audited)."""
    from apps.portal.emailing import long_date

    from .services import AlreadyApplied, email_invite, invite_preregistration

    gate = ficha_link_gate(lead)
    overridden = False
    if not gate["allowed"]:
        if not (gate["overridable"] and override):
            raise CaseConflict(
                gate["reason"],
                code="too_early" if gate["overridable"] else "not_allowed",
                overridable=gate["overridable"],
            )
        if not is_admin_role(actor):
            raise CaseConflict(
                "Solo un administrador puede enviar la ficha antes del examen.", code="admin_only"
            )
        overridden = True
    channel = resolve_channel(lead, channel)
    try:
        out = invite_preregistration(
            lead, actor, context=f"{CASE_CONTEXT}: liga de ficha", email=False
        )
    except AlreadyApplied as exc:
        raise CaseConflict(f"La familia {exc}.", code="already_applied") from None
    reg = out["registration"]
    lead.refresh_from_db()
    values = base_values(lead) | {"liga": out["url"], "vence": long_date(reg.invite_expires_at)}
    text = render(template_text("ficha_link"), values)
    msg = Message(
        "ficha_link", f"Ficha de inscripción: {child_name(lead)}", "", text, link=out["url"]
    )
    sent = False
    if channel == "email":
        sent = bool(email_invite(reg, out["url"], to=lead.parent_email))
    now = timezone.now()
    if channel == "whatsapp" or sent:
        lead.ficha_link_sent_at = now
        lead.save(update_fields=["ficha_link_sent_at", "updated_at"])
    record(
        "update",
        lead,
        {
            "sent": msg.key,
            "channel": channel,
            "email_sent": sent,
            "registration": reg.pk,
            **({"override": True} if overridden else {}),
        },
        actor=actor,
        context=f"{CASE_CONTEXT}: envío ({LABELS[msg.key].lower()})",
    )
    return {
        "sent": sent,
        "channel": "email" if sent else "whatsapp",
        "whatsapp_text": text,
        "whatsapp_url": whatsapp_url(lead.parent_phone, text),
        "link": out["url"],
        "sent_to": lead.parent_email if sent else "",
        "sent_at": lead.ficha_link_sent_at,
        "registration": reg.pk,
        "expires_at": reg.invite_expires_at,
        "override": overridden,
    }


def send_exam_date(lead, actor, *, channel=None) -> dict:
    _ensure_not_closed(lead)
    if not lead.exam_at:
        raise ValidationError({"exam_at": ["Agende primero la fecha del examen."]})
    channel = resolve_channel(lead, channel)
    values = base_values(lead) | {
        "fecha": when_text(lead.exam_at),
        "fecha_resultados": when_text(lead.exam_results_at),
    }
    text = render(template_text("exam_date"), values)
    msg = Message(
        "exam_date",
        f"Examen de admisión de {child_name(lead)}",
        "Fecha del examen de admisión",
        text,
    )
    return deliver(lead, msg, channel=channel, stamp="exam_date_sent_at", actor=actor)


def send_exam_result(lead, actor, *, channel=None) -> dict:
    R = PreRegistration.ExamResult
    if lead.exam_result not in (R.ACEPTADO, R.NO_ACEPTADO):
        raise ValidationError({"result": ["Registre primero el resultado del examen."]})
    channel = resolve_channel(lead, channel)
    accepted = lead.exam_result == R.ACEPTADO
    key = "exam_result_accepted" if accepted else "exam_result_not_accepted"
    values = base_values(lead) | {"fecha_resultados": when_text(lead.exam_results_at)}
    text = render(template_text(key), values)
    msg = Message(
        key,
        f"Resultado del examen de admisión de {child_name(lead)}",
        "Resultado del examen de admisión",
        text,
        tone="success" if accepted else "neutral",
    )
    return deliver(lead, msg, channel=channel, stamp="exam_result_sent_at", actor=actor)


ACTIONS = {
    "send-costs": send_costs,
    "send-visit-link": send_visit_link,
    "send-ficha-link": send_ficha_link,
    "send-exam-date": send_exam_date,
    "send-exam-result": send_exam_result,
}
