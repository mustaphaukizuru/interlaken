"""
bookings/services/staff_alerts.py: tell the school when a family books or cancels a visit.

Until 2026-11-26 nobody at the school heard about a booking: only the family
got an email (``ADMISSIONS_EMAIL`` was merely its reply-to) and the console's
red dot counted «Pendiente» bookings, which a web booking never is. The owner
found three visits by chance (owner points 2026-11-25).

Who hears, for every new booking (web form, «Puertas Abiertas» signup, WhatsApp
bot: all go through ``create_booking``) and for a cancellation the family makes
itself (a cancellation from the console needs no alert, staff made it):

- **email**: the admissions inbox (``ADMISSIONS_EMAIL``, info@) and every active
  staff account holding the «visitas» console area (whoever runs admissions),
  one message, each address once. Reply-To is the family when it left an email,
  so «Responder» writes to them;
- **bell**: every active administrator and those same staff accounts, with
  ``email=False`` (an administrator gets no second email; web push still follows
  their notification preferences).

Best effort and out of the family's way: scheduled after the booking's
transaction commits and run on a background thread, logged on failure, never
raised. The red dot (``followup.upcoming_visits``) and the Visitas list show the
booking whatever happens to the alert.
"""

from __future__ import annotations

import logging
from functools import partial

from django.conf import settings
from django.db import transaction

logger = logging.getLogger(__name__)

CREATED = "created"
CANCELLED_BY_FAMILY = "cancelled_by_family"

VISITS_AREA = "visitas"

REASON = (
    "Aviso interno de la consola del Colegio Interlaken. Lo reciben el buzón de admisiones "
    "y el personal con el área «Visitas y agenda»."
)


def visit_staff():
    """``(admins, staff)``: active administrators, and active staff accounts
    holding the «visitas» area. ``staff_areas`` is a JSON list, filtered in
    Python like ``cafeteria_staff`` (SQLite has no JSON ``contains``)."""
    from apps.accounts.models import User

    active = User.objects.filter(is_active=True, archived_at__isnull=True)
    admins = list(active.filter(role=User.Role.ADMIN))
    staff = [u for u in active.filter(role=User.Role.STAFF) if VISITS_AREA in (u.staff_areas or [])]
    return admins, staff


def alert_emails(staff=None) -> list[str]:
    """The admissions inbox first, then each Visitas staff address, once each."""
    if staff is None:
        staff = visit_staff()[1]
    inbox = getattr(settings, "ADMISSIONS_EMAIL", "") or getattr(settings, "CONTACT_EMAIL", "")
    out, seen = [], set()
    for address in [inbox, *(u.email for u in staff)]:
        key = (address or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(address.strip())
    return out


def visits_path(booking) -> str:
    """The Visitas list on the visit's day (no family data in the address)."""
    day = booking.slot.date.isoformat()
    return f"/admin/visitas?desde={day}&hasta={day}"


def _day_and_hour(booking) -> tuple[str, str]:
    """(«27 de noviembre», «11:00»): short enough for a subject line."""
    from apps.portal.emailing import MONTHS

    slot = booking.slot
    return f"{slot.date.day} de {MONTHS[slot.date.month - 1]}", f"{slot.start_time:%H:%M}"


def _visit_label(slot) -> str:
    label = slot.get_visit_type_display()
    return f"{label} ({slot.title})" if slot.title else label


def _source_label(booking) -> str:
    from ..models import Booking

    if booking.source == Booking.Source.WEB and booking.pre_registration_id:
        return "Sitio web (desde su expediente de admisión)"
    return booking.get_source_display()


def details(booking) -> list[tuple[str, str]]:
    """What the office needs to prepare the visit, as label/value rows."""
    from apps.portal.emailing import long_date

    slot = booking.slot
    rows = [
        ("Tipo de visita", _visit_label(slot)),
        ("Fecha", long_date(slot.date)),
        ("Horario", f"{slot.start_time:%H:%M} a {slot.end_time:%H:%M}"),
        ("Lugar", slot.location or "Campus Interlaken"),
        ("Asistentes", str(booking.num_attendees)),
        ("Familia", booking.parent_name or "Sin nombre"),
    ]
    if booking.parent_phone:
        rows.append(("Teléfono", booking.parent_phone))
    if booking.parent_email:
        rows.append(("Correo", booking.parent_email))
    if booking.child_name or booking.child_grade:
        child = booking.child_name or "Sin nombre"
        rows.append(
            ("Alumno", f"{child} ({booking.child_grade})" if booking.child_grade else child)
        )
    rows.append(("Origen", _source_label(booking)))
    notes = (booking.notes or "").strip()
    if notes:
        rows.append(("Notas", notes if len(notes) <= 300 else f"{notes[:299].rstrip()}…"))
    return rows


def _confirmed_how(booking) -> str:
    from ..models import Booking

    if booking.source == Booking.Source.WHATSAPP:
        return "Quedó confirmada automáticamente y se le confirmó a la familia por WhatsApp."
    if booking.parent_email:
        return "Quedó confirmada automáticamente y se le envió la confirmación a la familia por correo."
    return "Quedó confirmada automáticamente."


def _reply_note(booking) -> str:
    """Only when there is no family email: with one, the footer already says a
    reply reaches the family (Reply-To is their address)."""
    if booking.parent_email:
        return ""
    return "La familia no dejó correo: comuníquese por teléfono o WhatsApp."


def new_booking_content(booking):
    """``(subject, EmailContent)`` of the new-visit alert (pure; render_emails previews it).

    The subject carries no name (it shows on lock screens and inbox lists)."""
    from apps.portal.emailing import EmailContent, long_date, portal_url

    day, hour = _day_and_hour(booking)
    who = booking.parent_name or "Una familia"
    content = EmailContent(
        category="Visitas",
        tone="success",
        title="Una familia agendó una visita",
        intro=f"{who} agendó una visita para el {long_date(booking.slot.date)} a las {hour}. "
        f"{_confirmed_how(booking)}",
        preheader=f"Visita del {day} a las {hour}. {_confirmed_how(booking)}",
        details=details(booking),
        cta_label="Abrir Visitas",
        cta_url=portal_url(visits_path(booking)),
        link_fallback=False,
        note=_reply_note(booking),
        reason=REASON,
    )
    return f"Nueva visita: {day}, {hour}", content


def cancelled_booking_content(booking):
    """``(subject, EmailContent)`` of the alert when the family cancels (pure)."""
    from apps.portal.emailing import EmailContent, long_date, portal_url

    day, hour = _day_and_hour(booking)
    who = booking.parent_name or "Una familia"
    content = EmailContent(
        category="Visitas",
        tone="warning",
        title="Una familia canceló su visita",
        intro=f"{who} canceló su visita del {long_date(booking.slot.date)} a las {hour}. "
        "El horario quedó libre.",
        preheader=f"Visita del {day} a las {hour} cancelada por la familia.",
        details=details(booking),
        cta_label="Abrir Visitas",
        cta_url=portal_url(visits_path(booking)),
        link_fallback=False,
        note=_reply_note(booking),
        reason=REASON,
    )
    return f"Visita cancelada: {day}, {hour}", content


def bell_text(booking, kind: str) -> tuple[str, str]:
    """``(title, message)`` of the console notice: a sentence, the label/value
    rows the Avisos view lays out as a table, and the link to the list."""
    from apps.portal.emailing import portal_url

    day, hour = _day_and_hour(booking)
    who = booking.parent_name or "Una familia"
    if kind == CANCELLED_BY_FAMILY:
        title = f"Visita cancelada: {day}, {hour}"
        lead = f"{who} canceló su visita. El horario quedó libre."
    else:
        title = f"Nueva visita: {day}, {hour}"
        lead = f"{who} agendó una visita. {_confirmed_how(booking)}"
    rows = "\n".join(f"{label}: {value}" for label, value in details(booking))
    return title, f"{lead}\n\n{rows}\n\nÁbrala en Visitas: {portal_url(visits_path(booking))}"


def notify_staff(booking_id: int, kind: str = CREATED) -> int:
    """Email the admissions inbox and the Visitas staff, and ring the bell of
    every administrator and Visitas staff account. Returns how many addresses
    and accounts were reached; never raises."""
    from apps.portal.emailing import portal_url
    from apps.portal.models import Notification
    from apps.portal.services import notify, send_email

    from ..models import Booking

    try:
        booking = Booking.objects.select_related("slot").filter(pk=booking_id).first()
        if booking is None:
            return 0
        admins, staff = visit_staff()
        build = cancelled_booking_content if kind == CANCELLED_BY_FAMILY else new_booking_content
        subject, content = build(booking)
        reached = 0
        emails = alert_emails(staff)
        if emails:
            if send_email(
                subject, "", emails, reply_to=booking.parent_email or None, content=content
            ):
                reached += len(emails)
            else:
                logger.warning(
                    "Visit alert email for booking #%s (%s) was not sent", booking.pk, kind
                )
        title, message = bell_text(booking, kind)
        people = {u.pk: u for u in [*admins, *staff]}
        for person in people.values():
            try:
                if notify(
                    person,
                    Notification.NotifType.INFO,
                    title,
                    message,
                    email=False,
                    fanout=False,
                    url=portal_url(visits_path(booking)),
                    cta_label="Abrir Visitas",
                ):
                    reached += 1
            except Exception:  # noqa: BLE001 - one failed bell never stops the others
                logger.exception(
                    "Visit alert bell for user #%s failed (booking #%s)", person.pk, booking.pk
                )
        return reached
    except Exception:  # noqa: BLE001 - an alert never undoes or fails a booking
        logger.exception("Visit staff alert failed for booking #%s (%s)", booking_id, kind)
        return 0


def alert_staff(booking, kind: str = CREATED) -> None:
    """Tell the school about ``booking`` once its transaction commits, on a
    background thread, so a slow mail server never slows the family's booking."""
    from apps.portal import services as portal_services

    booking_id = booking.pk

    def start():
        portal_services.run_in_background(
            partial(notify_staff, booking_id, kind), name=f"bookings-staff-alert-{booking_id}"
        )

    transaction.on_commit(start, robust=True)
