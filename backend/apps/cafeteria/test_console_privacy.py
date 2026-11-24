"""QA sweep 2026-11-24: the cafetería console (balances, low balance, the
per-student page) never carries the student's CURP, birth date, emergency
contacts or medical data. Families still see their own children in full."""
from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import User
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
from apps.cafeteria.serializers import CONSOLE_HIDDEN_STUDENT_FIELDS

pytestmark = pytest.mark.django_db


def _private_student(parent=None):
    student = StudentProfileFactory(
        parents=[parent] if parent else None, curp='PEGA100101HDFRRN09',
        birth_date=date(2016, 1, 1), emergency_name='Tía Rosa', emergency_phone='5511112222',
        emergency_rel='Tía', blood_type='O+', allergies='Nueces')
    CafeteriaBalance.objects.create(student=student, balance=Decimal('5'),
                                    low_balance_threshold=Decimal('50'))
    # A recent movement puts the wallet on the low-balance report.
    CafeteriaTransaction.objects.create(
        student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
        amount=Decimal('10'), loyverse_receipt_id='qa-privacy-1', date=timezone.now())
    return student


def _assert_no_private(student_payload):
    leaked = set(CONSOLE_HIDDEN_STUDENT_FIELDS) & set(student_payload)
    assert not leaked, leaked
    # What the console does read is still there.
    for key in ('id', 'user', 'student_id', 'loyverse_code', 'grade', 'group', 'tipo',
                'archived_at'):
        assert key in student_payload, key


@pytest.mark.parametrize('who', ['cashier', 'admin'])
def test_console_endpoints_carry_no_personal_data(api_client, who):
    student = _private_student()
    user = (UserFactory(role=User.Role.STAFF, staff_areas=['cafeteria']) if who == 'cashier'
            else AdminFactory())
    api_client.force_authenticate(user)

    detail = api_client.get(reverse('admin-student-detail', args=[student.pk]), {'ledger': 0})
    assert detail.status_code == 200
    _assert_no_private(detail.data['balance']['student'])
    assert detail.data['balance']['balance'] == '5.00'

    rows = api_client.get(reverse('admin-balances')).data['results']
    assert rows and all(not set(CONSOLE_HIDDEN_STUDENT_FIELDS) & set(r['student']) for r in rows)
    _assert_no_private(next(r for r in rows if r['student']['id'] == student.pk)['student'])

    low = api_client.get(reverse('admin-low-balance')).data['results']
    assert [r['student']['id'] for r in low] == [student.pk]
    _assert_no_private(low[0]['student'])


def test_family_balance_still_has_its_childs_data(api_client):
    parent = ParentFactory()
    student = _private_student(parent)
    api_client.force_authenticate(parent)
    resp = api_client.get(reverse('cafeteria-balance'))
    assert resp.status_code == 200
    rows = resp.data if isinstance(resp.data, list) else [resp.data]
    mine = next(r for r in rows if r['student']['id'] == student.pk)
    assert mine['student']['curp'] == 'PEGA100101HDFRRN09'
    assert mine['student']['emergency_name'] == 'Tía Rosa'
