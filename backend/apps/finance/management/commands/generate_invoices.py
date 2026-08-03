"""
generate_invoices — mint the month's tuition invoices from the FeeSchedule rules.

cPanel cron target (monthly, e.g. 1st of the month). Idempotent per
``(student, period)`` so a re-run never duplicates an invoice. Defaults to the
current period; pass ``--period YYYY-MM`` to (re)generate a specific month.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.finance.services import generate_invoices


class Command(BaseCommand):
    help = "Generate the period's tuition invoices for all active students (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument('--period', help='Billing period YYYY-MM (default: current month).')

    def handle(self, *args, **options):
        period = options.get('period')
        if period:
            try:
                year, month = period.split('-')
                assert 1 <= int(month) <= 12 and len(year) == 4
            except (ValueError, AssertionError):
                raise CommandError('--period must be YYYY-MM (e.g. 2025-08).') from None

        result = generate_invoices(period)
        self.stdout.write(self.style.SUCCESS(
            f"generate_invoices[{result['period']}]: {result['created']} created, "
            f"{result['existing']} already existed, {result['skipped']} skipped "
            f"(no matching fee schedule)."
        ))
