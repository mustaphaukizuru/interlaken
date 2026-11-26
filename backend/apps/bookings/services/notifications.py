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

from .ics import build_ics

logger = logging.getLogger(__name__)


def _visit_type_label(booking):
    return booking.slot.get_visit_type_display()


VISIT_REASON = 'Recibe este correo porque agendó una visita al Colegio Interlaken.'


def _visit_details(booking):
    from apps.portal.emailing import long_date

    slot = booking.slot
    return [
        ('Tipo de visita', _visit_type_label(booking)),
        ('Fecha', long_date(slot.date)),
        ('Horario', f'{slot.start_time:%H:%M} a {slot.end_time:%H:%M}'),
        ('Lugar', slot.location or 'Campus Interlaken'),
        ('Asistentes', str(booking.num_attendees)),
    ]


def _visit_email(booking, subject, body, content, *, restore: bool = False):
    """The branded email plus the .ics invite (never blocks the send if the .ics fails).
    ``restore=True`` attaches the event republished after a cancellation."""
    from apps.portal.services import build_email

    email = build_email(subject, body, [booking.parent_email], reply_to=settings.ADMISSIONS_EMAIL,
                        content=content)
    try:
        email.attach('visita-interlaken.ics', build_ics(booking, restore=restore),
                     'text/calendar; charset=utf-8; method=PUBLISH')
    except Exception as exc:  # pragma: no cover - defensive; never block on ics
        logger.warning('No se pudo generar el .ics para la reserva %s: %s', booking.pk, exc)
    return email


def confirmation_content(booking):
    """``(subject, EmailContent)`` of the confirmation (pure; render_emails previews it)."""
    from apps.portal.emailing import EmailContent

    content = EmailContent(
        category='Visitas', tone='success',
        title='Su visita al Colegio Interlaken está confirmada',
        intro=(f'Estimado/a {booking.parent_name}: registramos su visita. Le compartimos los datos '
               f'y una invitación de calendario para agregarla a su agenda con un toque.'),
        details=_visit_details(booking),
        note='¿Necesita cancelar o cambiar el horario? Responda a este correo o escríbanos por WhatsApp.',
        signoff='¡Le esperamos!\nEquipo de Admisiones',
        reason=VISIT_REASON,
    )
    return f'Visita confirmada: {_visit_type_label(booking)}', content


def reminder_content(booking):
    """``(subject, EmailContent)`` of the day-before reminder (pure)."""
    from apps.portal.emailing import EmailContent

    content = EmailContent(
        category='Visitas',
        title='Su visita al Colegio Interlaken es mañana',
        intro=f'Estimado/a {booking.parent_name}: le recordamos su visita programada para mañana.',
        details=_visit_details(booking),
        note='Si ya no puede asistir, avísenos respondiendo a este correo.',
        signoff='¡Le esperamos!\nEquipo de Admisiones',
        reason=VISIT_REASON,
    )
    return 'Recordatorio: su visita es mañana', content


def cancellation_content(booking):
    """``(subject, EmailContent)`` of the cancellation sent when the school
    cancels a visit from the console (pure; render_emails can preview it)."""
    from apps.portal.emailing import EmailContent, long_date

    slot = booking.slot
    content = EmailContent(
        category='Visitas', tone='warning',
        title='Su visita fue cancelada',
        intro=(f'Estimado/a {booking.parent_name}: su visita al Colegio Interlaken del '
               f'{long_date(slot.date)} a las {slot.start_time:%H:%M} quedó cancelada.'),
        details=_visit_details(booking),
        note=('Si desea agendar otra fecha, responda a este correo o escríbanos por WhatsApp. '
              'Con gusto le ayudamos.'),
        signoff='Equipo de Admisiones',
        reason=VISIT_REASON,
    )
    return 'Su visita al Colegio Interlaken fue cancelada', content


def send_booking_cancellation(booking):
    """Tell the family their visit was cancelled. When the confirmation went
    out (it carries the .ics invite), attach the cancellation of that same
    event (same UID, ``METHOD:CANCEL``) so it leaves their calendar.

    Best-effort like the confirmation: never raises, returns True when sent.
    """
    from apps.portal.services import build_email

    subject, content = cancellation_content(booking)
    email = build_email(subject, '', [booking.parent_email], reply_to=settings.ADMISSIONS_EMAIL,
                        content=content)
    if booking.confirmation_sent:
        try:
            email.attach('visita-interlaken.ics', build_ics(booking, cancel=True),
                         'text/calendar; charset=utf-8; method=CANCEL')
        except Exception as exc:  # pragma: no cover - defensive; never block on ics
            logger.warning('No se pudo generar el .ics de cancelación de la reserva %s: %s',
                           booking.pk, exc)
    delivered = bool(email.send(fail_silently=True))
    if not delivered:
        logger.warning('No se pudo enviar la cancelación de la reserva %s a %s',
                       booking.pk, booking.parent_email)
    return delivered


def restored_content(booking):
    """``(subject, EmailContent)`` sent when the school undoes a cancellation
    (owner 2026-11-26, «Deshacer cancelación»; pure, render_emails previews it)."""
    from apps.portal.emailing import EmailContent, long_date

    slot = booking.slot
    content = EmailContent(
        category='Visitas', tone='success',
        title='Su visita sigue en pie',
        intro=(f'Estimado/a {booking.parent_name}: le escribimos por la cancelación que recibió de '
               f'su visita del {long_date(slot.date)} a las {slot.start_time:%H:%M}. Fue un error '
               f'nuestro y su visita sigue en pie, con los mismos datos. Le pedimos una disculpa.'),
        details=_visit_details(booking),
        note=('Le adjuntamos de nuevo la invitación de calendario para que la visita vuelva a su '
              'agenda. Si ya no puede asistir, responda a este correo o escríbanos por WhatsApp.'),
        signoff='¡Le esperamos!\nEquipo de Admisiones',
        reason=VISIT_REASON,
    )
    return f'Su visita sigue en pie: {_visit_type_label(booking)}', content


def send_booking_restored(booking):
    """Tell the family a cancelled visit is back, with the .ics of the SAME
    event restored (``build_ics(restore=True)``: same UID, a SEQUENCE above
    the cancellation's) so a calendar that dropped it adds it again.

    Best-effort like the confirmation: never raises, returns True when sent.
    """
    subject, content = restored_content(booking)
    email = _visit_email(booking, subject, '', content, restore=True)
    delivered = bool(email.send(fail_silently=True))
    if not delivered:
        logger.warning('No se pudo enviar el aviso de visita restablecida de la reserva %s a %s',
                       booking.pk, booking.parent_email)
    return delivered


def send_booking_confirmation(booking):
    """Send a Spanish confirmation email (with a .ics calendar invite) for a
    booking and flag it as sent.

    Best-effort: email failures never block the booking (fail_silently). The
    .ics attachment lets the parent add the visit to their calendar in one tap;
    if generation ever fails, the email still goes out without it.
    """
    subject, content = confirmation_content(booking)
    email = _visit_email(booking, subject, '', content)

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
    subject, content = reminder_content(booking)
    email = _visit_email(booking, subject, '', content)

    delivered = bool(email.send(fail_silently=True))
    if delivered:
        booking.reminder_sent = True
        booking.save(update_fields=['reminder_sent'])
    else:
        logger.warning('No se pudo enviar el recordatorio de la reserva %s a %s',
                       booking.pk, booking.parent_email)
    return delivered
