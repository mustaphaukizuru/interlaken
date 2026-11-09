"""Pre-launch fixes (2026-11-09), family cafetería: whose tile, and which way the money moved.

- The dashboard's per-child quick top-up opened the wizard on whichever child
  was selected in this browser; the payload now names each tile's student.
- Ledger amounts are stored absolute. A debit adjustment and a top-up reversal
  read as «+» credits in the family history and the statement PDF, whose
  opening balance was then off by twice the amount. The sign now comes from
  the movement's audit row.
"""
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
from apps.cafeteria.services import adjust_balance, refund_transaction

pytestmark = pytest.mark.django_db


def _kid(parent, balance='100.00'):
    kid = StudentProfileFactory()
    kid.parents.add(parent)
    CafeteriaBalance.objects.update_or_create(student=kid, defaults={'balance': Decimal(balance)})
    return kid


def _reversed_topup(kid):
    """A $50 card top-up, then its reversal (a debit stored as a REFUND row)."""
    cb = CafeteriaBalance.objects.get(student=kid)
    cb.balance += Decimal('50')
    cb.save(update_fields=['balance'])
    topup = CafeteriaTransaction.objects.create(
        student=kid, transaction_type='topup', amount=Decimal('50'), date=timezone.now(),
        balance_after=cb.balance, loyverse_receipt_id=f'launch-topup-{kid.pk}')
    refund_transaction(topup, 'Pago duplicado', flag_pos_unload=False, pos_guard=False)
    return topup


def test_dashboard_tiles_name_their_student(api_client):
    parent = ParentFactory()
    a, b = _kid(parent, '10.00'), _kid(parent, '20.00')
    api_client.force_authenticate(parent)

    rows = api_client.get(reverse('dashboard')).data['cafeteria_balances']

    assert sorted((r['student'], r['balance']) for r in rows) == sorted([(a.pk, '10.00'), (b.pk, '20.00')])


def test_history_carries_the_sign_of_refunds_and_adjustments(api_client):
    parent = ParentFactory()
    kid = _kid(parent)
    adjust_balance(kid, Decimal('-30'), 'Corrección', notify=False)
    adjust_balance(kid, Decimal('15'), 'Abono', notify=False)
    _reversed_topup(kid)
    api_client.force_authenticate(parent)

    data = api_client.get(reverse('cafeteria-transactions'), {'student': kid.pk}).data
    rows = data.get('results', data)

    signed = sorted((r['transaction_type'], r['adjustment_amount']) for r in rows)
    assert signed == [('adjustment', '-30.00'), ('adjustment', '15.00'), ('refund', '-50.00'), ('topup', None)]


def test_statement_signs_debits_and_opens_from_the_right_balance(api_client, monkeypatch):
    captured = {}

    def fake_pdf(title, lines, subtitle=''):
        captured['lines'] = list(lines)
        return b'%PDF-1.4 test'

    monkeypatch.setattr('apps.core.pdf.simple_document_pdf', fake_pdf)
    parent = ParentFactory()
    kid = _kid(parent, '100.00')
    # The month opens with a debit: before the fix the opening read $160.00.
    adjust_balance(kid, Decimal('-30'), 'Corrección', notify=False)
    _reversed_topup(kid)
    api_client.force_authenticate(parent)

    r = api_client.get(reverse('cafeteria-statement'), {'student': kid.pk})

    assert r.status_code == 200
    text = '\n'.join(captured['lines'])
    assert 'Saldo inicial: $100.00' in text
    assert 'Saldo final: $70.00' in text
    assert 'Total ajustes: -$30.00' in text
    assert 'Total devoluciones: -$50.00' in text
    assert 'Total recargas: $50.00' in text
    assert '-30.00' in text and '-50.00' in text


def test_statement_lists_history_rows_without_counting_them(api_client, monkeypatch):
    # A POS refund the balance already held (applied=False, no balance_after)
    # used to be added to the running balance and the totals again.
    captured = {}
    monkeypatch.setattr('apps.core.pdf.simple_document_pdf',
                        lambda title, lines, subtitle='': captured.setdefault('lines', list(lines)) and b'%PDF')
    parent = ParentFactory()
    kid = _kid(parent, '100.00')
    CafeteriaTransaction.objects.create(
        student=kid, transaction_type='refund', amount=Decimal('25'), date=timezone.now(),
        balance_after=None, applied=False, description='Devolución en caja', loyverse_receipt_id='pos-r-1')
    adjust_balance(kid, Decimal('-30'), 'Corrección', notify=False)
    api_client.force_authenticate(parent)

    r = api_client.get(reverse('cafeteria-statement'), {'student': kid.pk})

    assert r.status_code == 200
    text = '\n'.join(captured['lines'])
    assert 'Saldo inicial: $100.00' in text
    assert 'Saldo final: $70.00' in text
    assert '(ya en el saldo) Devolución' in text
    assert 'Total devoluciones' not in text


def test_low_balance_alert_reaches_a_family_that_muted_cafeteria(mailoutbox):
    """The Avisos tab says «saldo muy bajo … siempre se envían»; the alert went
    out as the cafetería type, so muting that category (or email) silenced it."""
    from unittest.mock import patch

    from apps.accounts.models import NotificationPreference
    from apps.cafeteria import services
    from apps.cafeteria.test_cafeteria import _receipt
    from apps.portal.models import Notification

    parent = ParentFactory()
    NotificationPreference.objects.update_or_create(user=parent, defaults={'cat_cafeteria': False, 'email_enabled': False})
    student = StudentProfileFactory(loyverse_id='loy-low', parents=[parent])
    CafeteriaBalance.objects.create(student=student, balance=Decimal('60'), low_balance_threshold=Decimal('50'))

    with patch('apps.cafeteria.services.get_receipts', return_value=[_receipt('loy-low', 'R-low', 40)]):
        services.sync_purchases()

    titles = list(Notification.objects.filter(user=parent).values_list('title', 'notif_type'))
    assert ('Saldo bajo en cafetería', 'warning') in titles
    assert ('Compra en cafetería', 'cafeteria') not in titles  # the muted category stays muted
    assert any('Saldo bajo' in m.subject for m in mailoutbox)
