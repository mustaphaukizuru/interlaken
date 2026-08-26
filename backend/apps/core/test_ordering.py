"""Whitelisted ?ordering= on the admin data tables (apps.core.ordering).

Sorting has to happen server-side: re-ordering the twenty rows of page 1 in the
browser answers a different question than "which was the largest top-up".
"""
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaTransaction


@pytest.mark.django_db
class TestTransactionOrdering:
    def _rows(self, api_client, **params):
        return api_client.get(reverse('cafeteria-transactions'), params).json()['results']

    @pytest.fixture
    def ledger(self):
        student = StudentProfileFactory()
        now = timezone.now()
        for i, amount in enumerate((Decimal('10'), Decimal('250'), Decimal('80'))):
            CafeteriaTransaction.objects.create(
                student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                amount=amount, description=f'tx{i}',
                # unique=True on a blank field: every creator stamps a synthetic
                # reference (see services.adjust_balance), so tests must too.
                loyverse_receipt_id=f'test-order-{i}',
                date=now - timezone.timedelta(days=i))
        return student

    def test_defaults_to_newest_first(self, api_client, ledger):
        api_client.force_authenticate(AdminFactory())
        rows = self._rows(api_client)
        assert [r['amount'] for r in rows] == ['10.00', '250.00', '80.00']

    def test_sorts_by_amount_both_ways(self, api_client, ledger):
        api_client.force_authenticate(AdminFactory())
        assert [r['amount'] for r in self._rows(api_client, ordering='amount')] \
            == ['10.00', '80.00', '250.00']
        assert [r['amount'] for r in self._rows(api_client, ordering='-amount')] \
            == ['250.00', '80.00', '10.00']

    def test_unknown_column_falls_back_instead_of_erroring(self, api_client, ledger):
        """A stale bookmark must not 500 an admin mid-workflow."""
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(reverse('cafeteria-transactions'), {'ordering': 'student__user__password'})
        assert resp.status_code == 200
        assert [r['amount'] for r in resp.json()['results']] == ['10.00', '250.00', '80.00']

    def test_ties_are_broken_so_pagination_cannot_hide_a_row(self, api_client):
        """Same timestamp on every row: without the -pk tiebreak the page split
        is undefined and a row can appear on both pages, or neither."""
        student = StudentProfileFactory()
        stamp = timezone.now()
        for i in range(5):
            CafeteriaTransaction.objects.create(
                student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                amount=Decimal('20'), description=f'same-{i}',
                loyverse_receipt_id=f'test-tie-{i}', date=stamp)

        api_client.force_authenticate(AdminFactory())
        first = [r['id'] for r in self._rows(api_client)]
        second = [r['id'] for r in self._rows(api_client)]
        assert first == second
        assert len(set(first)) == 5
