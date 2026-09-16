"""Loyverse customers.update webhook → POS recargas land in seconds.

Registered on 2026-09-16 alongside receipts.update. Loyverse pushes the changed
customer objects (total_points included) the moment a cash recarga is loaded on
the POS tablet, so the credit no longer waits for the 5-minute mirror tick.
"""
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

SECRET = 'test-webhook-secret'


def hook_url():
    return reverse('cafeteria-loyverse-webhook-token', args=[SECRET])


@pytest.mark.django_db
class TestCustomersUpdateWebhook:
    def test_credits_the_pos_recarga_immediately(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        s = StudentProfileFactory(loyverse_id='u1')
        CafeteriaBalance.objects.create(student=s, balance=Decimal('20'), last_synced=timezone.now())

        resp = api_client.post(hook_url(), {
            'merchant_id': 'm', 'type': 'customers.update',
            'customers': [{'id': 'u1', 'total_points': 220}],
        }, format='json')

        assert resp.status_code == 200
        assert resp.json()['event'] == 'customers.update'
        assert resp.json()['credited'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('220')
        tx = CafeteriaTransaction.objects.get(student=s)
        assert tx.transaction_type == CafeteriaTransaction.TxType.TOPUP
        assert tx.amount == Decimal('200')

    def test_a_redelivery_is_a_no_op(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        s = StudentProfileFactory(loyverse_id='u1')
        CafeteriaBalance.objects.create(student=s, balance=Decimal('20'), last_synced=timezone.now())
        body = {'type': 'customers.update', 'customers': [{'id': 'u1', 'total_points': 220}]}

        api_client.post(hook_url(), body, format='json')
        second = api_client.post(hook_url(), body, format='json')

        assert second.json()['credited'] == 0
        assert CafeteriaTransaction.objects.filter(student=s).count() == 1

    def test_never_debits_from_a_customer_event(self, api_client, settings):
        """A purchase lowers total_points too, but that is the receipt event's
        job: the customer event must not race it into a double debit."""
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        s = StudentProfileFactory(loyverse_id='u1')
        CafeteriaBalance.objects.create(student=s, balance=Decimal('100'), last_synced=timezone.now())

        api_client.post(hook_url(), {'type': 'customers.update',
                                     'customers': [{'id': 'u1', 'total_points': 65}]}, format='json')

        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('100')

    def test_receipts_event_still_takes_the_receipt_path(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        s = StudentProfileFactory(loyverse_id='u1')
        CafeteriaBalance.objects.create(student=s, balance=Decimal('100'), last_synced=timezone.now())

        resp = api_client.post(hook_url(), {
            'type': 'receipts.update',
            'receipts': [{
                'receipt_number': 'w-1', 'customer_id': 'u1', 'receipt_type': 'SALE',
                'receipt_date': '2026-09-16T15:00:00.000Z', 'total_money': 0,
                'total_discounts': [{'type': 'DISCOUNT_BY_POINTS', 'money_amount': 35}],
                'line_items': [],
            }],
        }, format='json')

        assert resp.status_code == 200 and resp.json()['created'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('65')

    def test_wrong_secret_is_rejected(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        resp = api_client.post(reverse('cafeteria-loyverse-webhook-token', args=['nope']),
                               {'type': 'customers.update', 'customers': []}, format='json')
        assert resp.status_code == 401


@pytest.mark.django_db
class TestDeliveryIsVisible:
    """Server logs proved useless for "did Loyverse reach us?" (Caddy kept only
    the 502s). Every authenticated delivery now stamps the sync state, and the
    health panel reads it."""

    def test_stamps_the_last_delivery(self, api_client, settings):
        from apps.cafeteria.models import LoyverseSyncState
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        assert LoyverseSyncState.load().last_webhook_at is None

        api_client.post(hook_url(), {'type': 'customers.update', 'customers': []}, format='json')

        st = LoyverseSyncState.load()
        assert st.last_webhook_at is not None
        assert st.last_webhook_type == 'customers.update'

    def test_an_unauthorised_hit_does_not_count_as_a_delivery(self, api_client, settings):
        from apps.cafeteria.models import LoyverseSyncState
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        api_client.post(reverse('cafeteria-loyverse-webhook-token', args=['nope']),
                        {'type': 'customers.update', 'customers': []}, format='json')
        assert LoyverseSyncState.load().last_webhook_at is None

    def test_logs_one_line_per_delivery(self, api_client, settings, caplog):
        import logging
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        with caplog.at_level(logging.INFO, logger='apps.cafeteria.views'):
            api_client.post(hook_url(), {'type': 'receipts.update', 'receipts': []}, format='json')
        assert any('Loyverse webhook receipts.update' in r.getMessage() for r in caplog.records)

