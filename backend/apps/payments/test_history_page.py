"""P1-D2/D3/D5: Pagos page summary, filters and CSV export (family-scoped)."""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import TopUpRequest
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db


def _pay(student, payer, amount, status):
    topup = TopUpRequest.objects.create(student=student, amount=Decimal(amount), method=TopUpRequest.Method.ONLINE)
    return Payment.objects.create(user=payer, payment_type=Payment.Type.CAFETERIA, amount=Decimal(amount),
                                  related_topup=topup, status=status)


@pytest.fixture
def family(api_client):
    parent = ParentFactory()
    a = StudentProfileFactory(parents=[parent])
    b = StudentProfileFactory(parents=[parent])
    _pay(a, parent, '200.00', Payment.Status.SUCCESS)
    _pay(a, parent, '100.00', Payment.Status.PENDING)
    _pay(b, parent, '300.00', Payment.Status.SUCCESS)
    other = StudentProfileFactory()
    _pay(other, other.parents.first() or ParentFactory(), '999.00', Payment.Status.SUCCESS)
    api_client.force_authenticate(user=parent)
    return parent, a, b


def test_summary_is_family_scoped(api_client, family):
    _, a, b = family
    data = api_client.get(reverse('payment-summary')).data
    assert Decimal(data['month_total']) == Decimal('500.00') and data['month_count'] == 2
    assert data['pending_count'] == 1
    assert {c['student_id'] for c in data['per_child']} == {a.id, b.id}
    assert data['last_success']['student_name']


def test_history_filters(api_client, family):
    _, a, _ = family
    rows = api_client.get(reverse('payment-history'), {'student': a.id}).data['results']
    assert len(rows) == 2 and all(r['student_id'] == a.id for r in rows)
    rows = api_client.get(reverse('payment-history'), {'status': 'pending'}).data['results']
    assert [r['amount'] for r in rows] == ['100.00']
    rows = api_client.get(reverse('payment-history'), {'from': '2999-01-01'}).data['results']
    assert rows == []


def test_csv_export(api_client, family):
    resp = api_client.get(reverse('payment-history-export'), {'status': 'success'})
    assert resp.status_code == 200 and resp['Content-Disposition'].startswith('attachment; filename="pagos_')
    body = resp.content.decode('utf-8-sig')
    assert body.count('\n') == 3 and '999.00' not in body  # header + 2 family rows, other family excluded


def test_admin_ledger_and_summary(api_client, family):
    from apps.accounts.factories import AdminFactory
    api_client.force_authenticate(user=AdminFactory())
    rows = api_client.get(reverse('admin-payments')).data['results']
    assert len(rows) == 4  # both families
    _, a, _ = family
    rows = api_client.get(reverse('admin-payments'), {'q': a.user.last_name}).data['results']
    assert rows and all(r['student_id'] == a.id for r in rows)
    summ = api_client.get(reverse('admin-payments-summary'), {'days': 7}).data
    assert summ['by_status']['success']['count'] == 3 and summ['series'] and summ['stuck_pending'] == 0
    # families cannot reach the ledger
    parent = ParentFactory()
    api_client.force_authenticate(user=parent)
    assert api_client.get(reverse('admin-payments')).status_code == 403


def test_receipt_pdf_only_for_settled_and_family_scoped(api_client, family):
    parent, a, _ = family
    ok = Payment.objects.filter(related_topup__student=a, status=Payment.Status.SUCCESS).first()
    pending = Payment.objects.filter(related_topup__student=a, status=Payment.Status.PENDING).first()
    resp = api_client.get(reverse('payment-receipt', args=[ok.pk]))
    assert resp.status_code == 200 and resp['Content-Type'] == 'application/pdf' and resp.content.startswith(b'%PDF')
    assert api_client.get(reverse('payment-receipt', args=[pending.pk])).status_code == 409
    other = Payment.objects.exclude(related_topup__student__parents=parent).first()
    assert api_client.get(reverse('payment-receipt', args=[other.pk])).status_code == 404
