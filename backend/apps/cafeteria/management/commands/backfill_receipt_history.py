"""
backfill_receipt_history — complete the families' purchase lists without
touching a single balance.

Background (2026-09-23 audit): 53 pupils were imported from Loyverse on
2026-09-16 with their opening balance copied from Loyverse points. Those
points already netted the purchases of the days before, so the app rightly
did not debit them again, but it also never showed them: the family's history
started on the 16th, and the office read that as "purchases not updated".

This reads the store's receipts for the last ``--days`` and, for every linked
student whose balance currently equals Loyverse (so nothing can be missing
from the money side), stores each receipt not yet in the ledger as history
only (``applied=False``, no debit, no balance_after). Receipts of cards with
no student are parked for the customer directory. A student whose balance
does NOT match Loyverse is listed and skipped: a missing receipt there could
be a real miss, and the drift tooling must settle it first.

Dry run by default:

    python manage.py backfill_receipt_history --days 60
    python manage.py backfill_receipt_history --days 60 --commit
"""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.cafeteria import services
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, UnmatchedReceipt


class Command(BaseCommand):
    help = 'Store older Loyverse receipts as history (never debits). Dry run unless --commit.'

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=60)
        parser.add_argument('--commit', action='store_true')

    def handle(self, *args, **o):
        commit, days = o['commit'], max(1, o['days'])
        try:
            customers = services.get_all_customers()
            since = services._loyverse_ts(timezone.now() - timedelta(days=days))
            receipts = services.get_receipts(since=since)
        except services.LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'Loyverse unreachable: {e}'))
            return

        points = {c.get('id'): services.get_balance_from_customer(c) for c in customers}
        students = services._students_by_loyverse_id()
        have = set(CafeteriaTransaction.objects.values_list('loyverse_receipt_id', flat=True))
        parked = set(UnmatchedReceipt.objects.values_list('receipt_number', flat=True))
        balances = {b.student_id: b for b in CafeteriaBalance.objects.filter(
            student__in=students.values())}

        per_student, orphans, skipped_drift = defaultdict(list), [], {}
        for r in receipts:
            number = str(r.get('receipt_number') or '').strip()
            if not number or number in have or services._points_spent(r) == 0:
                continue
            student = students.get(r.get('customer_id'))
            if student is None:
                if number not in parked:
                    orphans.append(r)
                continue
            cb = balances.get(student.id)
            remote = points.get(student.loyverse_id)
            local = Decimal(str(cb.balance if cb else 0))
            if remote is None or abs(Decimal(str(remote)) - local) >= Decimal('0.01'):
                skipped_drift[student.student_id] = (local, remote)
                continue
            per_student[student].append(r)

        total_rows = total_pesos = 0
        for student, rows in sorted(per_student.items(), key=lambda kv: kv[0].student_id):
            pesos = sum(services._points_spent(r) for r in rows)
            total_rows += len(rows)
            total_pesos += pesos
            self.stdout.write(f'{student.student_id:<8} {student.user.full_name[:32]:<32} '
                              f'{len(rows):>3} recibo(s)  ${pesos:>8.2f}')
            if commit:
                services.record_receipts(rows, {student.loyverse_id: student},
                                         notify=False, apply=False)
        if commit:
            for r in orphans:
                services._keep_unmatched_receipt(r)
        for code, (local, remote) in skipped_drift.items():
            self.stdout.write(self.style.WARNING(
                f'{code}: omitido, saldo local {local} vs Loyverse {remote}; revise Reconciliación'))

        mode = 'written' if commit else 'DRY RUN, nothing written (add --commit)'
        self.stdout.write(self.style.SUCCESS(
            f'\n{len(receipts)} receipt(s) read over {days} days: {total_rows} history row(s) '
            f'(${total_pesos:.2f}) for {len(per_student)} student(s), {len(orphans)} parked for '
            f'cards without a student, {len(skipped_drift)} student(s) skipped for drift. {mode}.'))
