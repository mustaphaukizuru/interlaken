"""P7 query budgets: family balance + admin deposits log stay O(1) in N.

Each test parametrizes small-N vs 3N and asserts the SAME pinned constant, so
any reintroduced per-row query (N+1) fails the budget instead of slipping by.
"""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaTransaction, TopUpRequest
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

# students + bulk-create missing balances + balances (user joined) + spend map.
BALANCE_BUDGET = 4
# pagination count + page rows (student/POS users joined) + payments prefetch.
TOPUP_LOG_BUDGET = 3


class TestBalanceBudget:
    @pytest.mark.parametrize('n_children', [1, 3])
    def test_constant_queries_regardless_of_family_size(
            self, api_client, django_assert_num_queries, n_children):
        parent = ParentFactory()
        for _ in range(n_children):
            student = StudentProfileFactory(parents=[parent])
            CafeteriaTransaction.objects.create(
                student=student,
                transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                amount=Decimal('25.00'), loyverse_receipt_id=f'p7-{student.pk}',
            )

        api_client.force_authenticate(parent)
        with django_assert_num_queries(BALANCE_BUDGET):
            resp = api_client.get(reverse('cafeteria-balance'))
        assert resp.status_code == 200
        assert len(resp.data) == n_children
        # Spend map still feeds the budget bars for every child. Compare as
        # Decimal: SQLite aggregates drop trailing zeros ('25' vs '25.00').
        assert all(Decimal(row['today_spend']) == Decimal('25') for row in resp.data)
        assert all(Decimal(row['week_spend']) == Decimal('25') for row in resp.data)


class TestTopUpLogBudget:
    @pytest.mark.parametrize('n_rows', [4, 12])
    def test_constant_queries_regardless_of_row_count(
            self, api_client, django_assert_num_queries, n_rows):
        admin = AdminFactory()
        parent = ParentFactory()
        for _ in range(n_rows):
            student = StudentProfileFactory(parents=[parent])
            topup = TopUpRequest.objects.create(
                student=student, amount=Decimal('100.00'),
                method=TopUpRequest.Method.ONLINE,
                status=TopUpRequest.Status.COMPLETED,
            )
            Payment.objects.create(
                user=parent, payment_type=Payment.Type.CAFETERIA,
                amount=Decimal('100.00'), related_topup=topup,
                status=Payment.Status.SUCCESS,
            )

        api_client.force_authenticate(admin)
        with django_assert_num_queries(TOPUP_LOG_BUDGET):
            resp = api_client.get(reverse('admin-topups'))
        assert resp.status_code == 200
        assert resp.data['count'] == n_rows
        # The linked gateway payment must still be resolved (via the prefetch).
        assert all(row['payment_status'] == Payment.Status.SUCCESS
                   for row in resp.data['results'])
