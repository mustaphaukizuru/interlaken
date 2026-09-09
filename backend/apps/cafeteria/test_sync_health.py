"""GET /cafeteria/admin/sync-health/ — "is the cafeteria sync working?".

Answering that used to require SSH-ing to the VPS and reading the cron log,
which puts the one diagnosis the office needs behind root access to a server.
Each field here maps to a distinct, separately-fixable failure.
"""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaTransaction, LoyverseSyncState

URL = reverse('admin-sync-health')


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
class TestSyncHealth:
    def test_reports_a_poll_that_has_never_run(self, api_client, monkeypatch):
        """The cron-not-installed case: no cursor, so nothing is polling."""
        monkeypatch.setattr('apps.cafeteria.services.loyverse_reachable', lambda: (True, ''))
        api_client.force_authenticate(AdminFactory())

        data = api_client.get(URL).json()

        assert data['last_purchases_cursor'] is None
        assert data['loyverse_ok'] is True

    def test_surfaces_an_unreachable_loyverse_instead_of_500ing(self, api_client, monkeypatch):
        """A dead token must show as a red light, not take the page down."""
        monkeypatch.setattr('apps.cafeteria.services.loyverse_reachable',
                            lambda: (False, '401 Unauthorized'))
        api_client.force_authenticate(AdminFactory())

        resp = api_client.get(URL)

        assert resp.status_code == 200
        assert resp.json()['loyverse_ok'] is False
        assert '401' in resp.json()['loyverse_error']

    def test_counts_linked_vs_active_so_unmatched_receipts_have_an_explanation(
            self, api_client, monkeypatch):
        monkeypatch.setattr('apps.cafeteria.services.loyverse_reachable', lambda: (True, ''))
        StudentProfileFactory(loyverse_id='cust-1')
        StudentProfileFactory(loyverse_id='cust-2')
        StudentProfileFactory(loyverse_id='')          # never linked
        api_client.force_authenticate(AdminFactory())

        data = api_client.get(URL).json()

        assert data['active_students'] == 3
        assert data['linked_students'] == 2

    def test_reports_recent_ledger_activity(self, api_client, monkeypatch):
        """A fresh cursor with a stale last transaction is the signature of a
        poll that runs, sees receipts, and records none of them."""
        monkeypatch.setattr('apps.cafeteria.services.loyverse_reachable', lambda: (True, ''))
        student = StudentProfileFactory(loyverse_id='cust-1')
        now = timezone.now()
        CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal('20'), loyverse_receipt_id='h-1', date=now - timedelta(days=1))
        CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal('20'), loyverse_receipt_id='h-2', date=now - timedelta(days=30))

        state = LoyverseSyncState.load()
        state.last_purchases_cursor = now
        state.save(update_fields=['last_purchases_cursor'])

        api_client.force_authenticate(AdminFactory())
        data = api_client.get(URL).json()

        assert data['purchases_last_7d'] == 1      # the 30-day-old one is outside the window
        assert data['transactions_last_7d'] == 1
        assert data['last_purchases_cursor'] is not None
        assert data['last_transaction_at'] is not None

    def test_is_admin_only(self, api_client):
        api_client.force_authenticate(ParentFactory())
        assert api_client.get(URL).status_code == 403

    def test_does_not_probe_loyverse_on_every_render(self, api_client, monkeypatch):
        """Opening the console must not hammer the POS API."""
        calls = []
        monkeypatch.setattr('apps.cafeteria.services.loyverse_reachable',
                            lambda: (calls.append(1), (True, ''))[1])
        api_client.force_authenticate(AdminFactory())

        api_client.get(URL)
        api_client.get(URL)

        assert len(calls) == 1
