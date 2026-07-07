"""
sync_calendar — create Google Calendar events for bookings that missed theirs.

Bookings are fail-soft: if calendar was unconfigured or Google was unreachable
when the booking was made, the booking still succeeded with an empty
``google_event_id``. This cron command sweeps those active bookings and creates
their events now, and (for tidiness) removes events left on cancelled bookings.

cPanel cron target (see DEPLOYMENT.md §3), suggested every 15 minutes. If calendar
is unconfigured the command is a clean no-op, so it's safe to schedule always.
"""
from django.core.management.base import BaseCommand

from apps.bookings.models import Booking
from apps.bookings.services import calendar


class Command(BaseCommand):
    help = 'Create Google Calendar events for bookings that failed calendar creation.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit', type=int, default=200,
            help='Max bookings to process per run (default: 200).',
        )

    def handle(self, *args, **options):
        if not calendar.is_configured():
            self.stdout.write(self.style.WARNING(
                'Google Calendar is not configured (GOOGLE_CALENDAR_ID / '
                'GOOGLE_CALENDAR_SA_KEY). Nothing to do.'
            ))
            return

        limit = options['limit']
        active_statuses = [
            Booking.Status.PENDING,
            Booking.Status.CONFIRMED,
            Booking.Status.ATTENDED,
        ]

        # 1) Active bookings missing an event → create it.
        missing = (Booking.objects
                   .select_related('slot')
                   .filter(status__in=active_statuses, google_event_id='')
                   [:limit])
        created = failed = 0
        for booking in missing:
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
            f'Calendar sync complete: {created} created, {failed} failed, '
            f'{removed} stale events removed.'
        ))
