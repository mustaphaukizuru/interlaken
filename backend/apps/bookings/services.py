"""
bookings/services.py — Notifications for visit bookings.

Uses ``portal.services.notify`` when that helper exists (Prompt 08); otherwise
falls back to Django's ``send_mail`` (console backend in dev). No external APIs
here — Google Calendar/WhatsApp arrive in Prompts 13–14.
"""
from django.conf import settings
from django.core.mail import send_mail

try:  # pragma: no cover - optional dependency on Prompt 08
    from apps.portal.services import notify as _portal_notify
except Exception:  # ImportError or module missing
    _portal_notify = None


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

    if _portal_notify is not None:
        try:
            _portal_notify(subject=subject, message=body, recipients=recipients)
        except Exception:
            pass
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
