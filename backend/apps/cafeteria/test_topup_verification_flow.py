"""Card top-ups that wait for «Verificar en MultiCobros» (incident 2026-11-18).

A student's two card top-ups ($200 + $244) were loaded into Loyverse at 9 a.m.
and nobody verified them: the portal kept «por aplicar» ($3 against Loyverse's
$447), the family got a «Saldo bajo» alert and the office only learned when the
parent complained. These tests pin what changed:

- the POS mirror tells the cafetería staff the same pass it holds a top-up for
  verification (once, plus one reminder), and the 07:05 list is scannable;
- the console badge «Por verificar» and the dashboard card count them;
- verifying applies the top-up at once when Loyverse already holds it, through
  the POS mirror's own path (never twice, never unverified, audited);
- no «Saldo bajo» while paid top-ups on the way cover the threshold.

Every name here is invented.
"""
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory, UserFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.cafeteria.services import (
    VERIFY_REMIND_AFTER,
    _maybe_low_balance_alert,
    apply_after_verification,
    mirror_pos_topups,
    notify_staff_held_unverified,
    pending_paid_totals,
    record_receipts,
    refund_paid_topup,
)
from apps.cafeteria.test_topup_scheduled_apply import local, paid_topup, seeded
from apps.core.badges import _compute_badges
from apps.core.models import AuditLog
from apps.payments.models import BanorteCheckout, Payment
from apps.payments.multicobros import paid_topups_awaiting_verification
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db

SEND = 'apps.portal.services.send_email'
LOYVERSE = 'apps.cafeteria.services.get_customer_by_id'
VERIFY = 'admin-payment-banorte-verify'
QUEUE = '/admin/cafeteria?tab=pos'


def family(loyverse_id, balance=None):
    parent = ParentFactory()
    student = StudentProfileFactory(parents=[parent], loyverse_id=loyverse_id)
    if balance is not None:
        seeded(student, balance)
    return parent, student


def verify(api_client, payment, amount):
    return api_client.post(reverse(VERIFY, args=[payment.pk]),
                           {'referencia': '123456', 'amount': amount}, format='json')


def staff_notes(user):
    return Notification.objects.filter(user=user, title__contains='Por verificar')


# ── 4. the staff hear about it the same pass ─────────────────────────────────
class TestHeldUnverifiedNotice:
    def test_the_cafeteria_staff_are_told_once_with_what_they_need(self):
        admin = AdminFactory()
        cashier = UserFactory(role='staff', staff_areas=['cafeteria'], staff_title='Cafetería')
        office = UserFactory(role='staff', staff_areas=['visitas', 'mensajes'])
        student, topup, payment = paid_topup('200.00', checkout='PRD', balance=3)
        store = [{'id': 'lv-1', 'total_points': 203}]

        with patch(SEND, return_value=True) as send:
            r = mirror_pos_topups(customers=store)

        assert r['held_unverified'] == 1 and r['applied_paid'] == 0 and r['credited'] == 0
        note = staff_notes(admin).get()
        assert note.title == f'Por verificar: {student.user.full_name}, $200.00'
        assert payment.banorte.control_number in note.message
        assert f'folio {payment.pk}' in note.message
        assert '«Por aplicar»' in note.message and '«Verificar en MultiCobros»' in note.message
        assert staff_notes(cashier).count() == 1
        assert not Notification.objects.filter(user=office).exists()
        subject, _body, recipients = send.call_args.args[:3]
        # D13: the email subject carries neither the name nor the amount; the title does.
        assert subject == 'Interlaken: Recarga por verificar'
        assert set(recipients) == {admin.email, cashier.email}
        content = send.call_args.kwargs['content']
        assert content.cta_url.endswith(QUEUE)
        assert ('Número de control', payment.banorte.control_number) in content.details
        assert ('Monto', '$200.00') in content.details
        topup.refresh_from_db()
        assert topup.verify_alert_count == 1 and topup.verify_alert_at is not None
        # Nothing reached the wallet: the notice is all that happened.
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('3')

        # The 5-minute cron keeps holding it: no second notice.
        with patch(SEND, return_value=True) as again:
            mirror_pos_topups(customers=store)
        again.assert_not_called()
        assert staff_notes(admin).count() == 1

    def test_one_reminder_after_some_hours_and_never_a_third(self):
        admin = AdminFactory()
        student, topup, payment = paid_topup('244.00', checkout='PRD', balance=3)
        held = [(student, topup, payment)]
        first = local(2026, 11, 18, 9, 5)

        with patch(SEND, return_value=True):
            assert notify_staff_held_unverified(held, first) == 1
            assert notify_staff_held_unverified(held, first + timedelta(hours=1)) == 0
            assert notify_staff_held_unverified(held, first + VERIFY_REMIND_AFTER) == 1
            assert notify_staff_held_unverified(held, first + timedelta(hours=8)) == 0

        titles = list(staff_notes(admin).order_by('pk').values_list('title', flat=True))
        assert titles == [f'Por verificar: {student.user.full_name}, $244.00',
                          f'Recordatorio · Por verificar: {student.user.full_name}, $244.00']

    def test_no_reminder_at_night(self):
        AdminFactory()
        student, topup, payment = paid_topup('244.00', checkout='PRD', balance=3)
        held = [(student, topup, payment)]
        with patch(SEND, return_value=True):
            assert notify_staff_held_unverified(held, local(2026, 11, 18, 16, 0)) == 1
            assert notify_staff_held_unverified(held, local(2026, 11, 18, 22, 0)) == 0
            # Next school morning it may go out.
            assert notify_staff_held_unverified(held, local(2026, 11, 19, 8, 0)) == 1

    def test_two_top_ups_of_the_incident_go_in_one_short_notice(self):
        admin = AdminFactory()
        parent, student = family('lv-1', balance=3)
        _, first, p1 = paid_topup('200.00', student=student, parent=parent, checkout='PRD')
        _, second, p2 = paid_topup('244.00', student=student, parent=parent, checkout='PRD')

        with patch(SEND, return_value=True) as send:
            r = mirror_pos_topups(customers=[{'id': 'lv-1', 'total_points': 447}])

        assert r['held_unverified'] == 1
        note = staff_notes(admin).get()
        assert note.title == 'Por verificar: 2 recargas ya en Loyverse ($444.00)'
        bullets = [line for line in note.message.splitlines() if line.startswith('• ')]
        assert len(bullets) == 2
        assert p1.banorte.control_number in bullets[0] and p2.banorte.control_number in bullets[1]
        assert send.call_args.kwargs['content'].items == [b[2:] for b in bullets]

    def test_a_quiet_pass_tells_nobody_and_keeps_the_slot(self):
        admin = AdminFactory()
        _, topup, _ = paid_topup('200.00', checkout='PRD', balance=3)
        mirror_pos_topups(customers=[{'id': 'lv-1', 'total_points': 203}], notify=False)
        assert not staff_notes(admin).exists()
        topup.refresh_from_db()
        assert topup.verify_alert_count == 0

    def test_not_loaded_or_verified_is_not_announced(self):
        admin = AdminFactory()
        _, waiting, _ = paid_topup('200.00', checkout='PRD', balance=3)
        mirror_pos_topups(customers=[{'id': 'lv-1', 'total_points': 3}])   # not in Loyverse yet
        parent, student = family('lv-2', balance=0)
        _, verified, payment = paid_topup('100.00', student=student, parent=parent, checkout='PRD')
        BanorteCheckout.objects.filter(payment=payment).update(verified_at=timezone.now())
        mirror_pos_topups(customers=[{'id': 'lv-2', 'total_points': 100}])  # applies, no notice

        verified.refresh_from_db()
        assert verified.status == TopUpRequest.Status.COMPLETED
        assert not staff_notes(admin).exists()

    def test_a_failing_notice_never_undoes_the_pass(self):
        AdminFactory()
        parent, student = family('lv-1', balance=3)
        _, held, _ = paid_topup('200.00', student=student, parent=parent, checkout='PRD')
        with patch('apps.cafeteria.services.cafeteria_staff', side_effect=RuntimeError('smtp')):
            r = mirror_pos_topups(customers=[{'id': 'lv-1', 'total_points': 203}])
        assert r['held_unverified'] == 1


class TestApplyReportIsScannable:
    def test_short_title_one_line_each_and_the_instructions_once(self):
        admin = AdminFactory()
        _, unverified, payment = paid_topup('244.00', checkout='PRD', balance=3)
        parent, other = family('lv-2', balance=0)
        _, plain, _ = paid_topup('50.00', student=other, parent=parent)
        TopUpRequest.objects.filter(pk__in=[unverified.pk, plain.pk]).update(
            apply_due_at=timezone.now() - timedelta(hours=1))

        with patch(SEND, return_value=True) as send:
            call_command('topup_apply_report', stdout=StringIO())

        note = Notification.objects.get(user=admin)
        assert note.title == '2 recargas por cargar en el POS · 2 vencidas · 1 sin verificar'
        bullets = [line for line in note.message.splitlines() if line.startswith('• ')]
        assert len(bullets) == 2
        flagged = [b for b in bullets if 'SIN VERIFICAR' in b]
        assert flagged == [b for b in bullets if payment.banorte.control_number in b]
        # One compact line per top-up: no per-row instructions or timestamps.
        assert not any('verifique' in b or 'pagada' in b or 'se aplica' in b for b in bullets)
        assert note.message.count('Qué hacer:') == 1
        assert note.message.index('Qué hacer:') > note.message.index(bullets[-1])
        assert note.message.startswith('Total $294.00.')
        content = send.call_args.kwargs['content']
        assert content.items == [b[2:] for b in bullets]
        assert content.cta_url.endswith(QUEUE)

    def test_a_single_on_time_top_up(self):
        admin = AdminFactory()
        _, topup, _ = paid_topup('80.00', balance=0)
        TopUpRequest.objects.filter(pk=topup.pk).update(apply_due_at=timezone.now())
        with patch(SEND, return_value=True):
            call_command('topup_apply_report', stdout=StringIO())
        note = Notification.objects.get(user=admin)
        assert note.title == '1 recarga por cargar en el POS'
        assert 'SIN VERIFICAR' not in note.message and 'VENCIDA' not in note.message


# ── 5. «Por verificar» next to Cafetería ─────────────────────────────────────
class TestPorVerificarBadge:
    def test_counts_only_paid_card_top_ups_still_to_verify(self):
        admin = AdminFactory()
        paid_topup('200.00', checkout='PRD', balance=0)                      # counts
        parent, s2 = family('lv-2', balance=0)
        _, _, verified = paid_topup('100.00', student=s2, parent=parent, checkout='PRD')
        BanorteCheckout.objects.filter(payment=verified).update(verified_at=timezone.now())
        parent3, s3 = family('lv-3', balance=0)
        paid_topup('100.00', student=s3, parent=parent3, checkout='AUT')     # simulation
        parent4, s4 = family('lv-4', balance=0)
        TopUpRequest.objects.create(student=s4, amount=Decimal('50'))        # cash at the office

        badges = _compute_badges(admin)

        assert badges['cafeteria_verificar'] == 1
        # The existing counter is unchanged: cash + every real card top-up to work.
        assert badges['cafeteria'] == 3
        assert paid_topups_awaiting_verification().count() == 1

    def test_verified_or_refunded_leave_the_count(self):
        admin = AdminFactory()
        _, _, payment = paid_topup('200.00', checkout='PRD', balance=0)
        assert _compute_badges(admin)['cafeteria_verificar'] == 1
        BanorteCheckout.objects.filter(payment=payment).update(verified_at=timezone.now())
        assert _compute_badges(admin)['cafeteria_verificar'] == 0

        parent, s2 = family('lv-2', balance=0)
        _, other, _ = paid_topup('90.00', student=s2, parent=parent, checkout='PRD')
        refund_paid_topup(other, actor=admin, note='Pagó dos veces', bank_refund_confirmed=True,
                          pos_not_loaded_confirmed=True)
        assert _compute_badges(admin)['cafeteria_verificar'] == 0

    def test_verifying_refreshes_the_verifier_s_badge_at_once(self, api_client):
        _, _, payment = paid_topup('200.00', checkout='PRD', balance=3)
        admin = AdminFactory()
        api_client.force_authenticate(user=admin)
        assert api_client.get(reverse('core-badges')).data['cafeteria_verificar'] == 1  # now cached
        verify(api_client, payment, '200.00')
        assert api_client.get(reverse('core-badges')).data['cafeteria_verificar'] == 0

    def test_only_accounts_with_the_cafeteria_area_get_it(self):
        paid_topup('200.00', checkout='PRD', balance=0)
        cashier = UserFactory(role='staff', staff_areas=['cafeteria'])
        reception = UserFactory(role='staff', staff_areas=['visitas'])
        assert _compute_badges(cashier)['cafeteria_verificar'] == 1
        assert 'cafeteria_verificar' not in _compute_badges(reception)


# ── 6. the dashboard card ────────────────────────────────────────────────────
class TestDashboardCard:
    def test_count_total_and_the_oldest_wait(self, api_client):
        parent, student = family('lv-1', balance=3)
        _, older, _ = paid_topup('200.00', student=student, parent=parent, checkout='PRD')
        _, newer, _ = paid_topup('244.00', student=student, parent=parent, checkout='PRD')
        parent2, s2 = family('lv-2', balance=0)
        _, _, verified = paid_topup('500.00', student=s2, parent=parent2, checkout='PRD')
        BanorteCheckout.objects.filter(payment=verified).update(verified_at=timezone.now())
        day_ago = timezone.now() - timedelta(days=1)
        TopUpRequest.objects.filter(pk=older.pk).update(processed_at=day_ago)

        api_client.force_authenticate(user=AdminFactory())
        data = api_client.get(reverse('dashboard')).data

        assert data['topups_to_verify'] == 2
        assert data['topups_to_verify_total'] == '444.00'
        assert data['topups_to_verify_oldest'] == day_ago
        # The existing banner numbers are untouched.
        assert data['paid_topups_to_apply'] == 3

    def test_calm_zeroes_when_nothing_waits(self, api_client):
        api_client.force_authenticate(user=AdminFactory())
        data = api_client.get(reverse('dashboard')).data
        assert data['topups_to_verify'] == 0
        assert data['topups_to_verify_total'] == '0.00'
        assert data['topups_to_verify_oldest'] is None


# ── 7. verifying applies it when Loyverse already has it ─────────────────────
class TestApplyRightAfterVerifying:
    def test_verified_and_applied_with_the_new_balance(self, api_client):
        student, topup, payment = paid_topup('200.00', checkout='PRD', balance=3)
        admin = AdminFactory()
        api_client.force_authenticate(user=admin)

        with patch(LOYVERSE, return_value={'id': 'lv-1', 'total_points': 203}) as read:
            r = verify(api_client, payment, '200.00')

        assert r.status_code == 200, r.data
        read.assert_called_once_with('lv-1')
        # Old fields unchanged, new ones added.
        assert r.data['payment_id'] == payment.pk and r.data['verified_at']
        assert r.data['verified_by_name'] == admin.full_name
        assert r.data['apply_state'] == 'applied' and r.data['balance'] == '203.00'
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert topup.applied_via == TopUpRequest.AppliedVia.POS_SYNC and topup.pos_loaded_at
        assert CafeteriaTransaction.objects.filter(
            student=student, loyverse_receipt_id=f'topup-payment-{payment.pk}').count() == 1
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('203')
        contexts = set(AuditLog.objects.values_list('context', flat=True))
        assert {'payments.banorte.verify', 'cafeteria.topup.apply_paid'} <= contexts
        assert Notification.objects.filter(user__in=student.parents.all(),
                                           title='Recarga aplicada').count() == 1

        # Verifying again (double click, second tab) moves nothing.
        with patch(LOYVERSE, return_value={'id': 'lv-1', 'total_points': 203}):
            again = verify(api_client, payment, '200.00')
        assert again.status_code == 200 and again.data['apply_state'] == 'not_applicable'
        assert CafeteriaTransaction.objects.filter(student=student).count() == 1
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('203')

    def test_not_in_loyverse_yet_waits_verified(self, api_client):
        student, topup, payment = paid_topup('200.00', checkout='PRD', balance=3)
        api_client.force_authenticate(user=AdminFactory())
        with patch(LOYVERSE, return_value={'id': 'lv-1', 'total_points': 3}):
            r = verify(api_client, payment, '200.00')
        assert r.data['apply_state'] == 'waiting_pos' and r.data['balance'] is None
        topup.refresh_from_db()
        payment.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID
        assert not payment.needs_bank_verification()
        assert not CafeteriaTransaction.objects.filter(student=student).exists()

    def test_loyverse_unreachable_keeps_the_verification(self, api_client):
        _, topup, payment = paid_topup('200.00', checkout='PRD', balance=3)
        api_client.force_authenticate(user=AdminFactory())
        r = verify(api_client, payment, '200.00')     # no token in tests: LoyverseError
        assert r.status_code == 200 and r.data['apply_state'] == 'pos_unknown'
        assert BanorteCheckout.objects.get(payment=payment).verified_at is not None
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID

    def test_a_crash_after_the_commit_is_not_a_500(self, api_client):
        _, topup, payment = paid_topup('200.00', checkout='PRD', balance=3)
        api_client.force_authenticate(user=AdminFactory())
        with patch('apps.cafeteria.services.mirror_pos_topups', side_effect=RuntimeError('db')), \
                patch(LOYVERSE, return_value={'id': 'lv-1', 'total_points': 203}):
            r = verify(api_client, payment, '200.00')
        assert r.status_code == 200 and r.data['apply_state'] == 'pos_unknown'
        assert BanorteCheckout.objects.get(payment=payment).verified_at is not None

    def test_the_incident_two_top_ups_go_in_at_the_second_verification(self, api_client):
        parent, student = family('lv-1', balance=3)
        _, first, p1 = paid_topup('200.00', student=student, parent=parent, checkout='PRD')
        _, second, p2 = paid_topup('244.00', student=student, parent=parent, checkout='PRD')
        api_client.force_authenticate(user=AdminFactory())
        store = {'id': 'lv-1', 'total_points': 447}

        with patch(LOYVERSE, return_value=store), patch(SEND, return_value=True):
            r1 = verify(api_client, p1, '200.00')
        # $447 - $3 = $444 is both top-ups: never part of it while one is unverified.
        assert r1.data['apply_state'] == 'waiting_verification'
        assert not CafeteriaTransaction.objects.filter(student=student).exists()

        with patch(LOYVERSE, return_value=store):
            r2 = verify(api_client, p2, '244.00')
        assert r2.data['apply_state'] == 'applied' and r2.data['balance'] == '447.00'
        for topup in (first, second):
            topup.refresh_from_db()
            assert topup.status == TopUpRequest.Status.COMPLETED
        refs = sorted(CafeteriaTransaction.objects.filter(student=student)
                      .values_list('loyverse_receipt_id', flat=True))
        assert refs == sorted([f'topup-payment-{p1.pk}', f'topup-payment-{p2.pk}'])

    def test_a_wrong_referencia_moves_nothing(self, api_client):
        student, topup, payment = paid_topup('200.00', checkout='PRD', balance=3)
        api_client.force_authenticate(user=AdminFactory())
        with patch(LOYVERSE, return_value={'id': 'lv-1', 'total_points': 203}) as read:
            r = api_client.post(reverse(VERIFY, args=[payment.pk]),
                                {'referencia': '999', 'amount': '200.00'}, format='json')
        assert r.status_code == 400 and r.data['code'] == 'reference_mismatch'
        read.assert_not_called()
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID

    @override_settings(CAFETERIA_TOPUP_APPLY_MODE='instant')
    def test_an_already_credited_top_up_is_not_applicable(self):
        _, topup, payment = paid_topup('200.00', checkout='PRD', balance=0)
        assert topup.status == TopUpRequest.Status.COMPLETED
        BanorteCheckout.objects.filter(payment=payment).update(verified_at=timezone.now())
        with patch(LOYVERSE) as read:
            assert apply_after_verification(payment)['apply_state'] == 'not_applicable'
        read.assert_not_called()

    def test_never_applies_an_unverified_approval(self):
        _, topup, payment = paid_topup('200.00', checkout='PRD', balance=0)
        with patch(LOYVERSE) as read:
            assert apply_after_verification(payment)['apply_state'] == 'not_applicable'
        read.assert_not_called()
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID


# ── 10. no «Saldo bajo» while the family's payment is on its way ─────────────
def warnings_for(student):
    return Notification.objects.filter(user__in=student.parents.all(),
                                       title='Saldo bajo en cafetería')


def purchase(student, amount, n):
    return {'receipt_number': f'R-{n}', 'customer_id': student.loyverse_id,
            'receipt_date': timezone.now().isoformat(), 'total_money': amount,
            'payments': [{'type': 'POINTS', 'money_amount': amount}],
            'total_points_spent': amount, 'points_deducted': amount,
            'line_items': [{'item_name': 'Torta', 'quantity': 1, 'total_money': amount}]}


class TestNoLowBalanceAlertWhilePaid:
    def test_pending_top_up_covering_the_threshold_skips_the_alert(self):
        student, topup, _ = paid_topup('244.00', checkout='PRD', balance=3)
        cb = CafeteriaBalance.objects.select_related('student__user').get(student=student)
        assert cb.is_low_balance
        assert pending_paid_totals([student.pk]) == {student.pk: Decimal('244.00')}

        assert _maybe_low_balance_alert(cb, timezone.now()) == 0
        assert not warnings_for(student).exists()
        cb.refresh_from_db()
        assert cb.last_low_balance_alert_at is None      # the cooldown slot was not taken

    def test_exactly_at_the_threshold_is_covered(self):
        student, _, _ = paid_topup('15.00', balance=5)      # 5 + 15 = 20, the default level
        cb = CafeteriaBalance.objects.select_related('student__user').get(student=student)
        assert _maybe_low_balance_alert(cb, timezone.now()) == 0

    def test_a_top_up_too_small_to_cover_it_still_alerts(self):
        student, _, _ = paid_topup('10.00', balance=3)       # 3 + 10 = 13 < 20
        cb = CafeteriaBalance.objects.select_related('student__user').get(student=student)
        assert _maybe_low_balance_alert(cb, timezone.now()) > 0
        assert warnings_for(student).exists()

    def test_alerts_once_the_money_turns_out_not_to_come(self):
        admin = AdminFactory()
        student, topup, _ = paid_topup('200.00', checkout='PRD', balance=3)
        cb = CafeteriaBalance.objects.select_related('student__user').get(student=student)
        assert _maybe_low_balance_alert(cb, timezone.now()) == 0
        refund_paid_topup(topup, actor=admin, note='Cargo duplicado', bank_refund_confirmed=True,
                          pos_not_loaded_confirmed=True)
        assert _maybe_low_balance_alert(cb, timezone.now()) > 0
        assert warnings_for(student).count() >= 1

    def test_the_purchase_path_skips_it(self):
        parent, student = family('lv-1', balance=30)
        paid_topup('244.00', student=student, parent=parent, checkout='PRD')
        record_receipts([purchase(student, 27, 1)])          # $30 → $3, low
        cb = CafeteriaBalance.objects.get(student=student)
        assert cb.balance == Decimal('3') and cb.is_low_balance
        assert not warnings_for(student).exists()

    def test_the_daily_cron_skips_and_does_not_stamp(self):
        student, topup, _ = paid_topup('244.00', checkout='PRD', balance=3)
        CafeteriaTransaction.objects.create(                    # wallet in use
            student=student, transaction_type='purchase', amount=Decimal('10'),
            loyverse_receipt_id='r-use', date=timezone.now())
        out = StringIO()
        call_command('low_balance_alerts', stdout=out)
        assert '1 skipped (paid top-up on its way)' in out.getvalue()
        assert not warnings_for(student).exists()
        assert CafeteriaBalance.objects.get(student=student).last_low_balance_alert_at is None

        # The payment is returned to the card: the next run tells the family.
        refund_paid_topup(topup, actor=AdminFactory(), note='Devuelto', bank_refund_confirmed=True,
                          pos_not_loaded_confirmed=True)
        call_command('low_balance_alerts', stdout=StringIO())
        assert warnings_for(student).exists()
        assert CafeteriaBalance.objects.get(student=student).last_low_balance_alert_at is not None

    def test_a_simulation_does_not_count_as_money_on_its_way(self, settings):
        student, _, payment = paid_topup('244.00', checkout='AUT', balance=3)
        assert Payment.objects.get(pk=payment.pk).is_simulation()
        settings.PAYMENTS_LIVE = True        # live installation: no money moved
        assert pending_paid_totals([student.pk]) == {}
        cb = CafeteriaBalance.objects.select_related('student__user').get(student=student)
        assert _maybe_low_balance_alert(cb, timezone.now()) > 0
