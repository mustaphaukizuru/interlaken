"""
sync_roster — keep the student roster converged with Loyverse, unattended.

Loyverse is where the school actually enrols a pupil (the cashier creates the
customer card); the app used to learn about it only when an admin pressed
"Importar desde Loyverse". Until then the child's purchases arrived as
"unmatched" and, before 2026-09-23, vanished. This runs daily and does, in
order, what that button does:

1. link customers to existing students by exact matrícula (or exact email);
2. create students for genuinely new pupils (``ci<digits>@interlaken.com.mx``
   customers only, so staff and test cards are never turned into students),
   seeding their opening balance once;
3. replay any receipts parked while those students were unlinked (or absorb
   them into the opening balance that already nets them);
4. report stale links (customer gone from Loyverse) for the office to act on
   through Vincular Loyverse → Dar de baja. Nothing is ever deleted here.

Anything ambiguous (two customers with one matrícula, a student linked to a
different id) is skipped and listed, exactly as the manual flow does.
"""
from django.core.management.base import BaseCommand

from apps.accounts.models import StudentProfile
from apps.cafeteria.services import (
    LoyverseError,
    get_all_customers,
    import_students_from_loyverse,
    link_students_to_loyverse,
    mirror_pos_topups,
    replay_unmatched_receipts,
)


class Command(BaseCommand):
    help = 'Link, import and replay so new pupils enrolled at the POS appear on their own.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Preview what would change without writing.')

    def handle(self, *args, **o):
        commit = not o['dry_run']
        try:
            customers = get_all_customers()
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'Loyverse unreachable: {e}'))
            return

        link = link_students_to_loyverse(customers, commit=commit)
        imp = import_students_from_loyverse(customers, commit=commit, seed_balances=True)
        replay = replay_unmatched_receipts() if commit else {'replayed': 0, 'absorbed': 0,
                                                             'created': 0, 'pending': None}
        # A full-roster mirror pass flags stale links and refreshes the audit
        # numbers the console shows, using the customer list already fetched.
        audit = {}
        if commit:
            # The mirror needs the full list to audit; passing ``customers``
            # would mark it partial, so let it fetch (one call, two pages).
            audit = mirror_pos_topups().get('audit', {})

        stale = StudentProfile.objects.filter(is_active=True,
                                              loyverse_missing_since__isnull=False)
        for d in link['duplicate_codes']:
            self.stdout.write(self.style.WARNING(f'  matrícula duplicada en Loyverse: {d}'))
        for e in imp['errors']:
            self.stdout.write(self.style.WARNING(f'  {e["matricula"]}: {e["error"]}'))

        mode = 'written' if commit else 'DRY RUN'
        self.stdout.write(self.style.SUCCESS(
            f'sync_roster ({mode}): {link["linked"]} linked, {link["skipped_conflict"]} conflicts, '
            f'{imp["created"]} created, {imp["updated"]} refreshed, '
            f'{replay["replayed"]} receipt(s) replayed, {replay["absorbed"]} absorbed, '
            f'{stale.count()} stale link(s), '
            f'{audit.get("unlinked_students", "?")} unlinked student-looking customer(s).'))
