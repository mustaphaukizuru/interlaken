"""Parent-dashboard cafeteria spending-trend endpoint: daily purchase totals,
zero-filled, purchases-only, scoped to the caller's students."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaTransaction

pytestmark = pytest.mark.django_db
URL = reverse('cafeteria-spending-trend')


def _tx(student, amount, days_ago, ttype='purchase'):
    # loyverse_receipt_id is unique — give each row its own so blanks don't collide.
    return CafeteriaTransaction.objects.create(
        student=student,
        transaction_type=ttype,
        amount=Decimal(str(amount)),
        date=timezone.now() - timedelta(days=days_ago),
        loyverse_receipt_id=uuid4().hex,
    )


class TestSpendingTrend:
    def test_zero_filled_purchases_only(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory()
        student.parents.add(parent)
        _tx(student, 45, 2)
        _tx(student, 30, 1)
        _tx(student, 500, 1, ttype='topup')   # top-ups are not spending

        api_client.force_authenticate(parent)
        resp = api_client.get(URL, {'days': 30})
        assert resp.status_code == 200, resp.content
        body = resp.json()
        assert body['days'] == 30
        assert len(body['series']) == 30                    # continuous / zero-filled
        assert body['total'] == 75.0                        # 45 + 30, topup excluded
        assert sum(p['amount'] for p in body['series']) == 75.0

    def test_scoped_to_own_children(self, api_client):
        parent = ParentFactory()
        mine = StudentProfileFactory()
        mine.parents.add(parent)
        other = StudentProfileFactory()                     # different family
        _tx(mine, 40, 1)
        _tx(other, 999, 1)

        api_client.force_authenticate(parent)
        body = api_client.get(URL, {'days': 30}).json()
        assert body['total'] == 40.0                        # other family's spend excluded

    def test_days_clamped(self, api_client):
        api_client.force_authenticate(ParentFactory())
        assert len(api_client.get(URL, {'days': 5}).json()['series']) == 7     # min 7
        assert len(api_client.get(URL, {'days': 999}).json()['series']) == 90  # max 90

    def test_requires_auth(self, api_client):
        assert api_client.get(URL).status_code in (401, 403)
