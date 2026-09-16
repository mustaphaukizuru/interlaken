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
