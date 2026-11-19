"""«Importar personal desde Loyverse» (A3 + A5, 2026-11-18).

The review lists every «ZP-» card with what a commit would do; the commit
creates or links one staff cafetería account per card, converts a pupil record
only when asked, seeds the opening balance once and replays the parked
receipts. Invented names and codes only.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import StudentProfile, User
from apps.accounts.staff_import import import_staff_from_loyverse
from apps.cafeteria.models import (
    CafeteriaBalance,
    CafeteriaTransaction,
    LoyverseProfile,
    UnmatchedReceipt,
)
from apps.cafeteria.services import LoyverseError
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db
URL = reverse('import-staff-loyverse')


def _c(cid, name, code, email, points='0', visits=0):
    return {'id': cid, 'name': name, 'customer_code': code, 'email': email,
            'total_points': points, 'total_visits': visits, 'last_visit': '2026-11-10T15:00:00Z'}


@pytest.fixture
def store():
    return [
        _c('u-rosa', 'ZP-Rosa Lince Vela', 'rlince', 'rlince@interlaken.com.mx', '50', 4),
        _c('u-caja', 'ZP-Caja Central', '541999', 'caja.demo@interlaken.com.mx', '900', 2),
        _c('u-tomas', 'ZP-Tomás Vela Ruiz', 'tvvela', 'tvela@interlaken.com.mx', '35', 6),
        _c('u-nadie', 'ZP-Nora Sur Paz', 'ndsur', 'ndsur@interlaken.com.mx'),
        _c('u-pupil', 'Lince Vela Leo-1PRI', 'ci55501', 'ci55501@interlaken.com.mx', '20', 3),
    ]


@pytest.fixture
def tomas():
    """A staff member created by hand as a pupil, already linked by email."""
    p = StudentProfileFactory(student_id='TVVELA', grade='3° Secundaria', loyverse_id='u-tomas',
                              user=UserFactory(email='tvela@interlaken.com.mx',
                                               role=User.Role.STUDENT))
    CafeteriaBalance.objects.create(student=p, balance=Decimal('35'),
                                    last_synced='2026-10-01T12:00:00Z')
    return p


def _park(number, customer, points='12', when='2026-11-12T15:00:00Z'):
    UnmatchedReceipt.objects.create(
        receipt_number=number, customer_id=customer, points=Decimal(points),
        payload={'receipt_number': number, 'customer_id': customer, 'receipt_date': when,
                 'total_money': 0, 'points_deducted': float(points), 'line_items': []})


class TestReview:
    def test_rows_actions_and_flags(self, store, tomas):
        AdminFactory(email='caja.demo@interlaken.com.mx')
        _park('R-1', 'u-rosa')
        report = import_staff_from_loyverse(store)
        assert report['staff_customers'] == 4 and report['commit'] is False
        rows = {r['loyverse_id']: r for r in report['rows']}
        assert 'u-pupil' not in rows                      # pupils are not staff
        assert rows['u-rosa']['action'] == 'crear'
        assert rows['u-rosa']['name'] == 'Rosa Lince Vela'  # «ZP-» dropped
        assert rows['u-rosa']['pending_receipts'] == 1
        assert rows['u-caja']['action'] == 'vincular_cuenta' and 'consola' in rows['u-caja']['flags']
        assert rows['u-tomas']['action'] == 'convertir'
        assert rows['u-tomas']['existing']['id'] == tomas.pk
        assert 'codigo_distinto' in rows['u-tomas']['flags']   # tvvela vs tvela@
        assert 'sin_actividad' in rows['u-nadie']['flags']
        assert not StudentProfile.objects.filter(tipo='personal').exists()   # nothing written

    def test_conflicts_are_never_repointed(self, store):
        StudentProfileFactory(tipo='personal', grade='', loyverse_id='u-other', student_id='rlince')
        rows = {r['loyverse_id']: r for r in import_staff_from_loyverse(store)['rows']}
        assert rows['u-rosa']['action'] == 'conflicto'


class TestCommit:
    def test_creates_attaches_seeds_and_replays(self, store, tomas):
        console = AdminFactory(email='caja.demo@interlaken.com.mx')
        _park('R-1', 'u-rosa')
        admin = AdminFactory()
        report = import_staff_from_loyverse(store, commit=True, actor=admin)
        assert (report['created'], report['attached'], report['converted']) == (2, 1, 0)
        rosa = StudentProfile.objects.get(student_id='rlince')
        assert (rosa.tipo, rosa.puesto, rosa.grade, rosa.loyverse_id) == (
            'personal', 'sin_asignar', '', 'u-rosa')
        assert rosa.user.role == User.Role.STUDENT and rosa.user.first_name == 'Rosa'
        assert rosa.cafeteria_balance.balance == Decimal('50')           # seeded once
        assert LoyverseProfile.objects.get(loyverse_id='u-rosa').kind == 'staff'
        console.refresh_from_db()
        assert console.role == User.Role.ADMIN and console.student_profile.tipo == 'personal'
        # A5: the parked purchase is history now (older than the seed: no debit).
        assert report['replay']['absorbed'] == 1 and report['recovered_receipts'] == 1
        assert CafeteriaTransaction.objects.filter(student=rosa).count() == 1
        assert rosa.cafeteria_balance.balance == Decimal('50')
        tomas.refresh_from_db()
        assert tomas.tipo == 'alumno'                       # not converted unless asked
        assert AuditLog.objects.filter(context='import:personal').exists()

    def test_convert_keeps_wallet_and_history(self, store, tomas):
        report = import_staff_from_loyverse(store, commit=True, convert_ids=[tomas.pk])
        assert report['converted'] == 1
        tomas.refresh_from_db()
        assert (tomas.tipo, tomas.grade, tomas.loyverse_id) == ('personal', '', 'u-tomas')
        assert tomas.cafeteria_balance.balance == Decimal('35')         # untouched

    def test_second_run_is_up_to_date(self, store):
        import_staff_from_loyverse(store, commit=True)
        again = import_staff_from_loyverse(store, commit=True)
        assert again['counts']['al_dia'] == 4 and again['created'] == 0
        assert StudentProfile.objects.filter(tipo='personal').count() == 4
        assert CafeteriaBalance.objects.get(student__student_id='rlince').balance == Decimal('50')


class TestEndpoint:
    def test_admin_only(self, api_client):
        staff = UserFactory(role=User.Role.STAFF, staff_areas=['alumnos', 'cafeteria'])
        api_client.force_authenticate(user=staff)
        assert api_client.post(URL, {}, format='json').status_code == 403

    def test_review_then_commit(self, api_client, store):
        api_client.force_authenticate(user=AdminFactory())
        with patch('apps.cafeteria.services.get_all_customers', return_value=store):
            review = api_client.post(URL, {'commit': 0}, format='json')
            assert review.status_code == 200 and review.data['counts']['crear'] == 4
            done = api_client.post(URL, {'commit': 1}, format='json')
        assert done.data['created'] == 4 and done.data['balance_seeded'] == '985.00'

    def test_loyverse_down(self, api_client):
        api_client.force_authenticate(user=AdminFactory())
        with patch('apps.cafeteria.services.get_all_customers', side_effect=LoyverseError('x')):
            assert api_client.post(URL, {}, format='json').status_code == 502
