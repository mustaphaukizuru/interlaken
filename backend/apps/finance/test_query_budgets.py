"""P7 query budget: the admin invoice list stays O(1) in invoice count.

Parametrizes small-N vs 3N (both within page 1) and asserts the SAME pinned
constant — locks in the current clean select_related shape.
"""
from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.finance.models import Invoice

pytestmark = pytest.mark.django_db

# pagination count + page rows (student__user joined via select_related).
ADMIN_INVOICES_BUDGET = 2


class TestAdminInvoiceListBudget:
    @pytest.mark.parametrize('n_invoices', [4, 12])
    def test_constant_queries_regardless_of_invoice_count(
            self, api_client, django_assert_num_queries, n_invoices):
        admin = AdminFactory()
        for _ in range(n_invoices):
            Invoice.objects.create(
                student=StudentProfileFactory(),
                period='2026-08', due_date=date(2026, 8, 10),
                amount=Decimal('2500.00'), status=Invoice.Status.PENDING,
            )

        api_client.force_authenticate(admin)
        with django_assert_num_queries(ADMIN_INVOICES_BUDGET):
            resp = api_client.get(reverse('finance-admin-invoices'))
        assert resp.status_code == 200
        assert resp.data['count'] == n_invoices
