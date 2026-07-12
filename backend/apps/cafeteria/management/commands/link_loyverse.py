"""
link_loyverse — match Loyverse customers to students by matrícula (= customer_code)
and backfill StudentProfile.loyverse_id for the whole roster in one pass.

The student↔Loyverse link is the customer's internal **id (UUID)**, not the
visible code/barcode — collecting each by hand is impractical, so this fetches
every Loyverse customer and links them automatically.

    python manage.py link_loyverse              # dry-run preview (writes nothing)
    python manage.py link_loyverse --commit     # persist the links
    python manage.py link_loyverse --commit --overwrite   # also re-link students
                                                          # pointing at a stale id

Idempotent: re-running after a commit reports everyone already linked and changes
nothing. Loyverse/credential failures are reported, not fatal.
"""
from django.core.management.base import BaseCommand

from apps.cafeteria.services import (LoyverseError, get_all_customers,
                                     link_students_to_loyverse)


class Command(BaseCommand):
    help = ('Match Loyverse customers to students by matrícula (= customer_code) '
            'and backfill loyverse_id.')

    def add_arguments(self, parser):
        parser.add_argument('--commit', action='store_true',
                            help='Persist the links (default: dry-run preview).')
        parser.add_argument('--overwrite', action='store_true',
                            help='Re-link students already pointing at a different id.')

    def handle(self, *args, **options):
        commit = options['commit']
        overwrite = options['overwrite']

        try:
            customers = get_all_customers()
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(
                f'No se pudieron obtener los clientes de Loyverse: {e}'))
            return

        report = link_students_to_loyverse(customers, overwrite=overwrite, commit=commit)

        mode = 'APLICADO' if commit else 'SIMULACIÓN — nada se guardó (use --commit)'
        style = self.style.SUCCESS if commit else self.style.WARNING
        self.stdout.write(style(f'[{mode}]'))
        self.stdout.write(
            f"Clientes Loyverse: {report['customers']} · Alumnos activos: {report['students']}")
        self.stdout.write(
            f"  Vinculados{'' if commit else ' (se vincularían)'}: {report['linked']}\n"
            f"  Ya vinculados: {report['already_linked']}\n"
            f"  Omitidos (vinculados a otro id, use --overwrite): {report['skipped_conflict']}\n"
            f"  Alumnos sin coincidencia: {len(report['unmatched_students'])}\n"
            f"  Clientes Loyverse sin alumno: {report['unmatched_customer_count']}")

        if report['duplicate_codes']:
            self.stdout.write(self.style.WARNING(
                f"  ⚠ Códigos de cliente duplicados en Loyverse: "
                f"{', '.join(report['duplicate_codes'][:20])}"))

        # The actionable list: students we couldn't match (bad/missing matrícula).
        unmatched = report['unmatched_students']
        if unmatched:
            self.stdout.write('\nAlumnos sin coincidencia (revise su matrícula):')
            for u in unmatched[:40]:
                self.stdout.write(f"  · {u['matricula'] or '—'}  {u['name']}")
            if len(unmatched) > 40:
                self.stdout.write(f"  … y {len(unmatched) - 40} más")

        if not commit and report['linked']:
            self.stdout.write(self.style.WARNING(
                '\nEjecute con --commit para guardar estos vínculos.'))
