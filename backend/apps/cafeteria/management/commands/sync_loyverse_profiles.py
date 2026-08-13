"""
sync_loyverse_profiles — pull the FULL Loyverse customer record for every
linked student and store it as a LoyverseProfile snapshot (visit history,
lifetime spend, contact fields, raw object).

    python manage.py sync_loyverse_profiles            # dry-run preview
    python manage.py sync_loyverse_profiles --commit   # persist snapshots

Scheduled by .github/workflows/scheduled-tasks.yml (daily). Read-only against
the wallet — it never changes balances; it only mirrors reference data.
Matches customers to students by Loyverse id first, then by matrícula
(customer_code == student_id) as a fallback.
"""
from django.core.management.base import BaseCommand

from apps.accounts.models import StudentProfile
from apps.cafeteria.loyverse_profile import upsert_loyverse_profile
from apps.cafeteria.services import LoyverseError, get_all_customers


class Command(BaseCommand):
    help = 'Snapshot the full Loyverse customer record for every linked student.'

    def add_arguments(self, parser):
        parser.add_argument('--commit', action='store_true',
                            help='Persist snapshots (default: dry-run preview).')

    def handle(self, *args, **options):
        commit = options['commit']

        try:
            customers = get_all_customers()
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(
                f'No se pudieron obtener los clientes de Loyverse: {e}'))
            return

        # Index students by both keys so we can match either way.
        by_id, by_code = {}, {}
        for s in StudentProfile.objects.select_related('user').all():
            if s.loyverse_id:
                by_id[s.loyverse_id] = s
            if s.student_id:
                by_code[s.student_id.strip()] = s

        matched = updated = created = unmatched = 0
        samples = []

        for c in customers:
            student = by_id.get(c.get('id')) or by_code.get(
                (c.get('customer_code') or '').strip())
            if student is None:
                unmatched += 1
                continue
            matched += 1

            if len(samples) < 10:
                samples.append(
                    f"  {c.get('customer_code','?'):>7}  {(c.get('name') or '')[:28]:28}  "
                    f"visitas={c.get('total_visits',0):>3}  "
                    f"gasto=${c.get('total_spent',0)}  "
                    f"últ.visita={(c.get('last_visit') or '—')[:10]}")

            if commit:
                _, was_created = upsert_loyverse_profile(student, c)
                created += int(was_created)
                updated += int(not was_created)

        mode = 'APLICADO' if commit else 'SIMULACION - nada se guardo (use --commit)'
        style = self.style.SUCCESS if commit else self.style.WARNING
        self.stdout.write(style(f'[{mode}]'))
        self.stdout.write(
            f'Clientes Loyverse: {len(customers)}  ·  alumnos con match: {matched}  ·  '
            f'sin match: {unmatched}')
        if commit:
            self.stdout.write(f'  Snapshots creados: {created}  ·  actualizados: {updated}')
        if samples:
            self.stdout.write('\nMuestra:')
            self.stdout.write('\n'.join(samples))
        if not commit and matched:
            self.stdout.write(self.style.WARNING(
                '\nEjecute con --commit para guardar estos snapshots.'))
