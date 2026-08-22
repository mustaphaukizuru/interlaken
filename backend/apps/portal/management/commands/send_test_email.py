"""
send_test_email — verify SMTP + branding end to end (BACKLOG P1-C8).

    python manage.py send_test_email --to someone@interlaken.com.mx

Sends one branded message through ``apps.portal.services.send_email`` and
reports the configured backend/host and the result. Exit code 1 on failure so
the deploy runbook can gate on it.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.portal.services import send_email


class Command(BaseCommand):
    help = 'Send a branded test email to verify SMTP configuration.'

    def add_arguments(self, parser):
        parser.add_argument('--to', required=True, help='Recipient address')

    def handle(self, *args, **opts):
        to = opts['to']
        self.stdout.write(
            f"backend={settings.EMAIL_BACKEND} host={settings.EMAIL_HOST}:{settings.EMAIL_PORT} "
            f"from={settings.DEFAULT_FROM_EMAIL} reply_to={getattr(settings, 'CONTACT_EMAIL', '')}"
        )
        ok = send_email(
            'Prueba de correo - Colegio Interlaken',
            'Este es un mensaje de prueba del portal.\n\n'
            'Si lo recibe con el encabezado de colores y el pie del colegio, el correo HTML funciona; '
            'si lo ve en texto plano, el cliente no muestra HTML pero el envío es correcto.',
            [to],
            fail_silently=False,
            cta_url=f"{(settings.FRONTEND_URL or '').rstrip('/')}/login",
            cta_label='Abrir el portal',
        )
        if not ok:
            raise CommandError(f'No se pudo enviar a {to}')
        self.stdout.write(self.style.SUCCESS(f'Enviado a {to}'))
