"""Paid online top-ups reach the wallet only once they are in the Loyverse POS.

The school's rule (2026-10-18): "si hago un pago, el saldo no cambia hasta que
se actualiza Loyverse". Loyverse points cannot be written by API (spec R1), so
with ``CAFETERIA_TOPUP_APPLY_MODE='scheduled'`` an approved card top-up waits
as PAID with the promised load time (next school day, 07:30), staff type it
into the POS, and the wallet is credited then: by the POS mirror when Loyverse
shows exactly that amount, or by "Aplicar" after the server confirms Loyverse
holds it. Every path shares the ``topup-payment-<id>`` ledger key, so the money
is credited once whatever happens.
"""
from datetime import datetime, timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria import schedule
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.cafeteria.services import (
    POS_APPLY_PENDING,
    TopUpApplyError,
    apply_paid_topup,
    mirror_pos_topups,
    pending_pos_loads,
    pos_queue_reasons,
    reconcile_to_loyverse,
    refund_paid_topup,
    sync_student_balance,
)
from apps.content.models import SchoolEvent
from apps.payments.gateways.base import PaymentEvent
from apps.payments.models import BanorteCheckout, Payment
from apps.payments.multicobros import online_topups_awaiting_staff
from apps.payments.settlement import settle
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db

GUARD = 'apps.cafeteria.services.loyverse_points_for_guard'


def local(*args):
    tz = timezone.get_current_timezone()
    return timezone.make_aware(datetime(*args), tz)


def seeded(student, balance):
    return CafeteriaBalance.objects.create(
        student=student, balance=Decimal(str(balance)), last_synced=timezone.now())


def paid_topup(amount='200.00', *, student=None, parent=None, checkout=None, balance=None):
    """A PAID online top-up the way settlement leaves it in scheduled mode."""
    parent = parent or ParentFactory()
    student = student or StudentProfileFactory(parents=[parent], loyverse_id='lv-1')
    if balance is not None and not CafeteriaBalance.objects.filter(student=student).exists():
        seeded(student, balance)
    topup = TopUpRequest.objects.create(
        student=student, amount=Decimal(amount), method=TopUpRequest.Method.ONLINE)
    payment = Payment.objects.create(
        user=parent, payment_type=Payment.Type.CAFETERIA, amount=Decimal(amount),
        gateway=Payment.Gateway.BANORTE, related_topup=topup, status=Payment.Status.PENDING)
    if checkout:
        BanorteCheckout.objects.create(payment=payment, control_number=f'IK{payment.pk:06d}',
                                       mode=checkout, resultado_payw='A', referencia='123456')
    settle(PaymentEvent(payment.pk, 'success', f'IK-{payment.pk}', {'test': 'ok'}),
           actor_label='test')
    topup.refresh_from_db()
    payment.refresh_from_db()
    return student, topup, payment


# ── schedule ─────────────────────────────────────────────────────────────────
class TestSchedule:
    def test_friday_evening_waits_for_monday_0730(self):
        assert schedule.next_apply_at(local(2026, 10, 16, 18, 0)) == local(2026, 10, 19, 7, 30)

    def test_early_morning_payment_joins_the_same_day_load(self):
        assert schedule.next_apply_at(local(2026, 10, 19, 6, 30)) == local(2026, 10, 19, 7, 30)

    def test_inside_the_cutoff_goes_to_the_next_school_day(self):
        assert schedule.next_apply_at(local(2026, 10, 19, 7, 10)) == local(2026, 10, 20, 7, 30)

    def test_skips_statutory_holidays(self):
        # Revolución 2026: third Monday of November = 16/11.
        assert schedule.next_apply_at(local(2026, 11, 13, 18, 0)) == local(2026, 11, 17, 7, 30)
        # Independencia (Wednesday 16/09/2026).
        assert schedule.next_apply_at(local(2026, 9, 15, 15, 0)) == local(2026, 9, 17, 7, 30)

    def test_skips_school_wide_vacations_from_the_calendar(self):
        SchoolEvent.objects.create(title='Vacaciones de invierno', kind=SchoolEvent.Kind.VACATION,
                                   start_date=datetime(2026, 12, 21).date(),
                                   end_date=datetime(2027, 1, 6).date())
        assert schedule.next_apply_at(local(2026, 12, 18, 18, 0)) == local(2027, 1, 7, 7, 30)

    def test_level_only_and_unpublished_closures_do_not_move_the_load(self):
        day = datetime(2026, 10, 19).date()
        SchoolEvent.objects.create(title='Solo preescolar', kind=SchoolEvent.Kind.HOLIDAY,
                                   start_date=day, level='preescolar')
        SchoolEvent.objects.create(title='Borrador', kind=SchoolEvent.Kind.HOLIDAY,
                                   start_date=day, is_published=False)
        assert schedule.next_apply_at(local(2026, 10, 16, 18, 0)) == local(2026, 10, 19, 7, 30)

    def test_spanish_wording_and_policy(self):
        assert schedule.format_apply_at(local(2026, 10, 19, 7, 30)) == \
            'lunes 19 de octubre a las 7:30 a.m.'
        assert schedule.format_amount(Decimal('1234.5')) == '$1,234.50'
        assert schedule.whatsapp_display() == '55 5379 1188'
        p = schedule.policy(local(2026, 10, 16, 18, 0))
        assert p['mode'] == 'scheduled' and p['apply_time'] == '07:30'
        assert p['whatsapp'] == '5553791188'
        assert p['next_apply_at'].startswith('2026-10-19T07:30')

    @override_settings(CAFETERIA_TOPUP_APPLY_TIME='nonsense', CAFETERIA_TOPUP_APPLY_MODE='bogus')
    def test_bad_settings_fall_back_safely(self):
        assert schedule.apply_time().strftime('%H:%M') == '07:30'
        assert schedule.apply_mode() == 'scheduled'


# ── payment confirmation ─────────────────────────────────────────────────────
class TestPaymentLeavesTheWalletAlone:
    def test_success_records_paid_with_a_promise_and_no_credit(self):
        student, topup, payment = paid_topup(balance=50)

        assert payment.status == Payment.Status.SUCCESS
        assert topup.status == TopUpRequest.Status.PAID
        assert topup.apply_due_at is not None and topup.apply_due_at > timezone.now()
        due = timezone.localtime(topup.apply_due_at)
        assert (due.hour, due.minute) == (7, 30) and due.weekday() < 5
        assert topup.applied_at is None
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('50')
        assert not CafeteriaTransaction.objects.filter(student=student).exists()

    def test_family_is_told_when_and_how_to_ask_for_today(self):
        student, topup, payment = paid_topup()
        note = Notification.objects.filter(user__in=student.parents.all()).latest('pk')
        assert note.title == 'Pago de recarga recibido'
        assert '7:30 a.m.' in note.message and '55 5379 1188' in note.message
        assert f'Folio: {payment.pk}' in note.message

    def test_replayed_success_is_a_no_op(self):
        student, topup, payment = paid_topup()
        status, body = settle(PaymentEvent(payment.pk, 'success', 'IK-x', {}), actor_label='t')
        assert body['detail'] == 'already_processed'
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID

    @override_settings(CAFETERIA_TOPUP_APPLY_MODE='instant')
    def test_instant_mode_keeps_the_old_behaviour(self):
        student, topup, payment = paid_topup(balance=0)
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert topup.applied_via == TopUpRequest.AppliedVia.INSTANT
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('200')
        assert topup in pending_pos_loads()

    def test_provider_refund_before_apply_closes_it_without_touching_the_wallet(self):
        student, topup, payment = paid_topup(balance=10)
        settle(PaymentEvent(payment.pk, 'refunded', 'IK-r', {}), actor_label='t')
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.REFUNDED
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('10')
        assert not CafeteriaTransaction.objects.filter(student=student).exists()


# ── staff "Aplicar" ──────────────────────────────────────────────────────────
class TestApplyPaidTopup:
    def test_applies_once_loyverse_shows_the_load(self):
        student, topup, payment = paid_topup(balance=100)
        admin = AdminFactory()
        with patch(GUARD, return_value=Decimal('300')):
            tx, balance = apply_paid_topup(topup, actor=admin)

        topup.refresh_from_db()
        assert balance == Decimal('300')
        assert tx.loyverse_receipt_id == f'topup-payment-{payment.pk}'
        assert tx.transaction_type == CafeteriaTransaction.TxType.TOPUP
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert topup.applied_via == TopUpRequest.AppliedVia.STAFF
        assert topup.applied_by == admin and topup.pos_loaded_at is not None
        assert topup not in pending_pos_loads()
        assert Notification.objects.filter(user__in=student.parents.all(),
                                           title='Recarga aplicada').exists()

    def test_refuses_while_loyverse_does_not_have_it(self):
        student, topup, payment = paid_topup(balance=100)
        with patch(GUARD, return_value=Decimal('100')), pytest.raises(TopUpApplyError) as err:
            apply_paid_topup(topup, actor=AdminFactory())
        assert err.value.code == 'pos_not_loaded'
        assert err.value.extra == {'loyverse_points': '100.00', 'wallet_balance': '100.00',
                                   'amount': '200.00'}
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('100')

    def test_unreadable_loyverse_is_refused_not_guessed(self):
        _, topup, _ = paid_topup(balance=0)
        with patch(GUARD, return_value=None), pytest.raises(TopUpApplyError) as err:
            apply_paid_topup(topup, actor=AdminFactory())
        assert err.value.code == 'pos_unknown'

    def test_force_needs_a_note_and_leaves_the_pos_load_tracked(self):
        student, topup, payment = paid_topup(balance=0)
        with pytest.raises(TopUpApplyError) as err:
            apply_paid_topup(topup, actor=AdminFactory(), force=True)
        assert err.value.code == 'note_required'

        apply_paid_topup(topup, actor=AdminFactory(), force=True, note='Compra en curso')
        topup.refresh_from_db()
        assert topup.applied_via == TopUpRequest.AppliedVia.OVERRIDE
        assert topup.pos_loaded_at is None
        assert topup in pending_pos_loads()          # still in "Cargar en POS"
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('200')

    def test_second_apply_is_refused_and_moves_nothing(self):
        student, topup, _ = paid_topup(balance=0)
        with patch(GUARD, return_value=Decimal('200')):
            apply_paid_topup(topup, actor=AdminFactory())
            with pytest.raises(TopUpApplyError) as err:
                apply_paid_topup(topup, actor=AdminFactory())
        assert err.value.code == 'already_applied'
        assert CafeteriaTransaction.objects.filter(student=student).count() == 1

    def test_unverified_real_approval_must_be_checked_in_multicobros_first(self):
        _, topup, _ = paid_topup(checkout='PRD', balance=0)
        with patch(GUARD, return_value=Decimal('200')), pytest.raises(TopUpApplyError) as err:
            apply_paid_topup(topup, actor=AdminFactory())
        assert err.value.code == 'needs_verification'

    @override_settings(PAYMENTS_LIVE=True)
    def test_simulation_is_never_applied_in_a_live_installation(self):
        _, topup, _ = paid_topup(checkout='AUT', balance=0)
        with patch(GUARD, return_value=Decimal('200')), pytest.raises(TopUpApplyError) as err:
            apply_paid_topup(topup, actor=AdminFactory())
        assert err.value.code == 'simulation'

    def test_never_seeded_wallet_gets_its_opening_balance_from_loyverse(self):
        student, topup, _ = paid_topup()
        assert not CafeteriaBalance.objects.filter(student=student).exists()
        with patch(GUARD, return_value=Decimal('530')):
            _, balance = apply_paid_topup(topup, actor=AdminFactory())
        cb = CafeteriaBalance.objects.get(student=student)
        assert balance == Decimal('530') and cb.seeded_at is not None

    def test_seed_cron_waits_while_a_paid_topup_is_pending(self):
        student, _, _ = paid_topup()
        with patch('apps.cafeteria.services.get_customer_by_id') as read:
            assert sync_student_balance(student) == Decimal('0')
        read.assert_not_called()


class TestApplyEndpoints:
    def test_admin_applies_and_parent_is_forbidden(self, api_client):
        student, topup, _ = paid_topup(balance=0)
        url = reverse('admin-topup-apply-paid', args=[topup.pk])

        api_client.force_authenticate(user=student.parents.first())
        assert api_client.post(url).status_code == 403

        api_client.force_authenticate(user=AdminFactory())
        with patch(GUARD, return_value=Decimal('200')):
            r = api_client.post(url)
        assert r.status_code == 200, r.data
        assert r.data['status'] == 'completed' and r.data['balance'] == '200.00'

    def test_refusal_carries_the_numbers_for_the_dialog(self, api_client):
        _, topup, _ = paid_topup(balance=40)
        api_client.force_authenticate(user=AdminFactory())
        with patch(GUARD, return_value=Decimal('40')):
            r = api_client.post(reverse('admin-topup-apply-paid', args=[topup.pk]))
        assert r.status_code == 409
        assert r.data['code'] == 'pos_not_loaded' and r.data['loyverse_points'] == '40.00'

    def test_pos_loaded_on_a_paid_topup_points_to_apply(self, api_client):
        _, topup, _ = paid_topup(balance=0)
        api_client.force_authenticate(user=AdminFactory())
        r = api_client.post(reverse('admin-topup-pos-loaded', args=[topup.pk]))
        assert r.status_code == 400 and r.data['code'] == 'use_apply'

    def test_queue_lists_paid_topups_with_what_staff_need(self, api_client):
        student, topup, payment = paid_topup(balance=0)
        TopUpRequest.objects.filter(pk=topup.pk).update(
            apply_due_at=timezone.now() - timedelta(hours=1))
        api_client.force_authenticate(user=AdminFactory())

        r = api_client.get(reverse('admin-topups'), {'needs_apply': 1})
        assert r.status_code == 200
        row = r.data['results'][0]
        assert row['id'] == topup.pk and row['needs_apply'] is True
        assert row['apply_overdue'] is True and row['payment_id'] == payment.pk
        assert row['wallet_balance'] == '0.00'

        by_folio = api_client.get(reverse('admin-topups'), {'q': f'folio {payment.pk}'})
        assert [x['id'] for x in by_folio.data['results']] == [topup.pk]

    def test_bulk_apply_reports_rows_loyverse_does_not_show(self, api_client):
        _, loaded, _ = paid_topup('100.00', balance=0)
        other_parent = ParentFactory()
        other = StudentProfileFactory(parents=[other_parent], loyverse_id='lv-2')
        _, missing, _ = paid_topup('50.00', student=other, parent=other_parent, balance=0)
        api_client.force_authenticate(user=AdminFactory())

        def points(student):
            return Decimal('100') if student.loyverse_id == 'lv-1' else Decimal('0')

        with patch(GUARD, side_effect=points):
            r = api_client.post(reverse('admin-topups-bulk'),
                                {'action': 'apply_paid', 'ids': [loaded.pk, missing.pk]},
                                format='json')
        assert r.status_code == 200, r.data
        assert r.data['ok'] == 1 and r.data['total'] == '100.00'
        assert [f['id'] for f in r.data['failed']] == [missing.pk]
        assert 'Loyverse aún no muestra' in r.data['failed'][0]['error']

    def test_refund_before_apply_needs_both_confirmations(self, api_client):
        student, topup, payment = paid_topup(checkout='PRD', balance=5)
        url = reverse('admin-topup-refund-paid', args=[topup.pk])
        api_client.force_authenticate(user=AdminFactory())

        r = api_client.post(url, {'note': 'Pidió devolución'}, format='json')
        assert r.status_code == 400 and r.data['code'] == 'bank_refund_required'
        r = api_client.post(url, {'note': 'Pidió devolución', 'bank_refund_confirmed': True},
                            format='json')
        assert r.data['code'] == 'pos_confirmation_required'
        r = api_client.post(url, {'note': 'Pidió devolución', 'bank_refund_confirmed': True,
                                  'pos_not_loaded_confirmed': True}, format='json')
        assert r.status_code == 200, r.data

        topup.refresh_from_db()
        payment.refresh_from_db()
        assert topup.status == TopUpRequest.Status.REFUNDED
        assert payment.status == Payment.Status.REFUNDED
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('5')
        assert not pos_queue_reasons([student.pk])

    def test_refund_of_an_applied_topup_is_sent_to_the_ledger_refund(self):
        _, topup, _ = paid_topup(balance=0)
        with patch(GUARD, return_value=Decimal('200')):
            apply_paid_topup(topup, actor=AdminFactory())
        with pytest.raises(TopUpApplyError) as err:
            refund_paid_topup(topup, actor=AdminFactory(), note='x', pos_not_loaded_confirmed=True)
        assert err.value.code == 'not_paid'


# ── the POS mirror applies what staff typed into Loyverse ────────────────────
class TestMirrorAppliesPaidTopups:
    def test_exact_gap_applies_the_paid_topup_not_a_cash_recarga(self):
        student, topup, payment = paid_topup(balance=100)

        r = mirror_pos_topups(customers=[{'id': 'lv-1', 'total_points': 300}])

        assert r['applied_paid'] == 1 and r['credited'] == 0
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert topup.applied_via == TopUpRequest.AppliedVia.POS_SYNC
        assert topup.pos_loaded_at is not None
        tx = CafeteriaTransaction.objects.get(student=student)
        assert tx.loyverse_receipt_id == f'topup-payment-{payment.pk}'
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('300')
        assert Notification.objects.filter(user__in=student.parents.all(),
                                           title='Recarga aplicada').exists()

        again = mirror_pos_topups(customers=[{'id': 'lv-1', 'total_points': 300}])
        assert again['applied_paid'] == 0 and again['in_sync'] == 1

    def test_picks_the_topup_that_matches_among_several(self):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent], loyverse_id='lv-1')
        seeded(student, 0)
        _, small, _ = paid_topup('100.00', student=student, parent=parent)
        _, big, _ = paid_topup('200.00', student=student, parent=parent)

        mirror_pos_topups(customers=[{'id': 'lv-1', 'total_points': 200}])

        small.refresh_from_db()
        big.refresh_from_db()
        assert big.status == TopUpRequest.Status.COMPLETED
        assert small.status == TopUpRequest.Status.PAID

    def test_a_gap_that_matches_nothing_is_held_for_staff(self):
        student, topup, _ = paid_topup(balance=0)

        r = mirror_pos_topups(customers=[{'id': 'lv-1', 'total_points': 150}])

        assert r['held_paid'] == 1 and r['credited'] == 0
        assert not CafeteriaTransaction.objects.filter(student=student).exists()
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID

    def test_nothing_happens_before_the_load(self):
        student, topup, _ = paid_topup(balance=80)
        r = mirror_pos_topups(customers=[{'id': 'lv-1', 'total_points': 80}])
        assert r['in_sync'] == 1 and r['applied_paid'] == 0

    def test_a_stale_webhook_snapshot_waits_for_the_settle_window(self):
        student, topup, _ = paid_topup(balance=0)
        CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal('5'), loyverse_receipt_id='r-1', balance_after=Decimal('-5'))
        r = mirror_pos_topups(customers=[{'id': 'lv-1', 'total_points': 200}], fresh=False)
        assert r['deferred'] == 1
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID


class TestNothingElseCreditsItTwice:
    def test_corregir_refuses_while_a_paid_topup_is_pending(self):
        student, _, _ = paid_topup(balance=0)
        assert pos_queue_reasons([student.pk]) == {student.pk: POS_APPLY_PENDING}
        with pytest.raises(ValueError, match='por aplicar'):
            reconcile_to_loyverse(student, Decimal('200'))
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('0')

    def test_staff_badge_counts_real_paid_topups(self):
        _, topup, _ = paid_topup(checkout='PRD')
        assert topup in online_topups_awaiting_staff()


# ── what families see ────────────────────────────────────────────────────────
class TestFamilyView:
    def test_balance_lists_pending_topups_with_folio_and_date(self, api_client):
        student, topup, payment = paid_topup(balance=20)
        api_client.force_authenticate(user=student.parents.first())

        r = api_client.get(reverse('cafeteria-balance'))
        assert r.status_code == 200
        row = next(b for b in r.data if b['student']['id'] == student.pk)
        assert row['balance'] == '20.00'
        pending = row['pending_topups']
        assert len(pending) == 1 and pending[0]['folio'] == payment.pk
        assert pending[0]['amount'] == '200.00' and pending[0]['apply_due_at']

    def test_other_families_do_not_see_it(self, api_client):
        paid_topup(balance=0)
        stranger = ParentFactory()
        mine = StudentProfileFactory(parents=[stranger], loyverse_id='lv-9')
        api_client.force_authenticate(user=stranger)
        r = api_client.get(reverse('cafeteria-balance'))
        assert [b['pending_topups'] for b in r.data if b['student']['id'] == mine.pk] == [[]]

    def test_payment_status_tells_the_return_page_it_is_waiting(self, api_client):
        student, topup, payment = paid_topup()
        api_client.force_authenticate(user=student.parents.first())
        r = api_client.get(reverse('payment-detail', args=[payment.pk]))
        assert r.status_code == 200, r.data
        assert r.data['topup']['status'] == 'paid' and r.data['topup']['apply_due_at']

    def test_availability_carries_the_policy(self, api_client):
        api_client.force_authenticate(user=ParentFactory())
        r = api_client.get(reverse('payment-availability'))
        assert r.data['topup_policy']['whatsapp'] == '5553791188'
        assert r.data['topup_policy']['mode'] == 'scheduled'


# ── the staff list ───────────────────────────────────────────────────────────
class TestApplyReport:
    def test_notifies_admins_once_with_overdue_marks(self):
        admin = AdminFactory()
        student, topup, payment = paid_topup(balance=0)
        TopUpRequest.objects.filter(pk=topup.pk).update(
            apply_due_at=timezone.now() - timedelta(hours=2))

        out = StringIO()
        call_command('topup_apply_report', stdout=out)
        assert 'VENCIDA' in out.getvalue() and f'folio {payment.pk}' in out.getvalue()
        note = Notification.objects.get(user=admin)
        assert '1 recarga(s)' in note.title and '(1 vencida(s))' in note.title

        call_command('topup_apply_report', stdout=StringIO())
        assert Notification.objects.filter(user=admin).count() == 1   # unchanged list

    def test_silent_when_nothing_is_due(self):
        admin = AdminFactory()
        _, topup, _ = paid_topup(balance=0)
        TopUpRequest.objects.filter(pk=topup.pk).update(
            apply_due_at=timezone.now() + timedelta(days=2))
        out = StringIO()
        call_command('topup_apply_report', stdout=out)
        assert 'nothing to apply' in out.getvalue()
        assert not Notification.objects.filter(user=admin).exists()


# ── the other ways a payment is confirmed ────────────────────────────────────
def pending_topup(amount='200.00', *, mode='PRD'):
    parent = ParentFactory()
    student = StudentProfileFactory(parents=[parent], loyverse_id='lv-7')
    seeded(student, 0)
    topup = TopUpRequest.objects.create(
        student=student, amount=Decimal(amount), method=TopUpRequest.Method.ONLINE)
    payment = Payment.objects.create(
        user=parent, payment_type=Payment.Type.CAFETERIA, amount=Decimal(amount),
        gateway=Payment.Gateway.BANORTE, related_topup=topup, status=Payment.Status.PENDING)
    BanorteCheckout.objects.create(payment=payment, control_number=f'IK{payment.pk:06d}', mode=mode)
    return student, topup, payment


class TestOtherConfirmations:
    def test_late_approval_after_a_soft_failure_is_recorded_as_paid(self):
        from apps.cafeteria.services import fail_online_topup

        student, topup, payment = pending_topup()
        payment.mark_failed('expiró', stage='expire')
        fail_online_topup(payment)
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.FAILED

        settle(PaymentEvent(payment.pk, 'success', 'IK-late', {}), actor_label='t')
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID and topup.apply_due_at
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('0')

    def test_multicobros_reconciliation_leaves_it_paid_and_verified(self):
        from apps.payments.multicobros import reconcile_approved

        student, topup, payment = pending_topup()
        payment.mark_failed('expiró', stage='expire')
        admin = AdminFactory()
        reconcile_approved(payment.pk, referencia='248233587990', codigo_aut='214414',
                           amount='200.00', actor=admin)

        topup.refresh_from_db()
        payment.refresh_from_db()
        assert payment.status == Payment.Status.SUCCESS and not payment.needs_bank_verification()
        assert topup.status == TopUpRequest.Status.PAID
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('0')
        # Verified in MultiCobros: «Aplicar» goes straight through once Loyverse has it.
        with patch(GUARD, return_value=Decimal('200')):
            _, balance = apply_paid_topup(topup, actor=admin)
        assert balance == Decimal('200')

    def test_simulated_approval_waits_but_never_reaches_the_staff_badge(self):
        student, topup, payment = pending_topup(mode='AUT')
        settle(PaymentEvent(payment.pk, 'success', 'IK-sim', {}), actor_label='t')
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID
        assert topup not in online_topups_awaiting_staff()

    def test_receipt_says_the_balance_is_still_to_be_applied(self, api_client):
        student, topup, payment = paid_topup()
        api_client.force_authenticate(user=student.parents.first())
        with patch('apps.core.pdf.simple_document_pdf', return_value=b'%PDF-') as pdf:
            r = api_client.get(reverse('payment-receipt', args=[payment.pk]))
        assert r.status_code == 200
        lines = pdf.call_args.args[1]
        assert any(line.startswith('Saldo: por aplicar (') and '7:30 a.m.' in line for line in lines)

    def test_staff_student_page_shows_the_waiting_topup(self, api_client):
        student, topup, payment = paid_topup(balance=0)
        api_client.force_authenticate(user=AdminFactory())
        r = api_client.get(reverse('admin-student-detail', args=[student.pk]), {'ledger': 0})
        assert r.status_code == 200
        assert [t['folio'] for t in r.data['balance']['pending_topups']] == [payment.pk]


class TestAppliedToday:
    def test_lists_todays_applications_with_how_they_were_applied(self, api_client):
        student, by_staff, _ = paid_topup('100.00', balance=0)
        with patch(GUARD, return_value=Decimal('100')):
            apply_paid_topup(by_staff, actor=AdminFactory(first_name='Caja'))
        other_parent = ParentFactory()
        other = StudentProfileFactory(parents=[other_parent], loyverse_id='lv-2')
        _, by_sync, _ = paid_topup('50.00', student=other, parent=other_parent, balance=0)
        mirror_pos_topups(customers=[{'id': 'lv-2', 'total_points': 50}])
        _, waiting, _ = paid_topup('70.00', student=other, parent=other_parent)

        api_client.force_authenticate(user=AdminFactory())
        today = timezone.localdate().isoformat()
        r = api_client.get(reverse('admin-topups'), {'applied_on': today, 'ordering': '-applied_at'})
        assert r.status_code == 200
        rows = {row['id']: row for row in r.data['results']}
        assert set(rows) == {by_staff.pk, by_sync.pk}
        assert rows[by_staff.pk]['applied_via'] == 'staff'
        assert rows[by_sync.pk]['applied_via'] == 'pos_sync'
        assert rows[by_sync.pk]['applied_via_display'] == 'Detectada en Loyverse'
        assert waiting.pk not in rows


class TestWhoPaid:
    """Owner, 2026-10-20: "how do I know which parents paid yesterday?"."""

    def test_dashboard_counts_paid_topups_and_their_total(self, api_client):
        paid_topup('200.00', checkout='PRD', balance=0)
        api_client.force_authenticate(user=AdminFactory())
        r = api_client.get('/api/v1/portal/dashboard/')
        assert r.status_code == 200
        assert r.data['paid_topups_to_apply'] == 1
        assert r.data['paid_topups_to_apply_total'] == '200.00'

    def test_queue_rows_carry_the_payer(self, api_client):
        student, topup, payment = paid_topup('150.00', balance=0)
        parent = student.parents.first()
        parent.whatsapp = '5512345678'
        parent.save(update_fields=['whatsapp'])
        api_client.force_authenticate(user=AdminFactory())
        row = api_client.get(reverse('admin-topups'), {'needs_apply': 1}).data['results'][0]
        assert row['payer']['email'] == parent.email
        assert row['payer']['name'] == parent.full_name
        assert row['payer']['phone'] == '5512345678'
        assert row['payer']['paid_at']
