"""
refresh_loyverse — one-shot: refresh roster links + balances + purchases.

Use when Loyverse already has the school data and you want the app caught up
as fast as possible (onboarding, after credential rotation, or manual ops)::

    python manage.py refresh_loyverse
    python manage.py refresh_loyverse --import-students
    python manage.py refresh_loyverse --watch --interval 30

Safe / idempotent: import updates existing students, link is a no-op when already
linked, balance seed only fills never-seeded rows, purchase sync never
duplicates receipts.
"""
import time

from django.core.management.base import BaseCommand

from apps.cafeteria.services import (
    LoyverseError,
    get_all_customers,
    import_students_from_loyverse,
    link_students_to_loyverse,
    sync_all_balances,
    sync_purchases,
)


class Command(BaseCommand):
    help = 'Refresh Loyverse roster links, opening balances, and purchase poll.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--import-students',
            action='store_true',
            help='Also create/update students from Loyverse customers (ci*@ emails).',
        )
        parser.add_argument(
            '--watch',
            action='store_true',
            help='After the initial refresh, keep polling purchases every --interval seconds.',
        )
        parser.add_argument(
            '--interval',
            type=int,
            default=30,
            help='Seconds between purchase polls in --watch mode (default 30).',
        )

    def handle(self, *args, **options):
        try:
            customers = get_all_customers()
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'Loyverse unreachable: {e}'))
            return

        self.stdout.write(f'Loyverse customers fetched: {len(customers)}')

        if options['import_students']:
            report = import_students_from_loyverse(
                customers, commit=True, seed_balances=True,
            )
            self.stdout.write(self.style.SUCCESS(
                f"Import: {report['created']} created, {report['updated']} updated, "
                f"{report['candidates']} students "
                f"(skipped non-students: {report['skipped_non_student']})."
            ))

        linked = link_students_to_loyverse(customers, commit=True)
        self.stdout.write(self.style.SUCCESS(
            f"Link: {linked['linked']} newly linked, "
            f"{linked['already_linked']} already linked, "
            f"{len(linked['unmatched_students'])} unmatched students."
        ))

        balances = sync_all_balances()
        self.stdout.write(self.style.SUCCESS(
            f"Balances: {balances['synced']} ok, {balances['failed']} failed."
        ))

        self._poll_purchases()

        if not options['watch']:
            return

        interval = max(5, options['interval'])
        self.stdout.write(self.style.WARNING(
            f'Watching purchases every {interval}s — Ctrl-C to stop.'
        ))
        try:
            while True:
                time.sleep(interval)
                self._poll_purchases(quiet=True)
        except KeyboardInterrupt:
            self.stdout.write('\nStopped.')

    def _poll_purchases(self, quiet=False):
        try:
            result = sync_purchases()
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'Purchase sync failed: {e}'))
            return

        if result['created'] or not quiet:
            self.stdout.write(self.style.SUCCESS(
                f"Purchases: {result['receipts']} receipt(s) polled, "
                f"{result['created']} new, {result['notified']} notification(s) "
                f"across {result['students']} linked student(s)."
            ))
