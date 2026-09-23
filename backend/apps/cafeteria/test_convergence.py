"""The cafetería ledger converges with Loyverse on its own, for every student.

2026-09-23 production audit: 27 students sat above Loyverse by $623 in total,
all of it phantom "recargas en caja" credited by the POS mirror when Loyverse's
customers.update carried a pre-sale points snapshot seconds after the receipt
had already been debited. 36 students pointed at customers Loyverse no longer
had, silently. Receipts for unlinked customers were counted and dropped. These
tests pin every one of those behaviours to its fix.
"""
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.accounts.models import StudentProfile
from apps.cafeteria import services as S
from apps.cafeteria.models import (
    BalanceAdjustment,
    CafeteriaBalance,
    CafeteriaTransaction,
    LoyverseSyncState,
    UnmatchedReceipt,
)
from apps.core.models import OpsStatus

SECRET = 'test-webhook-secret'


def customer(uuid, points, **extra):
    return {'id': uuid, 'total_points': points, **extra}


def seeded(student, balance, *, seeded_at=None, last_synced=None):
    now = timezone.now()
    return CafeteriaBalance.objects.create(
        student=student, balance=Decimal(str(balance)),
        last_synced=last_synced or now, seeded_at=seeded_at)


def receipt(number, customer_id, points, *, when=None, kind='SALE'):
    when = when or timezone.now()
    return {
        'receipt_number': number, 'customer_id': customer_id, 'receipt_type': kind,
        'receipt_date': when.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'total_money': 0,
        'total_discounts': [{'type': 'DISCOUNT_BY_POINTS', 'money_amount': points}],
        'line_items': [{'item_name': 'Torta', 'quantity': 1, 'total_money': 0,
                        'line_discounts': [{'type': 'DISCOUNT_BY_POINTS', 'money_amount': points}]}],
    }


def purchase(student, amount, *, ago=timedelta(0), ref=None):
    """A PURCHASE row recorded ``ago`` before now (both stamps)."""
    when = timezone.now() - ago
    ref = ref or f'r-{student.id}-{int(when.timestamp() * 1000)}'
    return CafeteriaTransaction.objects.create(
        student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
        amount=Decimal(str(amount)), loyverse_receipt_id=ref, date=when, recorded_at=when)


def pos_topup(student, amount, *, ago=timedelta(0)):
    when = timezone.now() - ago
    return CafeteriaTransaction.objects.create(
        student=student, transaction_type=CafeteriaTransaction.TxType.TOPUP,
        amount=Decimal(str(amount)), date=when, recorded_at=when,
        description='Recarga en caja de cafetería (POS Loyverse)',
        loyverse_receipt_id=f'pos-topup-{student.id}-{int(when.timestamp())}')


# ── The race that produced the drift ─────────────────────────────────────────

@pytest.mark.django_db
class TestPhantomRace:
    def test_a_stale_snapshot_right_after_a_purchase_is_deferred_not_credited(self):
        """Loyverse says 246 (pre-sale) three seconds after we debited 68."""
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 178)
        purchase(s, 68)

        r = S.mirror_pos_topups(customers=[customer('u1', 246)])

        assert r['credited'] == 0 and r['deferred'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('178')
        assert not CafeteriaTransaction.objects.filter(student=s, transaction_type='topup').exists()

    def test_the_same_echo_minutes_later_is_still_held_back(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 178)
        purchase(s, 68, ago=timedelta(minutes=10))

        r = S.mirror_pos_topups(customers=[customer('u1', 246)])

        assert r['deferred'] == 1 and r['credited'] == 0

    def test_a_genuine_recarga_once_the_ledger_has_settled_is_credited(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 178)
        purchase(s, 68, ago=timedelta(minutes=20))

        r = S.mirror_pos_topups(customers=[customer('u1', 378)])

        assert r['credited'] == 1 and r['total'] == Decimal('200')
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('378')

    def test_a_recarga_of_a_different_amount_right_after_a_purchase_waits_one_tick(self):
        """Any movement in the settle window defers; the next pass credits it."""
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 178)
        purchase(s, 68)

        r = S.mirror_pos_topups(customers=[customer('u1', 378)])

        assert r['deferred'] == 1 and r['credited'] == 0

    def test_webhook_order_that_caused_the_2026_09_23_drift(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 246)
        url = reverse('cafeteria-loyverse-webhook-token', args=[SECRET])

        first = api_client.post(url, {'type': 'receipts.update',
                                      'receipts': [receipt('5-51887', 'u1', 68)]}, format='json')
        second = api_client.post(url, {'type': 'customers.update',
                                       'customers': [customer('u1', 246)]}, format='json')

        assert first.json()['created'] == 1
        assert second.json()['credited'] == 0
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('178')
        assert CafeteriaTransaction.objects.filter(student=s).count() == 1

    def test_every_student_compared_gets_last_synced_stamped(self):
        """386 of 386 within 24h, not 53: the roster column must mean something."""
        old = timezone.now() - timedelta(days=3)
        agree = StudentProfileFactory(loyverse_id='a')
        above = StudentProfileFactory(loyverse_id='b')
        seeded(agree, 50, last_synced=old)
        seeded(above, 90, last_synced=old)

        S.mirror_pos_topups(customers=[customer('a', 50), customer('b', 70)])

        for st in (agree, above):
            assert CafeteriaBalance.objects.get(student=st).last_synced > old


# ── Roster audit on every full pass ──────────────────────────────────────────

@pytest.mark.django_db
class TestRosterAudit:
    def test_full_pass_flags_a_link_whose_customer_vanished_and_clears_it_when_back(self):
        s = StudentProfileFactory(loyverse_id='gone')
        seeded(s, 10)

        with patch('apps.cafeteria.services.get_all_customers', return_value=[]):
            r = S.mirror_pos_topups()
        s.refresh_from_db()
        assert s.loyverse_missing_since is not None
        assert r['audit']['stale_links'] == 1
        assert OpsStatus.get('wallet_audit')['stale_links'] == 1

        with patch('apps.cafeteria.services.get_all_customers', return_value=[customer('gone', 10)]):
            r = S.mirror_pos_topups()
        s.refresh_from_db()
        assert s.loyverse_missing_since is None
        assert r['audit']['stale_links'] == 0

    def test_a_partial_webhook_payload_never_flags_anyone(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 10)

        r = S.mirror_pos_topups(customers=[customer('someone-else', 5)])

        s.refresh_from_db()
        assert s.loyverse_missing_since is None
        assert 'audit' not in r

    def test_audit_separates_student_looking_customers_from_staff_cards(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 10)
        customers = [
            customer('u1', 10),
            customer('staff', 40, customer_code='169', email='jsoto@interlaken.com.mx'),
            customer('newkid', 0, customer_code='ci10999', email='ci10999@interlaken.com.mx'),
        ]
        with patch('apps.cafeteria.services.get_all_customers', return_value=customers):
            audit = S.mirror_pos_topups()['audit']

        assert audit['compared'] == 1
        assert audit['unlinked_customers'] == 2
        assert audit['unlinked_students'] == 1

    def test_drift_is_reported_with_its_total(self):
        a, b = StudentProfileFactory(loyverse_id='a'), StudentProfileFactory(loyverse_id='b')
        seeded(a, 100)
        seeded(b, 100)
        with patch('apps.cafeteria.services.get_all_customers',
                   return_value=[customer('a', 32), customer('b', 100)]):
            audit = S.mirror_pos_topups()['audit']
        assert audit['drifting'] == 1
        assert Decimal(audit['drift_total']) == Decimal('-68')


# ── Receipts that arrive before their student is linked ──────────────────────

@pytest.mark.django_db
class TestUnmatchedReceipts:
    def test_a_wallet_receipt_for_an_unlinked_customer_is_parked_not_dropped(self):
        r = S.record_receipts([receipt('n1', 'stranger', 30)], students={})
        assert r['unmatched'] == 1
        parked = UnmatchedReceipt.objects.get(receipt_number='n1')
        assert parked.customer_id == 'stranger' and parked.points == Decimal('30')
        assert parked.resolved_at is None

    def test_a_cash_only_receipt_is_not_parked(self):
        S.record_receipts([receipt('n2', 'stranger', 0)], students={})
        assert not UnmatchedReceipt.objects.exists()

    def test_redelivery_parks_it_once(self):
        S.record_receipts([receipt('n1', 'stranger', 30)], students={})
        S.record_receipts([receipt('n1', 'stranger', 30)], students={})
        assert UnmatchedReceipt.objects.count() == 1

    def test_replayed_once_the_customer_is_linked(self):
        s = StudentProfileFactory(loyverse_id='')
        seeded(s, 100, seeded_at=timezone.now() - timedelta(days=2))
        S.record_receipts([receipt('n1', 'c1', 30, when=timezone.now() - timedelta(days=1))],
                          students={})

        with patch('apps.cafeteria.services._notify_purchase') as notify:
            report = S.link_students_to_loyverse(
                [customer('c1', 70, customer_code=s.student_id)], commit=True)

        assert report['replay']['replayed'] == 1 and report['replay']['created'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('70')
        parked = UnmatchedReceipt.objects.get(receipt_number='n1')
        assert parked.resolved_at is not None and parked.resolved_student_id == s.id
        assert notify.call_count == 0, 'history is replayed silently'

        # A second replay finds nothing pending and the unique receipt id would
        # refuse a double debit anyway.
        assert S.replay_unmatched_receipts()['replayed'] == 0
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('70')

    def test_receipts_older_than_the_opening_balance_are_absorbed_not_debited(self):
        """The seed copied Loyverse points that already net this purchase."""
        s = StudentProfileFactory(loyverse_id='')
        seeded(s, 100, seeded_at=timezone.now())
        S.record_receipts([receipt('old', 'c1', 30, when=timezone.now() - timedelta(days=1))],
                          students={})

        report = S.link_students_to_loyverse(
            [customer('c1', 100, customer_code=s.student_id)], commit=True)

        assert report['replay'] == {'replayed': 0, 'absorbed': 1, 'created': 0, 'pending': 0}
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('100')
        assert UnmatchedReceipt.objects.get(receipt_number='old').resolved_at is not None

    def test_import_of_a_new_pupil_absorbs_receipts_into_the_seed(self):
        S.record_receipts([receipt('n9', 'newkid', 25, when=timezone.now() - timedelta(hours=1))],
                          students={})
        cust = customer('newkid', 75, customer_code='ci10999', name='Perez Lopez Ana-1PRI',
                        address='1PRI', email='ci10999@interlaken.com.mx')

        report = S.import_students_from_loyverse([cust], commit=True)

        s = StudentProfile.objects.get(student_id='10999')
        assert report['created'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('75')
        assert report['replay']['absorbed'] == 1 and report['replay']['replayed'] == 0


# ── Nightly backfill window ──────────────────────────────────────────────────

@pytest.mark.django_db
class TestBackfillWindow:
    def test_since_days_reads_a_trailing_window_and_lands_a_receipt_behind_the_cursor(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 100)
        state = LoyverseSyncState.load()
        state.last_purchases_cursor = timezone.now()
        state.save()
        late = receipt('late-1', 'u1', 15, when=timezone.now() - timedelta(days=3))
        seen = {}

        def fake_get_receipts(since=None, **kw):
            seen['since'] = since
            return [late]

        with patch('apps.cafeteria.services.get_receipts', side_effect=fake_get_receipts):
            r = S.sync_purchases(since_days=7)

        assert r['created'] == 1
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('85')
        assert seen['since'].startswith((timezone.now() - timedelta(days=7)).strftime('%Y-%m-%d'))
        # The window never drags the cursor backwards.
        assert LoyverseSyncState.load().last_purchases_cursor >= state.last_purchases_cursor

    def test_command_flag(self):
        with patch('apps.cafeteria.management.commands.sync_purchases.sync_purchases',
                   return_value={'receipts': 0, 'created': 0, 'notified': 0, 'unmatched': 0,
                                 'skipped': 0, 'students': 0}) as run:
            call_command('sync_purchases', '--since-days', '7', stdout=StringIO())
        run.assert_called_once_with(since_days=7)


# ── Cleaning up the phantoms already written ─────────────────────────────────

@pytest.mark.django_db
class TestPhantomRepair:
    def test_finds_only_echo_pairs_inside_the_window(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 246)
        echo = pos_topup(s, 68)
        purchase(s, 68, ago=timedelta(seconds=3))
        pos_topup(s, 200, ago=timedelta(hours=2))          # a real recarga, no purchase near it
        purchase(s, 50, ago=timedelta(hours=5))
        pos_topup(s, 50, ago=timedelta(hours=4))            # same amount, an hour apart: not an echo

        pairs = S.find_phantom_topups()

        assert [p[0].id for p in pairs] == [echo.id]

    def test_reversal_is_audited_and_idempotent(self):
        s = StudentProfileFactory(loyverse_id='u1')
        seeded(s, 246)
        echo = pos_topup(s, 68)

        adj = S.reverse_phantom_topup(echo, reason='prueba')
        again = S.reverse_phantom_topup(echo, reason='prueba')

        assert again is None
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('178')
        assert adj.amount == Decimal('-68') and adj.source_transaction_id == echo.id
        assert adj.transaction.transaction_type == CafeteriaTransaction.TxType.ADJUSTMENT
        assert BalanceAdjustment.objects.count() == 1
        assert S.find_phantom_topups() == []

    def test_command_dry_run_writes_nothing_and_commit_reverses_only_real_drift(self):
        drifting = StudentProfileFactory(loyverse_id='a')
        seeded(drifting, 246)
        pos_topup(drifting, 68)
        purchase(drifting, 68, ago=timedelta(seconds=3))
        absorbed = StudentProfileFactory(loyverse_id='b')     # balance already right
        seeded(absorbed, 100)
        pos_topup(absorbed, 50)
        purchase(absorbed, 50, ago=timedelta(seconds=2))
        customers = [customer('a', 178), customer('b', 100)]

        with patch('apps.cafeteria.services.get_all_customers', return_value=customers):
            dry = StringIO()
            call_command('repair_phantom_topups', stdout=dry)
            assert 'DRY RUN' in dry.getvalue()
            assert CafeteriaBalance.objects.get(student=drifting).balance == Decimal('246')

            out = StringIO()
            call_command('repair_phantom_topups', '--commit', stdout=out)

        assert CafeteriaBalance.objects.get(student=drifting).balance == Decimal('178')
        assert CafeteriaBalance.objects.get(student=absorbed).balance == Decimal('100')
        assert 'REVERTIDA' in out.getvalue() and 'absorbida' in out.getvalue()
        assert BalanceAdjustment.objects.filter(student=drifting).count() == 1
        assert not BalanceAdjustment.objects.filter(student=absorbed).exists()


# ── The daily alarm and the console ──────────────────────────────────────────

@pytest.mark.django_db
class TestDailyDriftAlarm:
    def test_quiet_when_everything_converged(self):
        OpsStatus.set('wallet_audit', {'compared': 386, 'drifting': 0, 'drift_total': '0',
                                       'stale_links': 0, 'unlinked_students': 0,
                                       'unmatched_receipts': 0})
        AdminFactory()
        with patch('apps.portal.services.send_email') as send:
            out = StringIO()
            call_command('check_wallet_drift', stdout=out)
        send.assert_not_called()
        assert 'converged' in out.getvalue()

    def test_emails_every_active_admin_when_anything_is_off(self):
        OpsStatus.set('wallet_audit', {'compared': 386, 'drifting': 2, 'drift_total': '-123.00',
                                       'stale_links': 36, 'unlinked_students': 1,
                                       'unmatched_receipts': 4})
        a1, a2 = AdminFactory(), AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            out = StringIO()
            call_command('check_wallet_drift', stdout=out)
        assert 'WALLET DRIFT' in out.getvalue()
        subject, body, recipients = send.call_args.args[:3]
        assert set(recipients) == {a1.email, a2.email}
        assert '123.00' in body and '36' in body and 'Vincular Loyverse' in body


@pytest.mark.django_db
class TestConsoleSeesTheAudit:
    def test_sync_health_carries_audit_stale_links_and_parked_receipts(self, api_client):
        s = StudentProfileFactory(loyverse_id='gone', loyverse_missing_since=timezone.now())
        seeded(s, 5)
        S.record_receipts([receipt('p1', 'nobody', 12)], students={})
        OpsStatus.set('wallet_audit', {'compared': 1, 'drifting': 0, 'drift_total': '0'})
        api_client.force_authenticate(AdminFactory())

        with patch('apps.cafeteria.services.loyverse_reachable', return_value=(True, '')):
            data = api_client.get(reverse('admin-sync-health')).json()

        assert data['stale_links'] == 1
        assert data['unmatched_receipts'] == 1
        assert data['wallet_audit']['compared'] == 1


@pytest.mark.django_db
class TestSyncRosterCommand:
    def test_creates_the_pupil_the_cashier_enrolled_and_reports(self):
        existing = StudentProfileFactory(loyverse_id='u1')
        seeded(existing, 10)
        customers = [
            customer('u1', 10, customer_code=f'ci{existing.student_id}'),
            customer('newkid', 40, customer_code='ci10777', name='Ruiz Soto Ana-2PRI',
                     address='2PRI', email='ci10777@interlaken.com.mx'),
            customer('staff', 99, customer_code='170', email='nrivera@interlaken.com.mx'),
        ]
        with patch('apps.cafeteria.services.get_all_customers', return_value=customers):
            out = StringIO()
            call_command('sync_roster', stdout=out)

        new = StudentProfile.objects.get(student_id='10777')
        assert new.loyverse_id == 'newkid'
        assert CafeteriaBalance.objects.get(student=new).balance == Decimal('40')
        assert not StudentProfile.objects.filter(student_id='170').exists()
        assert '1 created' in out.getvalue()
