"""
repair_wallet_ledger — one-time repair after the points-debit bug (2026-08-13).

Before ``_points_spent()``, receipts paid with Loyverse points
(``DISCOUNT_BY_POINTS``) were recorded with ``amount = total_money = $0.00``:
the wallet was never debited, parents got "$0.00" purchase alerts, and local
balances drifted ABOVE Loyverse's points balance (which the POS *does* debit
on every points sale, so Loyverse is authoritative for the drift window).

Phase 1 — re-price recorded $0 purchase/refund rows from Loyverse (history
    accuracy only; balances are NOT touched here — phase 2 owns that, and
    Loyverse's points already reflect these receipts, so also debiting them
    would double-count).
Phase 2 — reconcile each drifted student's local balance to Loyverse
    ``total_points`` via an audited ``ADJUSTMENT`` (no parent notification, no
    Loyverse mirror). Students with a completed ONLINE top-up not yet loaded
    into the POS are skipped and reported: their local ledger legitimately
    leads Loyverse by the pending credit.

Dry-run by default; pass ``--apply`` to write. Safe to re-run: phase 1 only
targets $0 rows and phase 2 no-ops once the ledgers agree.
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.cafeteria.services import (
    LoyverseError, _loyverse_ts, _points_spent, adjust_balance,
    get_all_customers, get_balance_from_customer, get_receipts,
)


class Command(BaseCommand):
    help = ('One-time wallet repair: re-price $0 points receipts and reconcile '
            'drifted balances to Loyverse. Dry-run unless --apply.')

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Write the fixes (default is a dry-run report).')

    def handle(self, *args, **options):
        apply = options['apply']
        mode = 'APPLY' if apply else 'DRY-RUN'
        self.stdout.write(self.style.WARNING(f'repair_wallet_ledger - {mode}'))

        self._reprice_zero_rows(apply)
        self._reconcile_balances(apply)

    # ── Phase 1: fix the $0 history rows ────────────────────────────────────
    def _reprice_zero_rows(self, apply):
        from apps.cafeteria.models import CafeteriaTransaction

        zero_txs = list(
            CafeteriaTransaction.objects
            .filter(transaction_type__in=[CafeteriaTransaction.TxType.PURCHASE,
                                          CafeteriaTransaction.TxType.REFUND],
                    amount=0)
            .exclude(loyverse_receipt_id='')
            # Synthetic refs (refund-tx-*, topup-*, adjust-tx-*) are not
            # Loyverse receipts and can't be re-priced from the API.
            .exclude(loyverse_receipt_id__contains='tx-')
            .select_related('student')
            .order_by('date')
        )
        self.stdout.write(f'\nPhase 1 — $0 ledger rows with a Loyverse receipt: {len(zero_txs)}')
        if not zero_txs:
            return

        since = _loyverse_ts(zero_txs[0].date - timedelta(days=1))
        try:
            receipts = {r.get('receipt_number'): r for r in get_receipts(since=since)}
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'  Loyverse receipts fetch failed: {e}'))
            return

        fixed = missing = still_zero = 0
        for tx in zero_txs:
            receipt = receipts.get(tx.loyverse_receipt_id)
            if receipt is None:
                missing += 1
                self.stdout.write(f'  {tx.loyverse_receipt_id}: not returned by Loyverse - left as-is')
                continue
            true_amount = _points_spent(receipt)
            if true_amount == 0:
                still_zero += 1   # genuinely no wallet movement (cash sale)
                continue
            self.stdout.write(
                f'  {tx.loyverse_receipt_id} ({tx.student}): $0.00 -> ${true_amount:.2f}')
            if apply:
                tx.amount = true_amount
                tx.save(update_fields=['amount'])
            fixed += 1

        verb = 'fixed' if apply else 'would fix'
        self.stdout.write(self.style.SUCCESS(
            f'  Phase 1: {verb} {fixed}, {still_zero} genuinely $0, {missing} not found.'))

    # ── Phase 2: reconcile balances to Loyverse total_points ────────────────
    def _reconcile_balances(self, apply):
        from apps.accounts.models import StudentProfile
        from apps.cafeteria.models import CafeteriaBalance, TopUpRequest

        self.stdout.write('\nPhase 2 — balance reconcile vs Loyverse total_points')
        try:
            # One paginated store-wide fetch instead of 300+ per-student calls.
            points_by_id = {c.get('id'): get_balance_from_customer(c)
                            for c in get_all_customers()}
        except LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'  Loyverse customers fetch failed: {e}'))
            return

        # Local-only credits Loyverse can't know about yet: completed online
        # top-ups the staff has not loaded into the POS. Reconciling those
        # students would erase real money — skip and surface them instead.
        pending_pos = set(
            TopUpRequest.objects.filter(
                method=TopUpRequest.Method.ONLINE,
                status=TopUpRequest.Status.COMPLETED,
                pos_loaded_at__isnull=True,
            ).values_list('student_id', flat=True)
        )

        students = (StudentProfile.objects.filter(is_active=True)
                    .exclude(loyverse_id='').select_related('user').order_by('id'))
        in_sync = drifted = skipped_pending = unseeded = no_customer = 0
        for student in students:
            remote = points_by_id.get(student.loyverse_id)
            if remote is None:
                no_customer += 1
                continue
            cb = CafeteriaBalance.objects.filter(student=student).first()
            if cb is None or cb.last_synced is None:
                unseeded += 1   # the sync_balances cron will seed from Loyverse
                continue
            local = Decimal(str(cb.balance or 0))
            drift = local - remote
            if drift == 0:
                in_sync += 1
                continue
            if student.id in pending_pos:
                skipped_pending += 1
                self.stdout.write(self.style.WARNING(
                    f'  SKIP {student} - pending POS load; local ${local:.2f} '
                    f'vs Loyverse ${remote:.2f} (drift ${drift:+.2f})'))
                continue
            drifted += 1
            self.stdout.write(
                f'  {student}: local ${local:.2f} -> Loyverse ${remote:.2f} '
                f'(drift ${drift:+.2f})')
            if apply:
                adjust_balance(
                    student, -drift,
                    'Reconciliación con Loyverse (compras con puntos no descontadas)',
                    admin=None, notify=False, mirror=False,
                )

        verb = 'reconciled' if apply else 'would reconcile'
        self.stdout.write(self.style.SUCCESS(
            f'  Phase 2: {verb} {drifted}; {in_sync} in sync, {skipped_pending} '
            f'pending POS load, {unseeded} unseeded, {no_customer} not in Loyverse.'))
