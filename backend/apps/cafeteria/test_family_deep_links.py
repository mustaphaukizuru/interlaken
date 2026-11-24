"""QA sweep 2026-11-24 (round 2): a notice or a Novedades item about one
child opens THAT child's cafetería (``/portal/cafeteria?alumno=<pk>``), not
whichever sibling the portal had selected."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria import services
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db


@pytest.fixture
def family():
    parent = ParentFactory()
    older = StudentProfileFactory(parents=[parent], loyverse_id='')
    younger = StudentProfileFactory(parents=[parent], loyverse_id='')
    return parent, older, younger


def _link(student):
    return f'/portal/cafeteria?alumno={student.pk}'


def _emails_to(mailoutbox, user):
    return [m for m in mailoutbox if user.email in m.to]


def _text(message):
    html = ''.join(c for c, mime in getattr(message, 'alternatives', []) if mime == 'text/html')
    return message.body + html


def test_helper():
    s = StudentProfileFactory()
    assert services.family_cafeteria_path(s) == f'/portal/cafeteria?alumno={s.pk}'


def test_low_balance_notice_links_the_child(family, mailoutbox, django_capture_on_commit_callbacks):
    parent, _older, younger = family
    cb = CafeteriaBalance.objects.create(student=younger, balance=Decimal('3'),
                                         low_balance_threshold=Decimal('50'))
    with django_capture_on_commit_callbacks(execute=True):
        assert services._maybe_low_balance_alert(cb, timezone.now()) >= 1
    [mail] = _emails_to(mailoutbox, parent)
    assert _link(younger) in _text(mail)


def test_weekly_low_balance_alert_links_the_child(family, mailoutbox):
    parent, older, _younger = family
    CafeteriaBalance.objects.create(student=older, balance=Decimal('2'),
                                    low_balance_threshold=Decimal('50'))
    CafeteriaTransaction.objects.create(
        student=older, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
        amount=Decimal('5'), loyverse_receipt_id='qa-deep-1', date=timezone.now())
    call_command('low_balance_alerts')
    mails = _emails_to(mailoutbox, parent)
    assert mails and all(_link(older) in _text(m) for m in mails)


def test_failed_and_not_charged_topups_link_the_child(family, mailoutbox):
    parent, older, _younger = family
    topup = TopUpRequest.objects.create(student=older, amount=Decimal('100.00'),
                                        method=TopUpRequest.Method.ONLINE)
    payment = Payment.objects.create(user=parent, payment_type=Payment.Type.CAFETERIA,
                                     amount=Decimal('100.00'), related_topup=topup,
                                     status=Payment.Status.FAILED, gateway_tx_id='tx-deep')
    services.notify_topup_result(payment, success=False)
    services.notify_topup_not_charged(payment)
    mails = _emails_to(mailoutbox, parent)
    assert len(mails) >= 2 and all(_link(older) in _text(m) for m in mails)


def test_novedades_items_link_the_child(family, api_client):
    parent, older, younger = family
    CafeteriaTransaction.objects.create(
        student=younger, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
        amount=Decimal('12'), loyverse_receipt_id='qa-deep-2', date=timezone.now())
    topup = TopUpRequest.objects.create(student=older, amount=Decimal('50.00'),
                                        method=TopUpRequest.Method.ONLINE)
    Payment.objects.create(user=parent, payment_type=Payment.Type.CAFETERIA, amount=Decimal('50.00'),
                           related_topup=topup, status=Payment.Status.SUCCESS, gateway_tx_id='tx-n')
    api_client.force_authenticate(parent)
    since = (timezone.now() - timedelta(days=1)).isoformat()
    resp = api_client.get(reverse('novedades'), {'since': since})
    assert resp.status_code == 200
    items = resp.data['items'] if isinstance(resp.data, dict) else resp.data
    links = {i['type']: i['link'] for i in items if i['type'] in ('cafeteria', 'pago')}
    assert links['cafeteria'] == _link(younger)
    assert links['pago'] == _link(older)
