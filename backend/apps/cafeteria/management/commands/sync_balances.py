"""
sync_balances — seed each newly-linked student's OPENING cafeteria balance from
Loyverse (once). The local ledger is the source of truth (spec R1), so this never
overwrites a student that already has a balance — top-ups/purchases/adjustments
own it. Safe to run on a schedule: already-seeded students are a no-op.

cPanel cron target (see DEPLOYMENT.md §3), suggested every 10 minutes.
Network/credential failures are counted, not fatal, so cron never emails a
traceback for a transient Loyverse hiccup.
"""
from django.core.management.base import BaseCommand

from apps.cafeteria.services import sync_all_balances


class Command(BaseCommand):
    help = "Seed newly-linked students' opening cafeteria balances from Loyverse (once)."

    def handle(self, *args, **options):
        result = sync_all_balances()
        self.stdout.write(self.style.SUCCESS(
            f"Opening-balance seed complete: {result['synced']} ok, {result['failed']} failed."
        ))
