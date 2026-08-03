"""
import_loyverse_students — create the student roster directly from Loyverse.

The whole roster already lives in Loyverse (name, matrícula, grade, points, UUID),
so this onboards every student in one pass — no CSV needed. Only real students are
imported (numeric matrícula + ci…@interlaken.com.mx email); staff and test records
are skipped. Grades are decoded from the Loyverse address code (6APRI → 6° Primaria,
group A) and each student is linked (loyverse_id) with their opening balance seeded.

    python manage.py import_loyverse_students                # dry-run preview
    python manage.py import_loyverse_students --commit       # create/update
    python manage.py import_loyverse_students --commit --no-seed-balances

Idempotent: re-running updates existing students (matched by matrícula) and never
re-seeds a balance that has already been touched. Guardians aren't in Loyverse —
add them afterward via the CSV import or the console.
"""
from django.core.management.base import BaseCommand

from apps.cafeteria.services import LoyverseError, get_all_customers, import_students_from_loyverse


class Command(BaseCommand):
    help = 'Create/refresh the student roster from Loyverse customers.'

    def add_arguments(self, parser):
        parser.add_argument('--commit', action='store_true',
                            help='Persist changes (default: dry-run preview).')
        parser.add_argument('--no-seed-balances', action='store_true',
                            help='Do not seed opening balances from Loyverse points.')

    def handle(self, *args, **options):
        commit = options['commit']
        seed = not options['no_seed_balances']

        try:
            customers = get_all_customers()
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(
                f'No se pudieron obtener los clientes de Loyverse: {e}'))
            return

        report = import_students_from_loyverse(customers, commit=commit, seed_balances=seed)

        mode = 'APLICADO' if commit else 'SIMULACION - nada se guardo (use --commit)'
        style = self.style.SUCCESS if commit else self.style.WARNING
        self.stdout.write(style(f'[{mode}]'))
        self.stdout.write(
            f"Clientes Loyverse: {report['total_customers']} "
            f"(alumnos: {report['candidates']}, no-alumnos omitidos: {report['skipped_non_student']})")
        self.stdout.write(
            f"  Creados{'' if commit else ' (se crearian)'}: {report['created']}\n"
            f"  Actualizados: {report['updated']}\n"
            f"  Saldo inicial sembrado: ${report['balance_seeded']}\n"
            f"  Errores: {len(report['errors'])}")

        if report['samples']:
            self.stdout.write('\nMuestra:')
            for s in report['samples']:
                self.stdout.write(
                    f"  [{s['action']}] {s['matricula']}  {s['name']}  "
                    f"{s['grade']} {s['group']}  ${s['points']}")

        for err in report['errors'][:20]:
            self.stdout.write(self.style.ERROR(f"  ! {err['matricula']}: {err['error']}"))

        if not commit and (report['created'] or report['updated']):
            self.stdout.write(self.style.WARNING(
                '\nEjecute con --commit para crear/actualizar estos alumnos.'))
