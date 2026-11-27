"""
mirror_pos_topups — credit recargas typed into the Loyverse POS into the ledger.

Runs in the same 5-minute cron tick as ``sync_purchases``, after it (see
deploy/crontab.example). One-directional: only credits what Loyverse says was
loaded; never debits. See ``services.mirror_pos_topups`` for the reasoning.
"""
from django.core.management.base import BaseCommand

from apps.cafeteria.services import LoyverseError, mirror_pos_topups


class Command(BaseCommand):
    help = 'Credit POS-side (cash) top-ups from Loyverse total_points into the local wallets.'

    def add_arguments(self, parser):
        parser.add_argument('--no-notify', action='store_true',
                            help='Credit silently. Use ONCE for the deploy-day backlog catch-up.')

    def handle(self, *args, **options):
        # CAFETERIA_TOPUP_LOYVERSE_PUSH on: write the paid card top-ups that
        # are due into Loyverse first, so this pass already sees them in sync.
        from apps.cafeteria.loyverse_push import push_due_topups
        try:
            pushed = push_due_topups()
        except Exception as e:  # noqa: BLE001 (the mirror must always run)
            self.stderr.write(self.style.ERROR(f'Loyverse push pass failed: {e}'))
        else:
            if pushed.get('enabled'):
                self.stdout.write(
                    f'Card top-ups written into Loyverse: {pushed["pushed"]}, waiting '
                    f'{pushed["waiting"]}, failed {pushed["failed"]}, '
                    f'checks resolved {pushed["resolved"]}.')
        # Front-desk top-ups («Caja») still waiting for Loyverse, same rule.
        from apps.cafeteria.caja import push_due_desk_topups
        try:
            desk = push_due_desk_topups()
        except Exception as e:  # noqa: BLE001 (the mirror must always run)
            self.stderr.write(self.style.ERROR(f'Desk top-up pass failed: {e}'))
        else:
            if any(desk.values()):
                self.stdout.write(
                    f'Desk top-ups written into Loyverse: {desk["pushed"]}, waiting '
                    f'{desk["waiting"]}, failed {desk["failed"]}.')
        try:
            r = mirror_pos_topups(notify=not options['no_notify'])
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'Loyverse unreachable: {e}'))
            return
        self.stdout.write(
            f'POS top-ups: {r["credited"]} credited (${r["total"]}), {r["in_sync"]} in sync, '
            f'{r["below"]} below Loyverse, {r["skipped_pending"]} pending POS load, '
            f'{r["unseeded"]} unseeded.'
        )
