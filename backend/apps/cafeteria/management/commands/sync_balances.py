"""
sync_balances — seed each newly-linked student's OPENING cafeteria balance from
Loyverse (once). The local ledger is the source of truth (spec R1), so this never
overwrites a student that already has a balance — top-ups/purchases/adjustments
own it. Safe to run on a schedule: already-seeded students are a no-op.

It also keeps the full Loyverse customer snapshots (visit history / spend) fresh
by piggy-backing a self-throttled profile refresh — the heavy all-customers
fetch runs at most ~once/day, so no separate cron entry is needed. Pass
``--no-profiles`` to skip it.

cPanel cron target (see DEPLOYMENT.md §3), suggested every 10 minutes.
Network/credential failures are counted, not fatal, so cron never emails a
traceback for a transient Loyverse hiccup.
"""
from django.core.management.base import BaseCommand

from apps.cafeteria.loyverse_profile import refresh_profiles_if_stale
from apps.cafeteria.services import sync_all_balances


class Command(BaseCommand):
    help = "Seed newly-linked students' opening cafeteria balances from Loyverse (once)."

    def add_arguments(self, parser):
        parser.add_argument('--no-profiles', action='store_true',
                            help='Skip the piggy-backed Loyverse profile refresh.')

    def handle(self, *args, **options):
        result = sync_all_balances()
        self.stdout.write(self.style.SUCCESS(
            f"Opening-balance seed complete: {result['synced']} ok, {result['failed']} failed."
        ))

        if options['no_profiles']:
            return

        # Self-throttled: only does the heavy full-customer fetch once ~daily.
        p = refresh_profiles_if_stale()
        if p.get('skipped'):
            if p.get('reason') == 'loyverse-error':
                self.stdout.write(self.style.WARNING(
                    f"Perfiles Loyverse: no refrescados ({p['error']})."))
            else:
                self.stdout.write("Perfiles Loyverse: al día, sin cambios.")
        else:
            self.stdout.write(self.style.SUCCESS(
                f"Perfiles Loyverse refrescados: {p['matched']} con match "
                f"({p['created']} nuevos, {p['updated']} actualizados) "
                f"de {p['total_customers']} clientes."))
