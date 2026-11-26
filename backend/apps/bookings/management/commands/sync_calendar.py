"""
sync_calendar — create Google Calendar events for bookings that missed theirs.

Bookings are fail-soft: if calendar was unconfigured or Google was unreachable
when the booking was made, the booking still succeeded with an empty
``google_event_id``. This cron command sweeps those standing bookings from today
on and creates their events now (``--include-past`` also does earlier days), and
(for tidiness) removes events left on cancelled bookings.

When the calendar is not configured it says WHY (which variable, never its
value; ``calendar.diagnose``) and exits cleanly, so the daily log shows the
problem instead of «nothing to do» (production ran like that for months).

``--check`` only verifies the setup: the variables, the key file and whether the
service account may write to the calendar. Run it after following
docs/GOOGLE_CALENDAR.md. It writes no event.

Scheduled by deploy/crontab.example (daily, 06:15).
"""
import logging

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.bookings.models import Booking
from apps.bookings.services import calendar
from apps.core.plurals import count

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = ('Crea en Google Calendar los eventos de las visitas que no lo tienen. '
            '--check solo revisa la configuración y el acceso al calendario.')

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit', type=int, default=200,
            help='Máximo de reservas por ejecución (200).',
        )
        parser.add_argument(
            '--include-past', action='store_true',
            help='También las visitas de días pasados (normalmente solo de hoy en adelante).',
        )
        parser.add_argument(
            '--check', action='store_true',
            help='Solo revisa la configuración y el acceso al calendario; no crea eventos.',
        )

    def handle(self, *args, **options):
        problems = calendar.diagnose()
        if problems:
            if not calendar.is_attempted() and not options['check']:
                self.stdout.write(self.style.WARNING(
                    'Google Calendar no está configurado (GOOGLE_CALENDAR_ID y GOOGLE_CALENDAR_SA_KEY '
                    'vacíos). Nada que hacer.'))
                return
            self.stdout.write(self.style.WARNING(
                'Google Calendar no está configurado: las visitas no llegan al calendario.'))
            for problem in problems:
                self.stdout.write(f'  - {problem}')
            self.stdout.write(f'  Cómo configurarlo: {calendar.GUIDE}')
            logger.warning('sync_calendar: Google Calendar no está configurado. %s', ' '.join(problems))
            if options['check']:
                raise CommandError('La configuración de Google Calendar no está completa.')
            return

        if options['check']:
            ok, message = calendar.check_access()
            email = calendar.service_account_email()
            if email:
                self.stdout.write(f'Cuenta de servicio: {email}')
            if not ok:
                raise CommandError(message)
            self.stdout.write(self.style.SUCCESS(message))
            return

        limit = options['limit']
        active_statuses = [
            Booking.Status.PENDING,
            Booking.Status.CONFIRMED,
            Booking.Status.ATTENDED,
        ]

        # 1) Standing bookings missing an event → create it. From today on by
        #    default: the first sync after connecting the calendar must not fill
        #    it with months of past visits.
        missing = (Booking.objects
                   .select_related('slot')
                   .filter(status__in=active_statuses, google_event_id=''))
        if not options['include_past']:
            missing = missing.filter(slot__date__gte=timezone.localdate())
        created = failed = 0
        for booking in missing.order_by('slot__date', 'slot__start_time')[:limit]:
            if calendar.sync_booking_created(booking):
                created += 1
            else:
                failed += 1

        # 2) Cancelled bookings that still carry an event → remove it.
        stale = (Booking.objects
                 .filter(status=Booking.Status.CANCELLED)
                 .exclude(google_event_id='')
                 [:limit])
        removed = 0
        for booking in stale:
            if calendar.sync_booking_cancelled(booking):
                removed += 1

        self.stdout.write(self.style.SUCCESS(
            f'Calendario sincronizado: {count(created, "evento creado", "eventos creados")}, '
            f'{count(failed, "fallido", "fallidos")}, '
            f'{count(removed, "evento de visita cancelada quitado", "eventos de visitas canceladas quitados")}.'
        ))
