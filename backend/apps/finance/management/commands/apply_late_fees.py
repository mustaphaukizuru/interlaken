"""
apply_late_fees — charge a one-time late fee on overdue, unpaid invoices.

cPanel cron target (daily). Idempotent: each invoice is charged at most once
(``Invoice.late_fee_applied``) and flipped to *overdue*. The fee amount comes from
the invoice's ``FeeSchedule`` rule (never hardcoded).
"""
from django.core.management.base import BaseCommand

from apps.finance.services import apply_late_fees


class Command(BaseCommand):
    help = 'Apply late fees to overdue tuition invoices (idempotent, per FeeSchedule rule).'

    def handle(self, *args, **options):
        result = apply_late_fees()
        self.stdout.write(self.style.SUCCESS(
            f"apply_late_fees: {result['overdue']} invoice(s) marked overdue, "
            f"{result['charged']} late fee(s) charged, "
            f"{result['notified']} notification(s) sent."
        ))
