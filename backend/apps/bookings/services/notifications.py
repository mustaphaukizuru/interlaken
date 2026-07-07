"""
bookings/services/notifications.py — Branded email confirmations for bookings.

Routes email through the shared ``portal.services.send_email`` helper (Prompt 08);
falls back to Django's ``send_mail`` (console backend in dev) if that module is
absent. A booking's ``parent_email`` is not necessarily a registered user, so we
use ``send_email`` (raw recipient) rather than ``notify`` (which needs a User).

This is our *own* branded confirmation — kept even when Google Calendar sends its
attendee invite (Prompt 13), so a parent always gets an Interlaken-styled email.
"""
from django.conf import settings
from django.core.mail import send_mail

try:  # pragma: no cover - portal.services ships in Prompt 08
    from apps.portal.services import send_email as _portal_send_email
except Exception:  # ImportError or module missing
    _portal_send_email = None


def _visit_type_label(booking):
    return booking.slot.get_visit_type_display()


def send_booking_confirmation(booking):
    """Send a Spanish confirmation email for a booking and flag it as sent.

    Best-effort: email failures never block the booking (fail_silently).
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
        f'Si necesita cancelar o reprogramar, responda a este correo o '
        f'comuníquese con nosotros.\n\n'
        f'¡Le esperamos!\nColegio Interlaken'
    )
    recipients = [booking.parent_email]

    if _portal_send_email is not None:
        _portal_send_email(subject=subject, message=body, recipients=recipients)
    else:
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=recipients,
            fail_silently=True,
        )

    booking.confirmation_sent = True
    booking.save(update_fields=['confirmation_sent'])
    return True
