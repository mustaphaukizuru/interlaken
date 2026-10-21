"""Cash recargas loaded on the Loyverse POS must reach the local wallet.

The 2026-09-16 roster reconcile found 69 wallets BELOW Loyverse by round
amounts, many negative: purchases were debited faithfully while the cash
top-ups typed into the POS tablet had no channel into the ledger. The mirror
is strictly one-directional, only credits, and is idempotent by construction.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.cafeteria.services import mirror_pos_topups


def customer(uuid, points):
    return {'id': uuid, 'total_points': points}


def seeded(student, balance):
    return CafeteriaBalance.objects.create(
        student=student, balance=Decimal(str(balance)), last_synced=timezone.now())


@pytest.mark.django_db
class TestMirrorPosTopups:
    def test_credits_a_pos_load_as_a_visible_topup(self):
        """Loyverse $478, local -$22: the family paid $500 at the window."""
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, -22)

        r = mirror_pos_topups(customers=[customer('u1', 478)])

        assert r['credited'] == 1 and r['total'] == Decimal('500')
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('478')
        tx = CafeteriaTransaction.objects.get(student=s)
        assert tx.transaction_type == CafeteriaTransaction.TxType.TOPUP
        assert tx.amount == Decimal('500')
        assert tx.balance_after == Decimal('478')
        assert 'caja' in tx.description.lower()

    def test_is_idempotent_because_the_ledgers_agree_afterwards(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 0)
        mirror_pos_topups(customers=[customer('u1', 200)])

        r = mirror_pos_topups(customers=[customer('u1', 200)])

        assert r['credited'] == 0 and r['in_sync'] == 1
        assert CafeteriaTransaction.objects.filter(student=s).count() == 1

    def test_never_debits_when_local_is_above_loyverse(self):
        """Local above remote is a purchase the poll will record, or an online
        top-up not yet loaded into the POS. Either way: not ours to touch."""
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 150)

        r = mirror_pos_topups(customers=[customer('u1', 100)])

        assert r['credited'] == 0 and r['below'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('150')
        assert not CafeteriaTransaction.objects.filter(student=s).exists()

    def test_skips_a_student_with_an_online_topup_awaiting_pos_load(self):
        """A simultaneous cash load on such a student is ambiguous; the staff
        POS-load flow settles it, not this mirror."""
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 300)
        TopUpRequest.objects.create(
            student=s, amount=Decimal('300'), method=TopUpRequest.Method.ONLINE,
            status=TopUpRequest.Status.COMPLETED, pos_loaded_at=None)

        r = mirror_pos_topups(customers=[customer('u1', 400)])

        assert r['credited'] == 0 and r['skipped_pending'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('300')

    def test_leaves_unseeded_wallets_to_the_seed_cron(self):
        s = StudentProfileFactory(loyverse_id='u1')
        CafeteriaBalance.objects.create(student=s, balance=Decimal('0'), last_synced=None)

        r = mirror_pos_topups(customers=[customer('u1', 80)])

        assert r['credited'] == 0 and r['unseeded'] == 1
        assert not CafeteriaTransaction.objects.filter(student=s).exists()

    def test_ignores_students_whose_customer_is_gone_from_loyverse(self):
        s = StudentProfileFactory(loyverse_id='vanished')
        seeded(s, 10)

        r = mirror_pos_topups(customers=[customer('u1', 80)])

        assert r['credited'] == 0
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('10')

    def test_notifies_the_family_once_per_credit(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 0)
        with patch('apps.cafeteria.services._notify_balance_change') as notify:
            mirror_pos_topups(customers=[customer('u1', 120)])
        assert notify.call_count == 1
        assert '120.00' in notify.call_args.args[2]

    def test_catch_up_run_can_credit_silently(self):
        """Deploy day: months of backlog land at once; that is not a
        'recarga' notification a family should receive."""
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, -4727)
        with patch('apps.cafeteria.services._notify_balance_change') as notify:
            r = mirror_pos_topups(customers=[customer('u1', 96)], notify=False)
        assert r['credited'] == 1 and r['total'] == Decimal('4823')
        assert notify.call_count == 0
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('96')


@pytest.mark.django_db
class TestSincronizarTodosPicksUpPosLoads:
    def test_sync_all_credits_and_reports_pos_topups(self, api_client):
        """Pressing the button used to be able to debit only, so it could leave
        a wallet negative even when the family had just paid at the window."""
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, -50)
        api_client.force_authenticate(AdminFactory())

        with patch('apps.cafeteria.services.get_receipts', return_value=[]), \
             patch('apps.cafeteria.services.get_all_customers', return_value=[customer('u1', 150)]):
            data = api_client.post(reverse('admin-sync-all')).json()

        assert data['pos_topups_credited'] == 1
        assert Decimal(data['pos_topups_total']) == Decimal('200')
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('150')


def _online_topup(student, amount, *, loaded, payment_status='success'):
    """A completed online top-up with its payment and ledger credit row."""
    from apps.payments.models import Payment

    topup = TopUpRequest.objects.create(
        student=student, amount=Decimal(str(amount)), method=TopUpRequest.Method.ONLINE,
        status=TopUpRequest.Status.COMPLETED,
        pos_loaded_at=timezone.now() if loaded else None)
    payment = Payment.objects.create(
        user=student.user, payment_type=Payment.Type.CAFETERIA, amount=Decimal(str(amount)),
        related_topup=topup, status=payment_status)
    tx = CafeteriaTransaction.objects.create(
        student=student, transaction_type=CafeteriaTransaction.TxType.TOPUP,
        amount=Decimal(str(amount)), loyverse_receipt_id=f'topup-payment-{payment.id}')
    return topup, payment, tx


def _points(value):
    return patch('apps.cafeteria.services.get_customer_by_id',
                 return_value={'total_points': value})


@pytest.mark.django_db
class TestLocalDebitsAreNeverRecredited:
    """Loyverse points cannot be written (spec R1), so a local debit the POS
    never saw used to come straight back on the next 5-minute tick as a
    'Recarga en caja (POS)', with a notice to the family."""

    def test_refund_of_a_pos_loaded_online_topup_then_mirror_tick(self, api_client):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 200)
        topup, _payment, tx = _online_topup(s, 100, loaded=True)
        api_client.force_authenticate(AdminFactory())

        with _points(200):     # Loyverse still holds the loaded $100
            resp = api_client.post(reverse('admin-refund', args=[tx.id]),
                                   {'bank_refund_confirmed': True}, format='json')
        assert resp.status_code == 201, resp.data
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('100')
        topup.refresh_from_db()
        assert topup.pos_unload_needed_at is not None

        r = mirror_pos_topups(customers=[customer('u1', 200)], fresh=True)

        assert r['credited'] == 0 and r['skipped_pending'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('100')
        assert not CafeteriaTransaction.objects.filter(
            loyverse_receipt_id__startswith='pos-topup-').exists()

        # Staff remove the $100 in Loyverse and confirm it in the unload queue:
        # the student is mirrored again, and nothing is credited.
        api_client.post(reverse('admin-topup-pos-unloaded', args=[topup.id]), {}, format='json')
        r = mirror_pos_topups(customers=[customer('u1', 100)], fresh=True)
        assert r['in_sync'] == 1 and r['credited'] == 0

    def test_a_topup_refunded_before_its_pos_load_does_not_block_the_mirror(self):
        """pos-loaded refuses a refunded top-up, so it stayed COMPLETED and
        unloaded forever and its student was skipped by every tick."""
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 0)
        _online_topup(s, 100, loaded=False, payment_status='refunded')

        r = mirror_pos_topups(customers=[customer('u1', 50)], fresh=True)

        assert r['skipped_pending'] == 0 and r['credited'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('50')

    def test_a_negative_adjustment_waits_for_the_pos_then_is_not_recredited(self, api_client):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 100)
        api_client.force_authenticate(AdminFactory())
        url = reverse('admin-adjust', args=[s.id])
        body = {'amount': '-30', 'reason': 'Devolución en efectivo'}

        with _points(100):
            refused = api_client.post(url, body, format='json')
        assert refused.status_code == 400
        assert 'Quite primero $30.00' in refused.data['detail']
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('100')

        with _points(70):      # the office removed the $30 in Loyverse first
            done = api_client.post(url, body, format='json')
        assert done.status_code == 201, done.data

        r = mirror_pos_topups(customers=[customer('u1', 70)], fresh=True)
        assert r['in_sync'] == 1 and r['credited'] == 0
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('70')

    def test_refunding_a_pos_recarga_requires_removing_it_in_loyverse_first(self, api_client):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 0)
        mirror_pos_topups(customers=[customer('u1', 200)], fresh=True)
        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id__startswith='pos-topup-')
        api_client.force_authenticate(AdminFactory())

        with _points(200):
            refused = api_client.post(reverse('admin-refund', args=[tx.id]), {}, format='json')
        assert refused.status_code == 400
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('200')

        with _points(0):
            done = api_client.post(reverse('admin-refund', args=[tx.id]), {}, format='json')
        assert done.status_code == 201, done.data
        r = mirror_pos_topups(customers=[customer('u1', 0)], fresh=True)
        assert r['credited'] == 0
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('0')

    def test_debit_below_a_pending_pos_load_is_refused(self):
        """An online $100 not yet loaded: local 100, Loyverse 0. Debiting $60
        locally looks fine now, but once staff load the $100 Loyverse would sit
        $60 above the ledger and the mirror would pay it back."""
        from apps.cafeteria.services import PosDebitBlocked, adjust_balance

        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 100)
        _online_topup(s, 100, loaded=False)

        with pytest.raises(PosDebitBlocked):
            adjust_balance(s, Decimal('-60'), 'x', pos_points=Decimal('0'))
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('100')

    def test_unreachable_loyverse_falls_back_to_the_profile_snapshot(self):
        from apps.cafeteria.models import LoyverseProfile
        from apps.cafeteria.services import PosDebitBlocked, adjust_balance

        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 100)
        LoyverseProfile.objects.create(student=s, loyverse_id='u1', total_points=Decimal('100'))

        # The test token is blank: the live read raises LoyverseError.
        with pytest.raises(PosDebitBlocked):
            adjust_balance(s, Decimal('-10'), 'x')

    def test_provider_refund_webhook_is_never_blocked(self):
        """The bank already returned the money: the ledger follows, and the
        unload flag keeps the mirror away until staff clear the POS."""
        from apps.cafeteria.services import reverse_online_topup

        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 100)
        _topup, payment, _tx = _online_topup(s, 100, loaded=True)

        with _points(100):
            assert reverse_online_topup(payment) is not None
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('0')
        r = mirror_pos_topups(customers=[customer('u1', 100)], fresh=True)
        assert r['credited'] == 0 and r['skipped_pending'] == 1


@pytest.mark.django_db
class TestSyncAllStaysFast:
    """2026-10-20: «Sincronizar todos» outlived the 60 s worker timeout. A row
    lock and commit per student (x387, remote database) was the cost; the
    query count must not grow with the roster when nothing is credited."""

    def _roster(self, n, start=0):
        for i in range(start, start + n):
            seeded(StudentProfileFactory(loyverse_id=f'r{i}'), 100 if i % 2 else 150)
        return [customer(f'r{i}', 100) for i in range(start + n)]

    def _queries(self, customers):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as ctx:
            r = mirror_pos_topups(customers=customers, notify=False)
        return len(ctx.captured_queries), r

    def test_query_count_does_not_grow_with_in_sync_or_below_students(self):
        small, r = self._queries(self._roster(4))
        assert r['in_sync'] == 2 and r['below'] == 2 and r['credited'] == 0
        large, r = self._queries(self._roster(20, start=4))
        assert r['in_sync'] + r['below'] == 24
        assert large == small

    def test_seed_skips_already_seeded_students(self):
        from apps.cafeteria.services import sync_all_balances

        self._roster(5)
        with patch('apps.cafeteria.services.get_customer_by_id') as remote:
            assert sync_all_balances() == {'synced': 5, 'failed': 0}
        remote.assert_not_called()
