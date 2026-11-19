"""A8 (2026-11-18): the admin cafetería lists filter by person.

``student_status`` (a lifecycle status, ``archived``, ``inactive`` or all)
and ``tipo`` (``alumno`` | ``personal``) on Saldos, Saldo bajo, Movimientos
and the top-up lists; staff rows carry their ``tipo`` for the «Personal» tag.
The API default stays «every status»: the console asks for active people.
Invented names only.
"""
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, StudentProfileFactory, StudentUserFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest

pytestmark = pytest.mark.django_db


def staff_account(user=None, **kw):
    return StudentProfileFactory(user=user or StudentUserFactory(), tipo='personal', grade='',
                                 group='', puesto='docente', **kw)


def wallet(profile, amount):
    return CafeteriaBalance.objects.create(student=profile, balance=Decimal(amount),
                                           last_synced=timezone.now())


@pytest.fixture
def admin_api(api_client):
    api_client.force_authenticate(user=AdminFactory())
    return api_client


class TestAdminListFilters:
    def test_balances_by_status_and_tipo(self, admin_api):
        pupil = StudentProfileFactory()
        gone = StudentProfileFactory(status='withdrawn', is_active=False)
        s = staff_account()
        for p in (pupil, gone, s):
            wallet(p, '10')
        url = reverse('admin-balances')
        ids = lambda **q: {r['student']['id'] for r in admin_api.get(url, q).data['results']}  # noqa: E731
        assert ids() == {pupil.pk, gone.pk, s.pk}                         # API default unchanged
        assert ids(student_status='active') == {pupil.pk, s.pk}
        assert ids(student_status='inactive') == {gone.pk}
        assert ids(student_status='active', tipo='personal') == {s.pk}
        assert ids(tipo='alumno') == {pupil.pk, gone.pk}
        row = admin_api.get(url, {'tipo': 'personal'}).data['results'][0]
        assert row['student']['tipo'] == 'personal' and row['student']['puesto_label'] == 'Docente'

    def test_archived(self, admin_api):
        p = StudentProfileFactory(status='withdrawn', is_active=False)
        p.user.archived_at = timezone.now()
        p.user.save(update_fields=['archived_at'])
        wallet(p, '0')
        wallet(StudentProfileFactory(), '5')
        rows = admin_api.get(reverse('admin-balances'), {'student_status': 'archived'}).data['results']
        assert [r['student']['id'] for r in rows] == [p.pk]

    def test_transactions_and_topups_carry_tipo(self, admin_api):
        s = staff_account()
        pupil = StudentProfileFactory()
        CafeteriaTransaction.objects.create(student=s, transaction_type='purchase', amount=Decimal('5'),
                                            loyverse_receipt_id='R-s')
        CafeteriaTransaction.objects.create(student=pupil, transaction_type='purchase', amount=Decimal('7'),
                                            loyverse_receipt_id='R-p')
        TopUpRequest.objects.create(student=s, amount=Decimal('100'), method='office')
        tx = admin_api.get(reverse('admin-transactions'), {'tipo': 'personal'}).data['results']
        assert [t['student_tipo'] for t in tx] == ['personal']
        top = admin_api.get(reverse('admin-topups'), {'tipo': 'personal',
                                                       'student_status': 'active'}).data['results']
        assert [t['student_tipo'] for t in top] == ['personal']
        assert admin_api.get(reverse('admin-topups'), {'tipo': 'alumno'}).data['count'] == 0
