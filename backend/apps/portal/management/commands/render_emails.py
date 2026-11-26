"""
render_emails: preview every email family as HTML + text files (dev only).

    python manage.py render_emails                 # → <temp>/interlaken-email-previews
    python manage.py render_emails --out D:/tmp/correos

Renders a representative sample of each email the platform sends (cafetería
and payment notices, urgent alerts, comunicados, admissions, visits, the
family link code, the notify-email confirmation) with FAKE data and unsaved
objects, then writes ``<slug>.html``, ``<slug>.txt`` and an ``index.html``.

Safety: it refuses to run when ``DEBUG`` is False unless ``--force``; it never
calls ``send``: builders that send in place run with ``send_email`` replaced by
a recorder, under the locmem backend, and the command fails if anything still
reached an outbox. Nothing is written to the database by the builders.
"""
from __future__ import annotations

import html as html_lib
import tempfile
from dataclasses import dataclass
from datetime import date, time, timedelta
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.core import mail
from django.core.management.base import BaseCommand, CommandError
from django.test.utils import override_settings
from django.utils import timezone

from apps.portal.emailing import (
    EmailContent,
    money,
    notification_content,
    render_html,
    render_text,
)

LOCMEM = 'django.core.mail.backends.locmem.EmailBackend'
DEFAULT_OUT = Path(tempfile.gettempdir()) / 'interlaken-email-previews'
MAX_HTML_BYTES = 100 * 1024  # Gmail clips bigger messages
MAX_SUBJECT = 50


@dataclass
class Sample:
    slug: str
    group: str
    subject: str
    content: EmailContent
    reply_to: str = ''
    # Subjects this phase rewrote (D13): checked for length and names by the tests.
    checked_subject: bool = True

    def html(self) -> str:
        return render_html(self.subject, self.content, reply_to=self.reply_to)

    def text(self) -> str:
        return render_text(self.content, reply_to=self.reply_to)


# ── fake people (never real data) ─────────────────────────────────────────
def _family():
    from apps.accounts.models import StudentProfile, User

    parent = User(email='mama.prueba@ejemplo.test', first_name='Laura', last_name='Prueba Ejemplo',
                  role=User.Role.PARENT)
    child_user = User(email='ci00000@alumnos.interlaken.edu.mx', first_name='Carla',
                      last_name='Ramos Terrazas', role=User.Role.STUDENT,
                      notify_email='papa.prueba@ejemplo.test')
    child = StudentProfile(user=child_user, student_id='CI00000', grade='3° Primaria', group='A')
    staff = User(email='caja@ejemplo.test', first_name='Caja', last_name='Prueba', role=User.Role.STAFF)
    return parent, child_user, child, staff


def _registration():
    from apps.admissions.models import Registration

    return Registration(
        child_first_name='Ana María', child_last_name='Pérez Gil', level='primaria',
        grade_applying='2° Primaria', cycle='2027-2028', parent1_name='Marta Pérez',
        parent1_email='marta.prueba@ejemplo.test', parent1_phone='5555555555',
        contact_name='Marta Pérez', contact_email='marta.prueba@ejemplo.test',
        contact_phone='5555555555', contact_relationship='Mamá', signed_name='Marta Pérez Gil',
        invite_expires_at=timezone.now() + timedelta(days=14),
    )


def _pre_registration():
    from apps.admissions.models import PreRegistration

    return PreRegistration(
        child_first_name='Leo', child_last_name='Prueba Ejemplo', level='secundaria',
        grade_applying='1° Secundaria', parent_name='Roberto Prueba', parent_email='roberto.prueba@ejemplo.test',
        parent_phone='5555555555', wants_visit=True,
    )


def _booking():
    from apps.bookings.models import AvailabilitySlot, Booking

    slot = AvailabilitySlot(date=timezone.localdate() + timedelta(days=3), start_time=time(9, 0),
                            end_time=time(10, 0), capacity=8, location='Campus Interlaken')
    return Booking(slot=slot, parent_name='Sofía Prueba', parent_email='sofia.prueba@ejemplo.test',
                   parent_phone='5555555555', num_attendees=2)


# ── samples ───────────────────────────────────────────────────────────────
def _notification_samples(parent, child_user, staff) -> list[Sample]:
    from apps.portal.emailing import person_initial

    short = person_initial(child_user)
    first = child_user.first_name
    out = [
        Sample('cafeteria-compra', 'Notificaciones', 'Compra en cafetería', notification_content(
            user=parent, notif_type='cafeteria', title='Compra en cafetería', message='',
            details=[('Alumno', short), ('Compra', money('45')), ('Detalle', 'Torta de jamón'),
                     ('Fecha', '21 de noviembre de 2026, 10:42')],
            highlight=('Saldo actual', money('4180')),
            intro=f'{first} hizo una compra de {money("45")} en la cafetería.')),
        Sample('cafeteria-recarga-aplicada', 'Notificaciones', 'Recarga aplicada', notification_content(
            user=parent, notif_type='cafeteria', title='Recarga aplicada', message='', tone='success',
            details=[('Alumno', short), ('Recarga', money('500'))],
            highlight=('Saldo actual', money('612.50')),
            intro=f'La recarga de {money("500")} para {first} ya está disponible en la cafetería.')),
        Sample('pago-recibido', 'Notificaciones', 'Pago de recarga recibido', notification_content(
            user=parent, notif_type='payment', title='Pago de recarga recibido', message='', tone='success',
            details=[('Alumno', short), ('El saldo se actualiza', 'lunes 23 de noviembre a las 7:30 a.m.'),
                     ('Folio', '815')],
            highlight=('Monto pagado', money('500')),
            intro=f'Recibimos su pago para la cafetería de {first}. El saldo se actualizará el lunes '
                  f'23 de noviembre a las 7:30 a.m.')),
        Sample('pago-no-completado', 'Notificaciones', 'Recarga de cafetería no completada', notification_content(
            user=parent, notif_type='payment', title='Recarga de cafetería no completada', message='',
            tone='danger', cta_label='Intentar de nuevo', url='/portal/cafeteria',
            details=[('Alumno', short), ('Monto', money('500')), ('Cargo', 'No se realizó ningún cargo')],
            intro=f'No fue posible procesar la recarga de {money("500")} para {short}. No se realizó '
                  f'ningún cargo a su saldo. Puede intentarlo nuevamente desde el portal.')),
        Sample('saldo-bajo', 'Notificaciones', 'Saldo bajo en cafetería', notification_content(
            user=parent, notif_type='warning', title='Saldo bajo en cafetería', message='', tone='warning',
            url='/portal/cafeteria', cta_label='Recargar saldo',
            highlight=('Saldo actual', money('18')),
            details=[('Alumno', short), ('Saldo mínimo configurado', money('50'))],
            intro=f'El saldo de cafetería de {first} quedó por debajo del mínimo. Le recomendamos '
                  f'recargar para evitar contratiempos a la hora del almuerzo.')),
        Sample('aviso-del-colegio', 'Notificaciones', 'Credenciales listas', notification_content(
            user=parent, notif_type='info', title='Credenciales listas',
            message='Las credenciales del ciclo escolar ya se pueden recoger en recepción.')),
        Sample('aviso-interno-staff', 'Notificaciones', 'Página lista para revisar', notification_content(
            user=staff, notif_type='info', title='Página lista para revisar',
            message='La página «Admisiones» tiene cambios esperando su aprobación.'),
            checked_subject=False),
    ]
    comunicado = notification_content(
        user=parent, notif_type='info', title='Festival de invierno', comunicado=True,
        url='/portal/notificaciones/1',
        message=('El viernes 12 de diciembre celebramos el festival de invierno en el patio central. '
                 'Las puertas abren a las 9:00.'))
    out.append(Sample('comunicado', 'Comunicados', 'Festival de invierno', comunicado))
    # The notice family with its optional blocks (nothing sends these yet: preview only).
    rich = notification_content(
        user=parent, notif_type='info', title='Festival de invierno', comunicado=True,
        url='/portal/notificaciones/1',
        message='Le compartimos lo importante del festival de invierno de este año.')
    rich.hero_image_url = 'https://interlaken.edu.mx/assets/email/logo.png'
    rich.hero_image_alt = 'Alumnos de primaria en el festival de invierno'
    rich.stats = [('Fecha', '12 dic'), ('Hora', '9:00'), ('Lugar', 'Patio central')]
    rich.cards = [
        {'title': 'Qué traer', 'text': 'Ropa abrigadora y una bebida en termo.'},
        {'title': 'Estacionamiento', 'text': 'Abrimos el acceso por Av. de los Reyes.',
         'link': 'https://interlaken.edu.mx/contacto', 'link_label': 'Ver el mapa'},
    ]
    out.append(Sample('comunicado-con-bloques', 'Comunicados', 'Festival de invierno', rich))
    emergency = notification_content(
        user=parent, notif_type='warning', title='Suspensión de clases hoy', comunicado=True,
        url='/portal/notificaciones/2',
        message='Por un corte de agua en la zona, hoy no hay clases. Recoja a su hijo(a) antes de las 11:00.')
    out.append(Sample('aviso-urgente', 'Comunicados', 'Suspensión de clases hoy', emergency))
    return out


def _admissions_samples(capture) -> list[Sample]:
    from apps.admissions import ficha
    from apps.admissions import services as adm
    from apps.admissions import views as adm_views
    from apps.admissions.process_messages import Message, message_content

    reply = getattr(settings, 'ADMISSIONS_EMAIL', '') or getattr(settings, 'CONTACT_EMAIL', '')
    reg = _registration()
    pre = _pre_registration()
    link = f"{(settings.FRONTEND_URL or 'https://interlaken.edu.mx').rstrip('/')}/pre-registro?rid=0&token=muestra"
    out = []

    for slug, builder in (('pre-registro-recibido', adm_views.pre_registration_received_email),
                          ('pre-registro-aviso-interno', adm_views.pre_registration_office_email)):
        subject, content = builder(pre)
        out.append(Sample(slug, 'Admisiones', subject, content, reply))
    for slug, call in (
        ('ficha-iniciada', lambda: ficha.email_ficha_started(reg, link)),
        ('ficha-aviso-interno', lambda: ficha.notify_office_ficha_started(reg)),
        ('ficha-continuar', lambda: ficha.email_resume_link(reg, link, reg.contact_email)),
        ('ficha-recibida', lambda: ficha.email_ficha_submitted(reg)),
        ('invitacion-ficha', lambda: adm.email_invite(reg, link)),
    ):
        subject, content = capture(call)
        out.append(Sample(slug, 'Admisiones', subject, content, reply))

    reg.status = reg.Status.APPROVED
    out.append(Sample('inscripcion-aprobada', 'Admisiones', *capture(lambda: adm.email_registration_outcome(reg)),
                      reply))
    reg.status = reg.Status.REJECTED
    out.append(Sample('inscripcion-actualizacion', 'Admisiones',
                      *capture(lambda: adm.email_registration_outcome(reg)), reply))

    from apps.admissions.models import RegistrationDocument
    docs = [RegistrationDocument(registration=reg, doc_type=RegistrationDocument.DocType.choices[0][0],
                                 review_note='La imagen no se lee completa.')]
    out.append(Sample('documento-por-corregir', 'Admisiones',
                      *capture(lambda: adm.email_rejected_documents(reg, docs)), reply))
    subject, content = adm_views.documents_request_email(reg, link, ['Acta de nacimiento', 'CURP del alumno'])
    out.append(Sample('documentos-solicitud', 'Admisiones', subject, content, reply))
    subject, content = adm_views.registration_received_email(reg)
    out.append(Sample('inscripcion-recibida', 'Admisiones', subject, content, reply))

    msg = Message('exam_result_accepted', 'Resultado del examen de admisión', 'Resultado del examen de admisión',
                  ('¡Felicidades, Marta Pérez! Ana María fue aceptado/a en el Colegio Interlaken.\n\n'
                   f'Llene la ficha de inscripción con su enlace personal: {link} (vence el 5 de diciembre de 2026).'),
                  link=link, cta_label='Llenar la ficha de inscripción', tone='success')
    out.append(Sample('resultado-examen', 'Admisiones', msg.subject, message_content(msg), reply))
    return out


def _visit_samples() -> list[Sample]:
    from apps.bookings.services.notifications import confirmation_content, reminder_content
    from apps.bookings.services.staff_alerts import cancelled_booking_content, new_booking_content

    reply = getattr(settings, 'ADMISSIONS_EMAIL', '') or getattr(settings, 'CONTACT_EMAIL', '')
    booking = _booking()
    # The school's own alerts (2026-11-26) reply to the family.
    return [Sample('visita-confirmada', 'Visitas', *confirmation_content(booking), reply),
            Sample('visita-recordatorio', 'Visitas', *reminder_content(booking), reply),
            Sample('visita-nueva-escuela', 'Visitas', *new_booking_content(booking), booking.parent_email),
            Sample('visita-cancelada-escuela', 'Visitas', *cancelled_booking_content(booking),
                   booking.parent_email)]


def _account_samples(child_user, child) -> list[Sample]:
    from apps.accounts.family_self import _code_email
    from apps.accounts.notify_email import confirmation_email, make_token

    requester = child_user.__class__(email='mama.prueba@ejemplo.test')
    subject, content = _code_email(child, requester, '482915')
    out = [Sample('codigo-hermanos', 'Cuenta', subject, content)]
    subject, content = confirmation_email(child_user, make_token(child_user))
    out.append(Sample('confirmar-correo-avisos', 'Cuenta', subject, content))
    return out


def build_samples() -> list[Sample]:
    """Every sample, built without sending anything. Raises if a send slipped through."""
    captured: list[tuple[str, EmailContent]] = []

    def recorder(subject, message='', recipients=None, **kwargs):
        captured.append((subject, kwargs.get('content')))
        return True

    def capture(call):
        before = len(captured)
        call()
        assert len(captured) == before + 1, 'the builder did not produce exactly one email'
        subject, content = captured[-1]
        if content is None:
            raise CommandError(f'{subject!r} has no EmailContent')
        return subject, content

    outbox_before = len(getattr(mail, 'outbox', []) or [])
    with override_settings(EMAIL_BACKEND=LOCMEM), \
            mock.patch('apps.portal.services.send_email', side_effect=recorder), \
            mock.patch('apps.admissions.services.send_email', side_effect=recorder):
        parent, child_user, child, staff = _family()
        samples = (_notification_samples(parent, child_user, staff)
                   + _admissions_samples(capture)
                   + _visit_samples()
                   + _account_samples(child_user, child))
    if len(getattr(mail, 'outbox', []) or []) != outbox_before:
        raise CommandError('An email reached the outbox: render_emails must never send.')
    return samples


def _index(samples, sizes) -> str:
    rows = ''.join(
        f'<tr><td>{html_lib.escape(s.group)}</td><td><a href="{s.slug}.html">{html_lib.escape(s.subject)}</a></td>'
        f'<td>{len(s.subject)}</td><td>{s.content.family}</td><td>{sizes[s.slug] / 1024:.1f} KB</td>'
        f'<td><a href="{s.slug}.txt">texto</a></td></tr>'
        for s in samples)
    return ('<!doctype html><html lang="es"><meta charset="utf-8"><title>Correos de muestra</title>'
            '<body style="font-family:system-ui,sans-serif;padding:24px;color:#1A1130;background:#F5F4FA">'
            f'<h1>Correos de muestra ({len(samples)})</h1><p>Datos ficticios. Generado {date.today():%Y-%m-%d}.</p>'
            '<table cellpadding="6" style="border-collapse:collapse;background:#fff">'
            '<tr><th>Grupo</th><th>Asunto</th><th>Caracteres</th><th>Familia</th><th>HTML</th><th></th></tr>'
            f'{rows}</table></body></html>')


class Command(BaseCommand):
    help = 'Render a sample of every email family to HTML and text files (development only; never sends).'

    def add_arguments(self, parser):
        parser.add_argument('--out', default=str(DEFAULT_OUT),
                            help=f'Output folder (default: {DEFAULT_OUT}).')
        parser.add_argument('--force', action='store_true',
                            help='Run even when DEBUG is False (still never sends).')

    def handle(self, *args, **opts):
        if not settings.DEBUG and not opts['force']:
            raise CommandError('render_emails is a development tool: DEBUG is False. '
                               'Use --force only on a machine without real data.')
        out = Path(opts['out'])
        out.mkdir(parents=True, exist_ok=True)
        samples = build_samples()
        sizes, warnings = {}, []
        for s in samples:
            body = s.html()
            sizes[s.slug] = len(body.encode('utf-8'))
            (out / f'{s.slug}.html').write_text(body, encoding='utf-8')
            (out / f'{s.slug}.txt').write_text(f'Asunto: {s.subject}\n\n{s.text()}', encoding='utf-8')
            if sizes[s.slug] >= MAX_HTML_BYTES:
                warnings.append(f'{s.slug}: HTML of {sizes[s.slug]} bytes (Gmail clips at ~102 KB)')
            if s.checked_subject and len(s.subject) > MAX_SUBJECT:
                warnings.append(f'{s.slug}: subject of {len(s.subject)} characters')
        (out / 'index.html').write_text(_index(samples, sizes), encoding='utf-8')
        for s in samples:
            self.stdout.write(f'{s.group:<14} {s.slug:<28} {sizes[s.slug] / 1024:5.1f} KB  {s.subject}')
        for w in warnings:
            self.stdout.write(self.style.WARNING(w))
        self.stdout.write(self.style.SUCCESS(f'{len(samples)} emails written to {out}'))
