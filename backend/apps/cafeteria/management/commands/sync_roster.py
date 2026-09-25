"""
sync_roster — keep the student roster converged with Loyverse, unattended.

Loyverse is where the school actually enrols a pupil (the cashier creates the
customer card) and where the office edits the roster (grade code, name, the
``ci`` code); the app used to learn about it only when an admin pressed
"Importar desde Loyverse". This runs daily at 06:07 and does, in order, what
that button does (the body lives in ``services.sync_roster`` so the console's
"Sincronizar roster ahora" runs exactly the same code):

1. link customers to existing students by exact matrícula (or exact email);
2. create students for genuinely new pupils (``ci<digits>@interlaken.com.mx``
   customers only, so staff and test cards are never turned into students),
   seeding their opening balance once, and refresh grade/group from the
   Loyverse grade code (the name only when Loyverse's name changed);
3. replay any receipts parked while those students were unlinked (or absorb
   them into the opening balance that already nets them);
4. report stale links (customer gone from Loyverse) and customers without a
   grade code (posible baja) for the office to act on through Vincular
   Loyverse → Dar de baja. Nothing is ever deleted here.

Anything ambiguous (two customers with one matrícula, a student linked to a
different id) is skipped and listed, exactly as the manual flow does. A written
run stamps ``LoyverseSyncState.last_roster_sync_at``; ``check_sync_fresh`` and
the console's Roster light alarm when that is more than 30 h old, which is
how the 2026-09-24 defect (this job silently losing the lock race to the
5-minute poll every morning, for months) became visible.
"""
from django.core.management.base import BaseCommand

from apps.cafeteria import services
from apps.core.audit import audit_context


class Command(BaseCommand):
    help = 'Link, import and replay so new pupils enrolled at the POS appear on their own.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Preview what would change without writing.')

    def handle(self, *args, **o):
        commit = not o['dry_run']
        try:
            customers = services.get_all_customers()
        except services.LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'Loyverse unreachable: {e}'))
            return

        with audit_context(actor_label='system:sync_roster', context='system:sync_roster'):
            report = services.sync_roster(customers, commit=commit)

        link, imp = report['link'], report['import']
        for d in link['duplicate_codes']:
            self.stdout.write(self.style.WARNING(f'  matrícula duplicada en Loyverse: {d}'))
        for e in imp['errors']:
            self.stdout.write(self.style.WARNING(f'  {e["matricula"]}: {e["error"]}'))
        for ch in imp['changes']:
            if ch['field'] == 'nombre' and ch['action'] == 'actualizar':
                self.stdout.write(f'  nombre {ch["matricula"]}: {ch["before"]} → {ch["after"]}')
        for row in link['possible_leavers']:
            self.stdout.write(self.style.WARNING(
                f'  sin código de grado en Loyverse (posible baja): '
                f'{row["loyverse_code"]} {row["name"]}'))

        self.stdout.write(self.style.SUCCESS(services.roster_sync_line(report)))
