"""Money-path hardening of the cafetería ledger (fix/ledger-money-safety).

Each class pins one audited defect: refunds of history-only or POS-returned
purchases, the bulk top-up's timeout and retry double-credit, the ajuste masivo
re-upload double-apply and pre-commit emails, Corregir's stale delta, the
per-row Loyverse reads of Reconciliación, the family-triggered store-wide poll,
a repointed loyverse_id, and the smaller apply/param/admin gaps. Loyverse is
never reached: the token is blank and remote reads are patched.
"""

import io
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib import admin as django_admin
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria import services
from apps.cafeteria.models import (
    BalanceAdjustment,
    CafeteriaBalance,
    CafeteriaTransaction,
    LoyverseSyncState,
    TopUpRequest,
)
from apps.core.models import AuditLog
from apps.payments.models import Payment
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


def _wallet(student, amount, *, seeded=True):
    now = timezone.now() if seeded else None
    return CafeteriaBalance.objects.create(
        student=student, balance=Decimal(str(amount)), last_synced=now, seeded_at=now)


def _purchase(student, amount, receipt, **kw):
    return CafeteriaTransaction.objects.create(
        student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
        amount=Decimal(str(amount)), loyverse_receipt_id=receipt, **kw)


def _receipt(number, points, *, refund_for=None):
    r = {
        'receipt_number': number,
        'receipt_type': 'REFUND' if refund_for else 'SALE',
        'receipt_date': timezone.now().isoformat(),
        'total_discounts': [{'type': 'DISCOUNT_BY_POINTS', 'money_amount': points}],
        'line_items': [{'item_name': 'Torta', 'quantity': 1, 'total_money': 0}],
    }
    if refund_for:
        r['refund_for'] = refund_for
    return r


@pytest.fixture
def admin(api_client):
    user = AdminFactory()
    api_client.force_authenticate(user)
    return user


# ── 2. refund_transaction ─────────────────────────────────
class TestRefundGuards:
    def test_history_only_purchase_cannot_be_refunded(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='')
        _wallet(s, 50)
        tx = _purchase(s, 30, 'R-OLD', applied=False)

        resp = api_client.post(reverse('admin-refund', args=[tx.id]), {}, format='json')

        assert resp.status_code == 400
        assert 'solo historial' in resp.data['detail']
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('50')

    def test_purchase_already_returned_on_the_pos_is_refused(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='')
        _wallet(s, 50)
        tx = _purchase(s, 30, 'R-1')
        services._record_receipt(s, _receipt('R-2', 30, refund_for='R-1'))
        assert CafeteriaTransaction.objects.get(loyverse_receipt_id='R-2').refund_of == 'R-1'
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('80')

        resp = api_client.post(reverse('admin-refund', args=[tx.id]), {}, format='json')

        assert resp.status_code == 400
        assert 'ya se devolvió en el POS' in resp.data['detail']
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('80')

    def test_legacy_pos_refund_without_refund_of_also_matches(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='')
        _wallet(s, 50)
        tx = _purchase(s, 30, 'R-1', date=timezone.now() - timedelta(days=1))
        CafeteriaTransaction.objects.create(
            student=s, transaction_type=CafeteriaTransaction.TxType.REFUND,
            amount=Decimal('30'), loyverse_receipt_id='R-9')

        resp = api_client.post(reverse('admin-refund', args=[tx.id]), {}, format='json')
        assert resp.status_code == 400

    def test_pos_refund_after_a_console_refund_is_kept_as_history(self, api_client, admin):
        """The office refunded the sale locally; days later the cashier also
        returns it on the POS (that is what gives the points back in Loyverse).
        The poll must not credit the family a second time."""
        s = StudentProfileFactory(loyverse_id='')
        _wallet(s, 50)
        tx = _purchase(s, 30, 'R-1')
        assert api_client.post(reverse('admin-refund', args=[tx.id]), {},
                               format='json').status_code == 201
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('80')

        row = services._record_receipt(s, _receipt('R-2', 30, refund_for='R-1'))

        assert row is not None and row.applied is False
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('80')


# ── 4. bulk top-up ────────────────────────────────────────
class TestBulkTopUp:
    url = staticmethod(lambda: reverse('admin-bulk-topup'))

    def _students(self, n, grade='3'):
        out = []
        for _ in range(n):
            s = StudentProfileFactory(grade=grade, loyverse_id='')
            _wallet(s, 0)
            out.append(s)
        return out

    def test_apply_requires_a_batch_id(self, api_client, admin):
        self._students(1)
        resp = api_client.post(self.url(), {'amount': 50, 'reason': 'Beca', 'grade': '3'},
                               format='json')
        assert resp.status_code == 400 and 'batch_id' in resp.data
        assert not CafeteriaTransaction.objects.exists()

    def test_retry_with_the_same_batch_never_double_credits(self, api_client, admin):
        students = self._students(3)
        body = {'amount': 50, 'reason': 'Beca', 'grade': '3', 'batch_id': 'lote-0001-abcd'}

        first = api_client.post(self.url(), body, format='json')
        again = api_client.post(self.url(), body, format='json')

        assert first.status_code == 201 and first.data['credited'] == 3
        assert again.data['credited'] == 0 and again.data['skipped'] == 3
        for s in students:
            assert CafeteriaBalance.objects.get(student=s).balance == Decimal('50')
        refs = CafeteriaTransaction.objects.values_list('loyverse_receipt_id', flat=True)
        assert all(r.startswith('adjust-tx-bulk-lote-0001-abcd-') for r in refs)

    def test_out_of_time_run_reports_remaining_and_is_resumed(self, api_client, admin):
        students = self._students(3)
        body = {'amount': 20, 'reason': 'Día de campo', 'grade': '3', 'batch_id': 'lote-0002-abcd'}

        with patch('apps.cafeteria.views.BULK_TOPUP_LEDGER_SECONDS', -1):
            cut = api_client.post(self.url(), body, format='json')
        assert cut.status_code == 201
        assert cut.data['credited'] == 0 and cut.data['remaining'] == 3
        # A summary audit row even for a run that ended early.
        assert AuditLog.objects.filter(context='cafeteria: recarga masiva').count() == 1

        rest = api_client.post(self.url(), body, format='json')
        assert rest.data['credited'] == 3 and rest.data['remaining'] == 0
        assert sum(CafeteriaBalance.objects.get(student=s).balance for s in students) == 60

    def test_late_notices_are_queued_for_the_cron(self, api_client, admin):
        parent = ParentFactory()
        s = self._students(1)[0]
        s.parents.add(parent)
        body = {'amount': 30, 'reason': 'Beca', 'grade': '3', 'batch_id': 'lote-0003-abcd'}

        with patch('apps.cafeteria.views.BULK_TOPUP_NOTIFY_SECONDS', -1):
            resp = api_client.post(self.url(), body, format='json')

        assert resp.data['queued_notifications'] >= 1 and resp.data['notified'] == 0
        assert Notification.objects.get(user=parent).delivered_at is None

    @pytest.mark.parametrize('ids', [['abc'], [1.5], 'not-a-list', [True]])
    def test_bad_student_ids_are_a_400(self, api_client, admin, ids):
        resp = api_client.post(self.url(), {'amount': 10, 'reason': 'x', 'student_ids': ids},
                               format='json')
        assert resp.status_code == 400

    @pytest.mark.parametrize('amount', ['NaN', 'Infinity', '-5', 'abc'])
    def test_bad_amounts_are_a_400(self, api_client, admin, amount):
        resp = api_client.post(self.url(), {'amount': amount, 'reason': 'x', 'grade': '3'},
                               format='json')
        assert resp.status_code == 400


# ── 5. ajuste masivo ──────────────────────────────────────
class TestAdjustmentImport:
    def _post(self, api_client, text, **data):
        upload = io.BytesIO(text.encode('utf-8'))
        upload.name = 'ajustes.csv'
        return api_client.post(reverse('admin-balances-import'), {'file': upload, **data},
                               format='multipart')

    def test_recommitting_the_same_file_skips_applied_rows(self, api_client, admin):
        s = StudentProfileFactory(student_id='09932', loyverse_id='')
        _wallet(s, 0)
        text = 'matricula,monto,motivo\n09932,25,Beca octubre\n'

        first = self._post(api_client, text, dry_run='0', notify='0').json()
        preview = self._post(api_client, text).json()
        second = self._post(api_client, text, dry_run='0', notify='0').json()

        assert first['counts']['crear'] == 1
        assert preview['counts']['omitir'] == 1
        assert second['counts']['omitir'] == 1 and second['counts']['crear'] == 0
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('25')
        assert BalanceAdjustment.objects.count() == 1

    def test_families_are_told_only_after_the_import_commits(
            self, api_client, admin, django_capture_on_commit_callbacks):
        parent = ParentFactory()
        s = StudentProfileFactory(student_id='09932', loyverse_id='', parents=[parent])
        _wallet(s, 0)
        text = 'matricula,monto,motivo\n09932,25,Beca octubre\n'

        with django_capture_on_commit_callbacks(execute=False) as callbacks:
            self._post(api_client, text, dry_run='0')
        assert not Notification.objects.filter(user=parent).exists()
        assert callbacks
        for callback in callbacks:
            callback()
        assert Notification.objects.filter(user=parent).count() == 1

    def test_a_debit_loyverse_would_recredit_is_an_error_row(self, api_client, admin):
        s = StudentProfileFactory(student_id='09932', loyverse_id='u1')
        _wallet(s, 100)
        text = 'matricula,monto,motivo\n09932,-40,Devolución\n'

        with patch('apps.cafeteria.services.get_all_customers',
                   return_value=[{'id': 'u1', 'total_points': 100}]) as store:
            report = self._post(api_client, text).json()
        store.assert_called_once()
        row = report['rows'][0]
        assert row['action'] == 'error' and 'Quite primero' in row['errors'][0]


# ── 6. Corregir ───────────────────────────────────────────
def _remote(points):
    return patch('apps.cafeteria.views.get_customer_by_id',
                 return_value={'total_points': points})


class TestReconcileFix:
    def test_balance_moved_since_the_screen_is_a_409(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='u1')
        _wallet(s, 80)
        with _remote(65):
            resp = api_client.post(reverse('admin-reconcile-fix', args=[s.id]),
                                   {'expected_balance': '95.00'}, format='json')
        assert resp.status_code == 409
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('80')

    def test_double_click_applies_once(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='u1')
        _wallet(s, 50)
        url = reverse('admin-reconcile-fix', args=[s.id])
        with _remote(65):
            first = api_client.post(url, {'expected_balance': '50.00'}, format='json')
            second = api_client.post(url, {'expected_balance': '50.00'}, format='json')
        assert first.status_code == 200 and first.data['adjusted'] is True
        assert second.status_code == 409
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('65')

    def test_purchase_landing_during_the_loyverse_read_is_refused(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='u1')
        _wallet(s, 80)

        def read_and_purchase(_lid):
            services._record_receipt(s, _receipt('R-LATE', 20))
            return {'total_points': 100}

        with patch('apps.cafeteria.views.get_customer_by_id', side_effect=read_and_purchase):
            resp = api_client.post(reverse('admin-reconcile-fix', args=[s.id]), {},
                                   format='json')
        assert resp.status_code == 409
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('60')

    def test_student_with_an_online_topup_awaiting_pos_load_is_skipped(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='u1')
        _wallet(s, 150)
        TopUpRequest.objects.create(student=s, amount=Decimal('100'),
                                    method=TopUpRequest.Method.ONLINE,
                                    status=TopUpRequest.Status.COMPLETED)
        with _remote(50):
            resp = api_client.post(reverse('admin-reconcile-fix', args=[s.id]), {},
                                   format='json')
        assert resp.status_code == 400 and 'POS' in resp.data['detail']
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('150')

    def test_debit_never_cancels_a_recent_local_only_credit(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='')
        _wallet(s, 0)
        services.adjust_balance(s, Decimal('100'), 'Beca', notify=False)
        s.loyverse_id = 'u1'
        s.save(update_fields=['loyverse_id'])
        with _remote(0):
            resp = api_client.post(reverse('admin-reconcile-fix', args=[s.id]), {},
                                   format='json')
        assert resp.status_code == 400 and 'abonos locales' in resp.data['detail']
        assert CafeteriaBalance.objects.get(student=s).balance == Decimal('100')

    def test_bulk_fix_skips_queued_students_and_reads_loyverse_once(self, api_client, admin):
        fix = StudentProfileFactory(loyverse_id='a')
        queued = StudentProfileFactory(loyverse_id='b')
        _wallet(fix, 80)
        _wallet(queued, 150)
        TopUpRequest.objects.create(student=queued, amount=Decimal('100'),
                                    method=TopUpRequest.Method.ONLINE,
                                    status=TopUpRequest.Status.COMPLETED)
        store = [{'id': 'a', 'total_points': 65}, {'id': 'b', 'total_points': 50}]
        with patch('apps.cafeteria.services.get_all_customers', return_value=store) as fetch, \
             patch('apps.cafeteria.services.get_customer_by_id') as per_row:
            done = api_client.post(reverse('admin-reconcile-bulk'),
                                   {'action': 'fix', 'ids': [fix.id, queued.id]},
                                   format='json').json()
        fetch.assert_called_once()
        per_row.assert_not_called()
        assert done['ok'] == 1 and len(done['skipped']) == 1
        assert CafeteriaBalance.objects.get(student=fix).balance == Decimal('65')
        assert CafeteriaBalance.objects.get(student=queued).balance == Decimal('150')


# ── 7. Reconciliación list ────────────────────────────────
class TestReconcileList:
    def test_one_store_fetch_per_page_never_one_read_per_row(self, api_client, admin):
        students = [StudentProfileFactory() for _ in range(5)]
        for s in students:
            _wallet(s, 10)
        store = [{'id': s.loyverse_id, 'total_points': 10} for s in students]
        with patch('apps.cafeteria.services.get_all_customers', return_value=store) as fetch, \
             patch('apps.cafeteria.services.get_customer_by_id') as per_row:
            data = api_client.get(reverse('admin-reconcile'), {'page_size': 100}).json()
        fetch.assert_called_once()
        per_row.assert_not_called()
        assert data['checked'] == 5 and data['drift_count'] == 0

    def test_loyverse_down_marks_rows_instead_of_failing(self, api_client, admin):
        _wallet(StudentProfileFactory(), 10)
        with patch('apps.cafeteria.services.get_all_customers',
                   side_effect=services.LoyverseError('boom')):
            data = api_client.get(reverse('admin-reconcile')).json()
        assert data['results'][0]['error'] and 'boom' not in data['results'][0]['error']


# ── 8. refresh ────────────────────────────────────────────
class TestRefresh:
    def test_a_family_never_triggers_the_store_wide_poll(self, api_client):
        api_client.force_authenticate(ParentFactory())
        with patch('apps.cafeteria.views.sync_purchases') as poll:
            resp = api_client.post(reverse('cafeteria-refresh'))
        poll.assert_not_called()
        assert resp.status_code == 200 and resp.data['created'] == 0

    def test_admin_poll_errors_are_generic(self, api_client, admin):
        with patch('apps.cafeteria.views.sync_purchases',
                   side_effect=RuntimeError('token xyz leaked')):
            resp = api_client.post(reverse('cafeteria-refresh'))
        assert resp.status_code == 502 and 'xyz' not in resp.data['detail']

    def test_the_poll_lease_serialises_concurrent_runs(self, api_client, admin):
        LoyverseSyncState.load()
        LoyverseSyncState.objects.filter(pk=1).update(
            purchases_lock_until=timezone.now() + timedelta(minutes=2))
        with patch('apps.cafeteria.services.get_receipts') as fetch:
            result = services.sync_purchases()
            resp = api_client.post(reverse('cafeteria-refresh'))
        fetch.assert_not_called()
        assert result['busy'] is True and resp.data['busy'] is True

    def test_the_lease_is_released_after_a_run(self):
        StudentProfileFactory()
        with patch('apps.cafeteria.services.get_receipts', return_value=[]):
            services.sync_purchases()
            again = services.sync_purchases()
        assert 'busy' not in again
        assert LoyverseSyncState.load().purchases_lock_until is None


# ── 9. repointed loyverse_id ──────────────────────────────
class TestLoyverseIdChange:
    def test_editing_loyverse_id_reseeds_instead_of_minting_a_recarga(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='old')
        _wallet(s, 40)
        resp = api_client.patch(reverse('admin-student-update', args=[s.id]),
                                {'loyverse_id': 'new'}, format='json')
        assert resp.status_code == 200, resp.data
        cb = CafeteriaBalance.objects.get(student=s)
        assert cb.last_synced is None and cb.seeded_at is None
        assert AuditLog.objects.filter(context='portal: cambio de cliente Loyverse').exists()

        r = services.mirror_pos_topups(customers=[{'id': 'new', 'total_points': 500}])
        assert r['credited'] == 0 and r['unseeded'] == 1
        with patch('apps.cafeteria.services.get_customer_by_id',
                   return_value={'total_points': 500}):
            assert services.sync_student_balance(s) == Decimal('500')

    def test_other_edits_leave_the_seed_alone(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='same')
        _wallet(s, 40)
        api_client.patch(reverse('admin-student-update', args=[s.id]), {'group': 'B'},
                         format='json')
        assert CafeteriaBalance.objects.get(student=s).last_synced is not None


# ── 10. smaller gaps ──────────────────────────────────────
class TestApplyAndParams:
    def _office(self, student, amount=100):
        return TopUpRequest.objects.create(student=student, amount=Decimal(str(amount)),
                                           method=TopUpRequest.Method.OFFICE)

    def test_office_apply_sets_balance_after_and_is_single_shot(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='u1')
        _wallet(s, 20)
        topup = self._office(s)
        url = reverse('admin-apply-topup', args=[topup.id])

        assert api_client.post(url).status_code == 200
        assert api_client.post(url).status_code == 400
        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id=f'topup-request-{topup.id}')
        assert tx.balance_after == Decimal('120')
        assert AuditLog.objects.filter(context='cafeteria.topup.apply').count() == 1

    def test_apply_failure_is_generic_and_rolls_back(self, api_client, admin):
        s = StudentProfileFactory(loyverse_id='u1')
        _wallet(s, 20)
        topup = self._office(s)
        with patch('apps.cafeteria.views.add_points_to_customer',
                   side_effect=RuntimeError('db password=hunter2')):
            resp = api_client.post(reverse('admin-apply-topup', args=[topup.id]))
        assert resp.status_code == 502 and 'hunter2' not in resp.data['detail']
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PENDING

    @pytest.mark.parametrize('name', ['cafeteria-transactions', 'cafeteria-spending-trend',
                                      'cafeteria-spending-categories', 'cafeteria-cards',
                                      'cafeteria-loyverse-history', 'cafeteria-statement'])
    def test_non_numeric_student_param_is_a_400(self, api_client, admin, name):
        resp = api_client.get(reverse(name), {'student': 'abc'})
        assert resp.status_code == 400


# ── 11. Django admin ──────────────────────────────────────
class TestDjangoAdminIsReadOnlyForMoney:
    def test_ledger_rows_cannot_be_edited_added_or_deleted(self, rf):
        model_admin = django_admin.site._registry[CafeteriaTransaction]
        request = rf.get('/')
        request.user = AdminFactory(is_superuser=True, is_staff=True)
        assert not model_admin.has_change_permission(request)
        assert not model_admin.has_add_permission(request)
        assert not model_admin.has_delete_permission(request)

    def test_topup_money_fields_are_read_only_notes_editable(self):
        ro = django_admin.site._registry[TopUpRequest].readonly_fields
        assert {'student', 'method', 'status', 'amount'} <= set(ro)
        assert 'notes' not in ro

    def test_balance_cannot_be_repointed(self):
        ro = django_admin.site._registry[CafeteriaBalance].readonly_fields
        assert {'student', 'balance', 'seeded_at'} <= set(ro)


def test_refund_of_a_refunded_payment_topup_keeps_payment_refunded():
    """Smoke: refunding an online top-up still marks its Payment refunded."""
    s = StudentProfileFactory(loyverse_id='')
    _wallet(s, 100)
    topup = TopUpRequest.objects.create(student=s, amount=Decimal('100'),
                                        method=TopUpRequest.Method.ONLINE,
                                        status=TopUpRequest.Status.COMPLETED)
    payment = Payment.objects.create(user=s.user, payment_type=Payment.Type.CAFETERIA,
                                     amount=Decimal('100'), related_topup=topup,
                                     status=Payment.Status.SUCCESS)
    tx = CafeteriaTransaction.objects.create(
        student=s, transaction_type=CafeteriaTransaction.TxType.TOPUP,
        amount=Decimal('100'), loyverse_receipt_id=f'topup-payment-{payment.id}')
    services.refund_transaction(tx)
    payment.refresh_from_db()
    assert payment.status == Payment.Status.REFUNDED
    assert not services.pending_pos_loads().filter(pk=topup.pk).exists()
