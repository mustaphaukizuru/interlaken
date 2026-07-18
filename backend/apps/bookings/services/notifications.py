"""
bookings/services/notifications.py — Branded email confirmations for bookings.

Routes email through the shared ``portal.services.send_email`` helper (Prompt 08);
falls back to Django's ``send_mail`` (console backend in dev) if that module is
absent. A booking's ``parent_email`` is not necessarily a registered user, so we
use ``send_email`` (raw recipient) rather than ``notify`` (which needs a User).

This is our *own* branded confirmation — kept even when Google Calendar sends its
attendee invite (Prompt 13), so a parent always gets an Interlaken-styled email.
"""
import logging

from django.conf import settings
from django.core.mail import EmailMessage

from .ics import build_ics

logger = logging.getLogger(__name__)


def _visit_type_label(booking):
    return booking.slot.get_visit_type_display()


def send_booking_confirmation(booking):
    """Send a Spanish confirmation email (with a .ics calendar invite) for a
    booking and flag it as sent.

    Best-effort: email failures never block the booking (fail_silently). The
    .ics attachment lets the parent add the visit to their calendar in one tap;
    if generation ever fails, the email still goes out without it.
    """
    slot = booking.slot
    subject = 'Confirmación de visita — Colegio Interlaken'
    body = (
        f'Estimado/a {booking.parent_name},\n\n'
        f'Su visita ha quedado registrada:\n\n'
        f'  • Tipo: {_visit_type_label(booking)}\n'
        f'  • Fecha: {slot.date:%d/%m/%Y}\n'
        f'  • Horario: {slot.start_time:%H:%M} - {slot.end_time:%H:%M}\n'
        f'  • Lugar: {slot.location or "Campus Interlaken"}\n'
        f'  • Asistentes: {booking.num_attendees}\n\n'
        f'Adjuntamos una invitación de calendario (.ics) para que agregue la '
        f'visita a su agenda.\n\n'
        f'Si necesita cancelar o reprogramar, responda a este correo o '
        f'comuníquese con nosotros.\n\n'
        f'¡Le esperamos!\nColegio Interlaken'
    )

    email = EmailMessage(
        subject=subject,
        body=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[booking.parent_email],
    )
    try:
        email.attach('visita-interlaken.ics', build_ics(booking),
                     'text/calendar; charset=utf-8; method=PUBLISH')
    except Exception as exc:  # pragma: no cover - defensive; never block on ics
        logger.warning('No se pudo generar el .ics para la reserva %s: %s',
                       booking.pk, exc)
    email.send(fail_silently=True)

    booking.confirmation_sent = True
    booking.save(update_fields=['confirmation_sent'])
    return True
