"""QA sweep 2026-11-24 (round 2): money in family and staff messages reads
«$1,234.50» (a negative «-$99,746.50»), no « — » separators, no «Valentina
H..», a failed card top-up says nothing was charged «a su tarjeta», and a
deduction is «del saldo»."""
from decimal import Decimal

import pytest

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria import services
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.cafeteria.schedule import format_amount
from apps.payments.models import Payment
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize('value, text', [
    (Decimal('1234.5'), '$1,234.50'), (Decimal('-99746.5'), '-$99,746.50'), (0, '$0.00'),
    (None, '$0.00'), ('10039', '$10,039.00'),
])
def test_format_amount(value, text):
    assert format_amount(value) == text


def test_overdraft_error_reads_minus_dollar():
    student = StudentProfileFactory(loyverse_id='')
    CafeteriaBalance.objects.create(student=student, balance=Decimal('253.50'))
    with pytest.raises(ValueError) as exc:
        services.adjust_balance(student, Decimal('-100000'), 'x', notify=False)
    assert 'dejaría el saldo en -$99,746.50' in str(exc.value)
    assert 'saldo actual $253.50' in str(exc.value)


def _parent_and_child(first='Valentina', last='Hernández'):
    parent = ParentFactory()
    child = StudentProfileFactory(parents=[parent], loyverse_id='')
    child.user.first_name, child.user.last_name = first, last
    child.user.save(update_fields=['first_name', 'last_name'])
    return parent, child


def test_purchase_notice_wording():
    parent, child = _parent_and_child()
    tx = CafeteriaTransaction.objects.create(
        student=child, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
        amount=Decimal('36.00'), description='2× Tacos', balance_after=Decimal('10039.00'),
        loyverse_receipt_id='qa-wording-1')
    services._notify_purchase(tx)
    notif = Notification.objects.get(user=parent, title='Compra en cafetería')
    assert notif.message.endswith('Compra en cafetería: $36.00 (2× Tacos). Saldo actual: $10,039.00.')
    assert '—' not in notif.message


def test_failed_topup_says_card_and_has_no_double_period(mailoutbox):
    parent, child = _parent_and_child()
    topup = TopUpRequest.objects.create(student=child, amount=Decimal('100.00'),
                                        method=TopUpRequest.Method.ONLINE)
    payment = Payment.objects.create(user=parent, payment_type=Payment.Type.CAFETERIA,
                                     amount=Decimal('100.00'), related_topup=topup,
                                     status=Payment.Status.FAILED, gateway_tx_id='tx-w')
    services.notify_topup_result(payment, success=False)
    notif = Notification.objects.get(user=parent, title='Recarga de cafetería no completada')
    assert 'ningún cargo a su tarjeta' in notif.message and 'a su saldo' not in notif.message
    [mail] = [m for m in mailoutbox if parent.email in m.to]
    assert '..' not in mail.body
    assert 'para Valentina H. No se realizó ningún cargo a su tarjeta.' in mail.body


def test_deduction_reads_del_saldo(django_capture_on_commit_callbacks):
    parent, child = _parent_and_child()
    CafeteriaBalance.objects.create(student=child, balance=Decimal('100'))
    with django_capture_on_commit_callbacks(execute=True):
        services.adjust_balance(child, Decimal('-12.50'), 'Cobro duplicado')
        services.adjust_balance(child, Decimal('2000.00'), 'Beca')
    messages = list(Notification.objects.filter(user=parent, title='Ajuste de saldo en cafetería')
                    .values_list('message', flat=True))
    assert any(m.startswith('Se descontaron $12.50 del saldo de cafetería de') for m in messages)
    assert any(m.startswith('Se acreditaron $2,000.00 al saldo de cafetería de') for m in messages)
    assert any('Saldo actual: $2,087.50.' in m for m in messages)
