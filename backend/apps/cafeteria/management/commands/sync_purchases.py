"""
sync_purchases — poll Loyverse receipts → cafeteria transactions + parent alerts.

cPanel cron target (see DEPLOYMENT.md §3), suggested every 5 minutes. Idempotent:
each receipt maps to a unique ``CafeteriaTransaction`` so re-running never
duplicates a purchase or re-notifies a parent. Loyverse/credential failures are
logged and reported, not fatal, so cron never emails a traceback for a transient
hiccup.
"""
from django.core.management.base import BaseCommand

from apps.cafeteria.services import LoyverseError, sync_purchases


class Command(BaseCommand):
    help = 'Poll Loyverse receipts and record cafeteria purchases + parent notifications.'

    def handle(self, *args, **options):
        try:
            result = sync_purchases()
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'sync_purchases could not reach Loyverse: {e}'))
            return

        self.stdout.write(self.style.SUCCESS(
            f"Purchase sync complete: {result['receipts']} receipt(s) polled, "
            f"{result['created']} new transaction(s), "
            f"{result['notified']} notification(s) sent "
            f"across {result['students']} linked student(s)."
        ))
