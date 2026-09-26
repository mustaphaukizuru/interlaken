"""Data Ops Phase 10 query budgets: the ARCO admin export and the family
ARCO Acceso export (``/legal/arco/export/``).

Each test parametrizes a small and a large row count and asserts the SAME
constant. The household export used to read the wallet and the ledger once
per child; it now reads them once per household.
"""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
from apps.legal.models import ArcoRequest

pytestmark = pytest.mark.django_db

# count + annotated rows + audit insert.
ARCO_EXPORT_BUDGET = 3
# children, consents, payments, bookings, ARCO requests, balances, ledger.
# Was 5 + 2 per child before Phase 10.
HOUSEHOLD_EXPORT_BUDGET = 7


def _body(resp) -> bytes:
    return b"".join(resp.streaming_content) if resp.streaming else resp.content


def _csv_lines(resp) -> list[str]:
    return [line for line in _body(resp).decode("utf-8-sig").split("\r\n")[1:] if line]


@pytest.mark.parametrize("n", [1, 12])
def test_admin_arco_export(api_client, django_assert_num_queries, n):
    for i in range(n):
        ArcoRequest.objects.create(
            requester_email=f"r{i}@t.mx",
            request_type="access",
            statutory_deadline=timezone.localdate() + timedelta(days=5),
        )
    api_client.force_authenticate(AdminFactory())
    with django_assert_num_queries(ARCO_EXPORT_BUDGET):
        resp = api_client.get(reverse("legal-admin-arco-export"))
        assert len(_csv_lines(resp)) == n


@pytest.mark.parametrize("n", [1, 6])
def test_household_export(api_client, django_assert_num_queries, n):
    parent = ParentFactory()
    for _ in range(n):
        child = StudentProfileFactory(parents=[parent])
        CafeteriaBalance.objects.create(student=child, balance=Decimal("40.00"))
        for j in range(2):
            CafeteriaTransaction.objects.create(
                student=child,
                transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                amount=Decimal("5.00"),
                loyverse_receipt_id=f"hh-{child.pk}-{j}",
            )
    api_client.force_authenticate(parent)
    with django_assert_num_queries(HOUSEHOLD_EXPORT_BUDGET):
        resp = api_client.get(reverse("legal-arco-export"))
    assert resp.status_code == 200
    assert len(resp.data["children"]) == n
    assert all(c["cafeteria_balance"] == "40.00" for c in resp.data["children"])
    assert all(len(c["cafeteria_transactions"]) == 2 for c in resp.data["children"])
