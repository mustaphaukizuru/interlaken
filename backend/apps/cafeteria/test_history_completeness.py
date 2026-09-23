"""Purchase history is complete and recargas land at once.

2026-09-23 verification against live Loyverse: every balance matched to the
cent, but 68 receipts from before the 16 September import were absent from
the families' lists (the opening balance already netted them, so the app
rightly never debited them, and wrongly never showed them). Receipts older
than a wallet's seed are now stored as history (``applied=False``) by every
path, the one-off backfill fills the gap, and the recarga webhook re-reads
the card so a genuine cash load right after a purchase does not wait a tick.
"""
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import StudentProfileFactory
from apps.cafeteria import services as S
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, UnmatchedReceipt
from apps.cafeteria.test_convergence import customer, purchase, receipt, seeded

SECRET = 'test-webhook-secret'


@pytest.mark.django_db
class TestSeedRule:
    def test_a_receipt_older_than_the_seed_is_history_only(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 100, seeded_at=timezone.now())
        old = receipt('old-1', 'u1', 30, when=timezone.now() - timedelta(days=2))
        new = receipt('new-1', 'u1', 10, when=timezone.now() + timedelta(seconds=5))

        with patch('apps.cafeteria.services._notify_purchase') as notify:
            r = S.record_receipts([old, new], {'u1': s})

        assert r['created'] == 2
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('90')
        hist = CafeteriaTransaction.objects.get(loyverse_receipt_id='old-1')
        assert hist.applied is False and hist.balance_after is None
        assert CafeteriaTransaction.objects.get(loyverse_receipt_id='new-1').applied is True
        assert notify.call_count == 1, 'history rows are not announced'

    def test_the_nightly_window_cannot_double_charge_a_pupil_imported_this_week(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 100, seeded_at=timezone.now() - timedelta(days=1))
        last_monday = receipt('mon', 'u1', 25, when=timezone.now() - timedelta(days=3))
        with patch('apps.cafeteria.services.get_receipts', return_value=[last_monday]):
            S.sync_purchases(since_days=7)
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('100')
        assert CafeteriaTransaction.objects.get(loyverse_receipt_id='mon').applied is False

    def test_replay_stores_absorbed_receipts_as_history(self):
        s = StudentProfileFactory(loyverse_id='')
        seeded(s, 100, seeded_at=timezone.now())
        S.record_receipts([receipt('a1', 'c1', 30, when=timezone.now() - timedelta(days=1))],
                          students={})

        S.link_students_to_loyverse([customer('c1', 100, customer_code=s.student_id)], commit=True)

        row = CafeteriaTransaction.objects.get(loyverse_receipt_id='a1')
        assert row.applied is False and row.student_id == s.id
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('100')
        assert UnmatchedReceipt.objects.get(receipt_number='a1').resolved_at is not None


@pytest.mark.django_db
class TestBackfill:
    def _setup(self):
        matched = StudentProfileFactory(loyverse_id='m')
        seeded(matched, 50)
        drifting = StudentProfileFactory(loyverse_id='d')
        seeded(drifting, 80)                                   # Loyverse will say 60
        receipts = [
            receipt('r-m1', 'm', 15, when=timezone.now() - timedelta(days=9)),
            receipt('r-m2', 'm', 6, when=timezone.now() - timedelta(days=8)),
            receipt('r-d1', 'd', 20, when=timezone.now() - timedelta(days=9)),
            receipt('r-staff', 'staff', 45, when=timezone.now() - timedelta(days=9)),
            receipt('r-cash', 'm', 0, when=timezone.now() - timedelta(days=9)),
        ]
        customers = [customer('m', 50), customer('d', 60), customer('staff', 178)]
        return matched, drifting, receipts, customers

    def test_dry_run_writes_nothing(self):
        matched, _, receipts, customers = self._setup()
        with patch('apps.cafeteria.services.get_all_customers', return_value=customers), \
             patch('apps.cafeteria.services.get_receipts', return_value=receipts):
            out = StringIO()
            call_command('backfill_receipt_history', '--days', '30', stdout=out)
        assert 'DRY RUN' in out.getvalue()
        assert not CafeteriaTransaction.objects.exists()
        assert not UnmatchedReceipt.objects.exists()

    def test_commit_fills_history_without_touching_balances_and_skips_drift(self):
        matched, drifting, receipts, customers = self._setup()
        with patch('apps.cafeteria.services.get_all_customers', return_value=customers), \
             patch('apps.cafeteria.services.get_receipts', return_value=receipts), \
             patch('apps.cafeteria.services._notify_purchase') as notify:
            out = StringIO()
            call_command('backfill_receipt_history', '--days', '30', '--commit', stdout=out)

        rows = CafeteriaTransaction.objects.filter(student=matched)
        assert {r.loyverse_receipt_id for r in rows} == {'r-m1', 'r-m2'}
        assert all(r.applied is False and r.balance_after is None for r in rows)
        assert CafeteriaBalance.objects.get(student=matched).balance == Decimal('50')
        assert not CafeteriaTransaction.objects.filter(student=drifting).exists()
        assert CafeteriaBalance.objects.get(student=drifting).balance == Decimal('80')
        assert UnmatchedReceipt.objects.filter(receipt_number='r-staff').exists()
        assert notify.call_count == 0
        assert drifting.student_id in out.getvalue() and 'omitido' in out.getvalue()

        # Idempotent: a second run finds nothing left to add.
        with patch('apps.cafeteria.services.get_all_customers', return_value=customers), \
             patch('apps.cafeteria.services.get_receipts', return_value=receipts):
            out = StringIO()
            call_command('backfill_receipt_history', '--days', '30', '--commit', stdout=out)
        assert '0 history row(s)' in out.getvalue()


@pytest.mark.django_db
class TestInstantRecargas:
    def test_webhook_re_reads_the_card_and_credits_a_recarga_right_after_a_purchase(
            self, api_client, settings):
        """Kid buys $30 (recorded seconds ago), parent loads $200 at the till.
        The payload might be stale; the fresh read says 270. Credited now."""
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 70)
        purchase(s, 30)
        url = reverse('cafeteria-loyverse-webhook-token', args=[SECRET])

        with patch('apps.cafeteria.services.get_customer_by_id', return_value=customer('u1', 270)):
            resp = api_client.post(url, {'type': 'customers.update',
                                         'customers': [customer('u1', 100)]}, format='json')

        assert resp.json()['credited'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('270')

    def test_a_fresh_read_that_still_echoes_the_purchase_is_held_back(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 70)
        purchase(s, 30)
        url = reverse('cafeteria-loyverse-webhook-token', args=[SECRET])

        with patch('apps.cafeteria.services.get_customer_by_id', return_value=customer('u1', 100)):
            resp = api_client.post(url, {'type': 'customers.update',
                                         'customers': [customer('u1', 100)]}, format='json')

        assert resp.json()['credited'] == 0
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('70')

    def test_a_delta_equal_to_the_sum_of_recent_purchases_is_an_echo(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 50)
        purchase(s, 30, ago=timedelta(minutes=4))
        purchase(s, 20, ago=timedelta(minutes=3))

        r = S.mirror_pos_topups(customers=[customer('u1', 100)], fresh=True)

        assert r['deferred'] == 1 and r['credited'] == 0

    def test_when_the_re_read_fails_the_payload_is_treated_as_stale(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 70)
        purchase(s, 30)
        url = reverse('cafeteria-loyverse-webhook-token', args=[SECRET])

        with patch('apps.cafeteria.services.get_customer_by_id',
                   side_effect=S.LoyverseError('down')):
            resp = api_client.post(url, {'type': 'customers.update',
                                         'customers': [customer('u1', 270)]}, format='json')

        assert resp.json()['credited'] == 0, 'settle window applies to a possibly stale value'
