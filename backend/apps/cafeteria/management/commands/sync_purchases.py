"""
sync_purchases — poll Loyverse receipts → cafeteria transactions + parent alerts.

Scheduled by .github/workflows/loyverse-sync.yml; the Loyverse webhook
(LoyverseWebhookView) delivers the same receipts in real time, so this poll is
the safety net rather than the primary path. Idempotent: each receipt maps to a
unique ``CafeteriaTransaction`` so re-running never duplicates a purchase or
re-notifies a parent. Loyverse/credential failures are logged and reported, not
fatal, so a transient hiccup never fails the scheduled run.

``--watch`` loops in-process (dev/demo only — cron can't poll faster than 1 min):

    python manage.py sync_purchases --watch --interval 5
"""
import time

from django.core.management.base import BaseCommand

from apps.cafeteria.services import LoyverseError, sync_purchases


class Command(BaseCommand):
    help = 'Poll Loyverse receipts and record cafeteria purchases + parent notifications.'

    def add_arguments(self, parser):
        parser.add_argument('--watch', action='store_true',
                            help='Loop forever, re-polling every --interval seconds (dev/demo).')
        parser.add_argument('--interval', type=int, default=30,
                            help='Seconds between polls in --watch mode (default 30).')

    def handle(self, *args, **options):
        if not options['watch']:
            self._run_once()
            return

        interval = max(1, options['interval'])
        self.stdout.write(self.style.WARNING(
            f'Watching Loyverse purchases every {interval}s - Ctrl-C to stop. '
            f'(Production uses cron, min 1 min.)'))
        try:
            while True:
                self._run_once(quiet=True)
                time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write('\nStopped.')

    def _run_once(self, quiet=False):
        try:
            result = sync_purchases()
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'sync_purchases could not reach Loyverse: {e}'))
            return

        if result['created'] or not quiet:
            self.stdout.write(self.style.SUCCESS(
                f"Purchase sync: {result['receipts']} receipt(s) polled, "
                f"{result['created']} new, {result['notified']} notification(s), "
                f"{result['unmatched']} unmatched, {result['skipped']} no-wallet "
                f"across {result['students']} linked student(s)."))
