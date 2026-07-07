"""
sync_balances — refresh every linked student's cafeteria balance from Loyverse.

cPanel cron target (see DEPLOYMENT.md §3), suggested every 10 minutes.
Network/credential failures are counted, not fatal, so cron never emails a
traceback for a transient Loyverse hiccup.
"""
from django.core.management.base import BaseCommand

from apps.cafeteria.services import sync_all_balances


class Command(BaseCommand):
    help = 'Sync all active students\' cafeteria balances from Loyverse.'

    def handle(self, *args, **options):
        result = sync_all_balances()
        self.stdout.write(self.style.SUCCESS(
            f"Balance sync complete: {result['synced']} synced, {result['failed']} failed."
        ))
