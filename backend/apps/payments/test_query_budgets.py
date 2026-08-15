"""P7 query budget: family payment history stays O(1) in payment count.

Parametrizes small-N vs 3N (both within page 1) and asserts the SAME pinned
constant, covering both visibility branches (own payer rows + child top-ups).
"""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import TopUpRequest
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

# family student-id resolve + pagination count + page rows.
HISTORY_BUDGET = 3


class TestPaymentHistoryBudget:
    @pytest.mark.parametrize('n_payments', [4, 12])
    def test_constant_queries_regardless_of_history_size(
            self, api_client, django_assert_num_queries, n_payments):
        parent = ParentFactory()
        other = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        for i in range(n_payments):
            if i % 2:
                # Child top-up paid by the co-guardian: visible via student ids.
                topup = TopUpRequest.objects.create(
                    student=student, amount=Decimal('100.00'),
                    method=TopUpRequest.Method.ONLINE,
                )
                Payment.objects.create(
                    user=other, payment_type=Payment.Type.CAFETERIA,
                    amount=Decimal('100.00'), related_topup=topup,
                    status=Payment.Status.SUCCESS,
                )
            else:
                Payment.objects.create(
                    user=parent, payment_type=Payment.Type.TUITION,
                    amount=Decimal('2500.00'), status=Payment.Status.PENDING,
                )

        api_client.force_authenticate(parent)
        with django_assert_num_queries(HISTORY_BUDGET):
            resp = api_client.get(reverse('payment-history'))
        assert resp.status_code == 200
        assert resp.data['count'] == n_payments
