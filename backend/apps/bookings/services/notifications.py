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

    # send() returns the number of messages delivered (0 on a silent failure).
    # Only flag it sent when it actually went out, so a transient SMTP failure
    # doesn't permanently mark an unsent confirmation as delivered.
    delivered = bool(email.send(fail_silently=True))
    if delivered:
        booking.confirmation_sent = True
        booking.save(update_fields=['confirmation_sent'])
    else:
        logger.warning('No se pudo enviar la confirmación de la reserva %s a %s',
                       booking.pk, booking.parent_email)
    return delivered


def send_booking_reminder(booking):
    """Send the day-before reminder email (with the .ics) and flag it as sent.

    Best-effort and idempotent per booking via ``reminder_sent`` (the caller
    filters on it). Same fail-soft contract as the confirmation.
    """
    slot = booking.slot
    subject = 'Recordatorio: su visita es mañana — Colegio Interlaken'
    body = (
        f'Estimado/a {booking.parent_name},\n\n'
        f'Le recordamos su visita programada para MAÑANA:\n\n'
        f'  • Tipo: {_visit_type_label(booking)}\n'
        f'  • Fecha: {slot.date:%d/%m/%Y}\n'
        f'  • Horario: {slot.start_time:%H:%M} - {slot.end_time:%H:%M}\n'
        f'  • Lugar: {slot.location or "Campus Interlaken"}\n'
        f'  • Asistentes: {booking.num_attendees}\n\n'
        f'Si ya no puede asistir, por favor avísenos respondiendo a este correo.\n\n'
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
        logger.warning('No se pudo generar el .ics para el recordatorio %s: %s',
                       booking.pk, exc)

    # Gate the flag on real delivery: a failed send must leave reminder_sent
    # False so the next cron run retries it (and is counted as a failure),
    # instead of silently swallowing it and reporting "0 fallidos".
    delivered = bool(email.send(fail_silently=True))
    if delivered:
        booking.reminder_sent = True
        booking.save(update_fields=['reminder_sent'])
    else:
        logger.warning('No se pudo enviar el recordatorio de la reserva %s a %s',
                       booking.pk, booking.parent_email)
    return delivered
