"""The sync buttons must say WHY a run moved nothing, and drift must be fixable.

The reported symptom was "I press Sincronizar and the balance is still wrong".
Every distinct cause produced the same response — "0 compras nuevas" — because
``unmatched`` and ``skipped`` were computed by ``record_receipts`` and then
dropped at the API boundary. These tests pin them to the response, since that
is the only thing standing between "it's broken" and a diagnosis.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction


def points_receipt(receipt_number, customer_id, amount):
    """A receipt paid from the prepaid wallet (Loyverse points redemption)."""
    return {
        'receipt_number': receipt_number,
        'customer_id': customer_id,
        'receipt_type': 'SALE',
        'receipt_date': '2026-08-20T15:00:00.000Z',
        'total_money': 0,
        'total_discounts': [{'type': 'DISCOUNT_BY_POINTS', 'money_amount': amount}],
        'line_items': [{'item_name': 'Torta', 'quantity': 1, 'total_money': 0,
                        'line_discounts': [{'type': 'DISCOUNT_BY_POINTS', 'money_amount': amount}]}],
    }


def cash_receipt(receipt_number, customer_id, amount):
    """A cash/card sale merely attached to the student — the wallet never moved."""
    return {
        'receipt_number': receipt_number,
        'customer_id': customer_id,
        'receipt_type': 'SALE',
        'receipt_date': '2026-08-20T15:00:00.000Z',
        'total_money': amount,
        'total_discounts': [],
        'line_items': [{'item_name': 'Torta', 'quantity': 1, 'total_money': amount}],
    }


@pytest.mark.django_db
class TestSyncAllDiagnostics:
    def test_reports_receipts_the_wallet_logic_did_not_recognise(self, api_client):
        """The exact silent failure: receipts arrive, nothing is debited.

        If the POS ever charges the wallet by some route _points_spent does not
        know, every receipt lands in `skipped` and balances quietly freeze. The
        admin must be able to see that from the sync result.
        """
        student = StudentProfileFactory(loyverse_id='cust-1')
        CafeteriaBalance.objects.create(student=student, balance=Decimal('100'))

        receipts = [cash_receipt('r1', 'cust-1', 50), cash_receipt('r2', 'cust-1', 30)]
        api_client.force_authenticate(AdminFactory())
        with patch('apps.cafeteria.services.get_receipts', return_value=receipts):
            resp = api_client.post(reverse('admin-sync-all'))

        assert resp.status_code == 200
        data = resp.json()
        assert data['receipts'] == 2
        assert data['purchases_created'] == 0
        assert data['skipped'] == 2          # ← the explanation, previously dropped
        assert data['unmatched'] == 0

    def test_reports_receipts_belonging_to_nobody_linked(self, api_client):
        StudentProfileFactory(loyverse_id='cust-1')
        receipts = [points_receipt('r1', 'someone-else', 50)]

        api_client.force_authenticate(AdminFactory())
        with patch('apps.cafeteria.services.get_receipts', return_value=receipts):
            data = api_client.post(reverse('admin-sync-all')).json()

        assert data['unmatched'] == 1
        assert data['purchases_created'] == 0

    def test_a_real_wallet_purchase_debits_and_records_the_running_balance(self, api_client):
        """previous balance − consumption, stamped on the row the family sees."""
        student = StudentProfileFactory(loyverse_id='cust-1')
        CafeteriaBalance.objects.create(student=student, balance=Decimal('100'))

        api_client.force_authenticate(AdminFactory())
        with patch('apps.cafeteria.services.get_receipts',
                   return_value=[points_receipt('r1', 'cust-1', 35)]):
            data = api_client.post(reverse('admin-sync-all')).json()

        assert data['purchases_created'] == 1
        assert data['skipped'] == 0
        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id='r1')
        assert tx.amount == Decimal('35')
        assert tx.balance_after == Decimal('65')          # 100 − 35, shown per compra
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('65')


@pytest.mark.django_db
class TestPerStudentSync:
    def test_says_when_the_balance_was_not_reseeded_and_reports_drift(self, api_client):
        """Seeding happens once; after that the local ledger owns the balance.

        The button used to answer "Saldo sincronizado" either way, which reads
        as "I refreshed it from Loyverse" when nothing of the sort happened.
        """
        student = StudentProfileFactory(loyverse_id='cust-1')
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal('120'), last_synced='2026-08-01T00:00:00Z')

        api_client.force_authenticate(AdminFactory())
        with patch('apps.cafeteria.services.get_receipts', return_value=[]), \
             patch('apps.cafeteria.views.get_customer_by_id', return_value={'total_points': 95}), \
             patch('apps.cafeteria.views.get_balance_from_customer', return_value=Decimal('95')):
            data = api_client.post(reverse('admin-sync-balance', args=[student.pk])).json()

        assert data['seeded'] is False
        assert data['balance'] == '120.00'
        assert data['loyverse_balance'] == '95'
        assert data['drift'] == '25.00'
        assert data['in_sync'] is False


@pytest.mark.django_db
class TestReconcileFix:
    def _fix(self, api_client, student):
        return api_client.post(reverse('admin-reconcile-fix', args=[student.pk]))

    def test_brings_the_local_balance_to_loyverse_with_an_audited_adjustment(self, api_client):
        student = StudentProfileFactory(loyverse_id='cust-1')
        CafeteriaBalance.objects.create(student=student, balance=Decimal('120'))

        api_client.force_authenticate(AdminFactory())
        with patch('apps.cafeteria.views.get_customer_by_id', return_value={'total_points': 95}), \
             patch('apps.cafeteria.views.get_balance_from_customer', return_value=Decimal('95')):
            resp = self._fix(api_client, student)

        assert resp.status_code == 200
        assert resp.json()['adjusted'] is True
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('95')
        tx = CafeteriaTransaction.objects.filter(
            student=student, transaction_type=CafeteriaTransaction.TxType.ADJUSTMENT).get()
        assert tx.balance_after == Decimal('95')

    def test_is_a_no_op_when_the_ledgers_already_agree(self, api_client):
        student = StudentProfileFactory(loyverse_id='cust-1')
        CafeteriaBalance.objects.create(student=student, balance=Decimal('95'))

        api_client.force_authenticate(AdminFactory())
        with patch('apps.cafeteria.views.get_customer_by_id', return_value={'total_points': 95}), \
             patch('apps.cafeteria.views.get_balance_from_customer', return_value=Decimal('95')):
            data = self._fix(api_client, student).json()

        assert data['adjusted'] is False
        assert not CafeteriaTransaction.objects.filter(student=student).exists()

    def test_the_client_cannot_choose_the_amount(self, api_client):
        """The delta is recomputed from a live Loyverse read, so a crafted body
        cannot move money."""
        student = StudentProfileFactory(loyverse_id='cust-1')
        CafeteriaBalance.objects.create(student=student, balance=Decimal('100'))

        api_client.force_authenticate(AdminFactory())
        with patch('apps.cafeteria.views.get_customer_by_id', return_value={'total_points': 90}), \
             patch('apps.cafeteria.views.get_balance_from_customer', return_value=Decimal('90')):
            api_client.post(reverse('admin-reconcile-fix', args=[student.pk]),
                            {'delta': '9999', 'balance': '9999'}, format='json')

        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('90')

    def test_refuses_an_unlinked_student(self, api_client):
        student = StudentProfileFactory(loyverse_id='')
        api_client.force_authenticate(AdminFactory())
        assert self._fix(api_client, student).status_code == 400

    def test_is_admin_only(self, api_client):
        student = StudentProfileFactory(loyverse_id='cust-1')
        api_client.force_authenticate(ParentFactory())
        assert self._fix(api_client, student).status_code == 403
