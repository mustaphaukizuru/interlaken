"""
send_booking_reminders — email a day-before reminder (with the .ics invite) to
every family whose visit is TOMORROW and who hasn't been reminded yet.

    python manage.py send_booking_reminders            # send
    python manage.py send_booking_reminders --dry-run  # preview, send nothing
    python manage.py send_booking_reminders --date 2026-07-20   # specific day

cPanel cron target (see DEPLOYMENT.md §3), suggested daily at 08:00. Idempotent:
``reminder_sent`` guards against a double-send, so re-running is safe. Only
active bookings (pending/confirmed) are reminded — cancelled/attended/no-show
are skipped.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.bookings.models import Booking
from apps.bookings.services import send_booking_reminder


class Command(BaseCommand):
    help = 'Email day-before reminders for tomorrow\'s visits (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='List who would be reminded without sending.')
        parser.add_argument('--date', help='Target visit date YYYY-MM-DD '
                                           '(default: tomorrow, school-local).')

    def handle(self, *args, **options):
        if options.get('date'):
            from datetime import date
            target = date.fromisoformat(options['date'])
        else:
            target = timezone.localdate() + timedelta(days=1)

        bookings = (Booking.objects
                    .filter(slot__date=target, reminder_sent=False,
                            status__in=[Booking.Status.PENDING,
                                        Booking.Status.CONFIRMED])
                    .select_related('slot')
                    .order_by('slot__start_time'))

        dry = options['dry_run']
        sent = failed = 0
        for b in bookings:
            if dry:
                self.stdout.write(
                    f"  {b.slot.start_time:%H:%M}  {b.parent_name}  <{b.parent_email}>")
                continue
            try:
                if send_booking_reminder(b):
                    sent += 1
                else:
                    # Silent SMTP failure — reminder_sent stays False, so the
                    # next run retries. Report it instead of miscounting a send.
                    failed += 1
                    self.stderr.write(self.style.ERROR(
                        f"  ! {b.parent_email}: envío fallido (reintentará)"))
            except Exception as e:  # pragma: no cover - fail-soft per booking
                failed += 1
                self.stderr.write(self.style.ERROR(f"  ! {b.parent_email}: {e}"))

        head = 'SIMULACION' if dry else 'ENVIADO'
        style = self.style.WARNING if dry else self.style.SUCCESS
        self.stdout.write(style(
            f'[{head}] Visitas para {target:%d/%m/%Y}: {bookings.count()} '
            f'por recordar' + ('' if dry else f' · {sent} enviados, {failed} fallidos') + '.'))
