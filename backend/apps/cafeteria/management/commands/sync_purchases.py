"""
sync_purchases — poll Loyverse receipts → cafeteria transactions + parent alerts.

Placeholder scaffolding. The full purchase pipeline (idempotent receipt ingest,
balance debit, per-parent purchase notifications, low-balance follow-up) is
implemented in **Prompt 09**. The command exists now so the cron line documented
in DEPLOYMENT.md §3 is valid and the schedule can be set up ahead of time.
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Poll Loyverse receipts and record cafeteria purchases (implemented in Prompt 09).'

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING(
            'sync_purchases is a placeholder — the purchase pipeline lands in Prompt 09. '
            'No receipts were processed.'
        ))
