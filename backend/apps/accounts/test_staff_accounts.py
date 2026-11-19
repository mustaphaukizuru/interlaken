"""Staff cafetería accounts (2026-11-18, A2 + A6 + A7).

A staff member is a ``StudentProfile`` with ``tipo='personal'``: same wallet,
Loyverse link, top-ups, statement and credential as a pupil, a puesto instead
of a grade, and a code kept as typed. Saving a person looks them up in
Loyverse right away (read-only) and links them under the roster's safety rules.
Invented names only (the repository is public).
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import StudentProfile, User
from apps.accounts.people import (
    code_key,
    convert_to_personal,
    normalize_code,
    split_staff_name,
    strip_staff_prefix,
)
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, UnmatchedReceipt

pytestmark = pytest.mark.django_db

CUSTOMERS = 'apps.cafeteria.services.get_all_customers'
CUSTOMER = 'apps.cafeteria.services.get_customer_by_id'


@pytest.fixture
def admin_client(api_client):
    api_client.force_authenticate(user=AdminFactory())
    return api_client


def _cust(cid, code, email, name='ZP-Rosa Prueba Lince', points='35'):
    return {'id': cid, 'customer_code': code, 'email': email, 'name': name,
            'total_points': points, 'total_visits': 3}


def _create(client, **data):
    body = {'first_name': 'Rosa', 'last_name': 'Lince Vela', 'student_id': 'rlince',
            'email': 'rlince@interlaken.com.mx', 'tipo': 'personal', **data}
    return client.post(reverse('admin-student-create'), body, format='json')


class TestNames:
    def test_prefix_and_split(self):
        assert strip_staff_prefix('ZP-Rosa Lince Vela') == 'Rosa Lince Vela'
        assert strip_staff_prefix(' zp - Rosa') == 'Rosa'
        assert split_staff_name('ZP-Rosa Lince Vela') == ('Rosa', 'Lince Vela')
        assert split_staff_name('ZP-Ana Sofía Lince Vela') == ('Ana Sofía', 'Lince Vela')
        assert split_staff_name('ZP-Dirección') == ('Dirección', '')

    def test_codes(self):
        assert normalize_code('ci09932') == '09932'                 # pupils unchanged
        assert normalize_code('cisneros', 'personal') == 'cisneros'  # staff never stripped
        assert code_key('TLINCE', 'personal') == code_key('tlince', 'personal')


class TestCreateStaff:
    def test_staff_needs_no_grade_and_keeps_code_as_typed(self, admin_client):
        resp = _create(admin_client)
        assert resp.status_code == 201, resp.data
        p = StudentProfile.objects.get(student_id='rlince')
        assert (p.tipo, p.puesto, p.grade, p.group) == ('personal', 'sin_asignar', '', '')
        assert p.user.role == User.Role.STUDENT          # portal only, never the console
        assert not p.user.has_usable_password()
        assert list(p.parents.all()) == []               # notices go to the person only
        assert resp.data['tipo'] == 'personal' and resp.data['puesto_label'] == 'Sin asignar'
        assert resp.data['loyverse_link']['status'] == 'unreachable'   # no token in tests

    def test_pupil_still_needs_grade(self, admin_client):
        resp = admin_client.post(reverse('admin-student-create'), {
            'first_name': 'Leo', 'last_name': 'Prueba', 'student_id': '55501'}, format='json')
        assert resp.status_code == 400 and 'grade' in resp.data

    def test_duplicate_code_is_case_insensitive(self, admin_client):
        StudentProfileFactory(student_id='RLINCE')
        resp = _create(admin_client)
        assert resp.status_code == 400 and 'student_id' in resp.data
        assert resp.data['existing']['student_id'] == 'RLINCE'

    def test_attaches_to_an_existing_console_login(self, admin_client):
        console = AdminFactory(email='caja.demo@interlaken.com.mx')
        resp = _create(admin_client, email='caja.demo@interlaken.com.mx', student_id='900001')
        assert resp.status_code == 201, resp.data
        console.refresh_from_db()
        assert console.role == User.Role.ADMIN           # console untouched
        assert console.student_profile.tipo == 'personal'

    def test_email_with_a_cafeteria_account_is_refused(self, admin_client):
        taken = StudentProfileFactory(user=UserFactory(email='rlince@interlaken.com.mx'))
        resp = _create(admin_client)
        assert resp.status_code == 400 and 'email' in resp.data
        assert StudentProfile.objects.filter(user=taken.user).count() == 1

    def test_puesto_choice(self, admin_client):
        resp = _create(admin_client, puesto='docente')
        assert resp.status_code == 201 and resp.data['puesto_label'] == 'Docente'


class TestEdit:
    def test_switch_pupil_to_staff_clears_grade(self, admin_client):
        p = StudentProfileFactory(grade='3° Secundaria', group='A')
        resp = admin_client.patch(reverse('admin-student-update', args=[p.pk]),
                                  {'tipo': 'personal'}, format='json')
        assert resp.status_code == 200, resp.data
        p.refresh_from_db()
        assert (p.tipo, p.grade, p.group, p.puesto) == ('personal', '', '', 'sin_asignar')
        assert 'loyverse_link' not in resp.data          # code and email unchanged

    def test_back_to_pupil_needs_a_grade(self, admin_client):
        p = StudentProfileFactory(tipo='personal', grade='', group='')
        resp = admin_client.patch(reverse('admin-student-update', args=[p.pk]),
                                  {'tipo': 'alumno'}, format='json')
        assert resp.status_code == 400 and 'grade' in resp.data
        resp = admin_client.patch(reverse('admin-student-update', args=[p.pk]),
                                  {'tipo': 'alumno', 'grade': '1° Primaria'}, format='json')
        assert resp.status_code == 200
        p.refresh_from_db()
        assert (p.tipo, p.puesto) == ('alumno', '')

    def test_changing_code_relinks_on_save(self, admin_client):
        p = StudentProfileFactory(tipo='personal', grade='', loyverse_id='', student_id='rlinze',
                                  user=UserFactory(email='otra.demo@interlaken.com.mx'))
        with patch(CUSTOMERS, return_value=[_cust('uuid-r', 'rlince', 'rlince@x.mx')]), \
                patch(CUSTOMER, return_value={'total_points': '35'}):
            resp = admin_client.patch(reverse('admin-student-update', args=[p.pk]),
                                      {'student_id': 'rlince'}, format='json')
        assert resp.data['loyverse_link']['status'] == 'linked'
        p.refresh_from_db()
        assert p.loyverse_id == 'uuid-r'

    def test_convert_helper_keeps_wallet(self):
        p = StudentProfileFactory(grade='3° Secundaria')
        CafeteriaBalance.objects.create(student=p, balance=Decimal('35'))
        changes = convert_to_personal(p)
        p.refresh_from_db()
        assert changes['grade'] == ['3° Secundaria', '']
        assert p.cafeteria_balance.balance == Decimal('35') and p.loyverse_id
        assert convert_to_personal(p) == {}              # idempotent


class TestLinkOnSave:
    def test_links_by_email_first_seeds_and_replays(self, admin_client):
        UnmatchedReceipt.objects.create(receipt_number='R-1', customer_id='uuid-r', points=Decimal('12'),
                                        payload={'receipt_number': 'R-1', 'customer_id': 'uuid-r',
                                                 'receipt_date': '2026-11-10T15:00:00Z',
                                                 'total_money': 0, 'points_deducted': 12,
                                                 'line_items': []})
        customers = [_cust('uuid-r', 'rlinze', 'rlince@interlaken.com.mx'),   # code typo
                     _cust('uuid-x', 'rlince', 'otro@interlaken.com.mx', name='ZP-Otro Demo')]
        with patch(CUSTOMERS, return_value=customers), \
                patch(CUSTOMER, return_value={'total_points': '35'}):
            resp = _create(admin_client)
        link = resp.data['loyverse_link']
        assert link['status'] == 'linked' and link['matched_by'] == 'correo'
        assert link['message'] == 'Vinculado a Loyverse ✓ · saldo $35.00'
        p = StudentProfile.objects.get(student_id='rlince')
        assert p.loyverse_id == 'uuid-r'
        assert p.cafeteria_balance.balance == Decimal('35')
        assert UnmatchedReceipt.objects.get(receipt_number='R-1').resolved_student == p
        # Older than the opening balance: history, not a second debit.
        assert CafeteriaTransaction.objects.filter(student=p).count() == 1

    def test_pupil_links_by_code_case_insensitive(self, admin_client):
        with patch(CUSTOMERS, return_value=[_cust('uuid-p', 'ci55502', 'ci55502@x.mx',
                                                    name='Prueba Leo-1PRI')]), \
                patch(CUSTOMER, return_value={'total_points': '0'}):
            resp = admin_client.post(reverse('admin-student-create'), {
                'first_name': 'Leo', 'last_name': 'Prueba', 'student_id': 'CI55502',
                'grade': '1° Primaria'}, format='json')
        assert resp.data['loyverse_link']['status'] == 'linked'
        assert StudentProfile.objects.get(student_id='55502').loyverse_id == 'uuid-p'

    def test_two_customers_with_the_code_link_nobody(self, admin_client):
        customers = [_cust('uuid-a', 'rlince', ''), _cust('uuid-b', 'RLINCE', '')]
        with patch(CUSTOMERS, return_value=customers):
            resp = _create(admin_client, email='')
        assert resp.data['loyverse_link']['status'] == 'duplicate_code'
        assert 'dos clientes' in resp.data['loyverse_link']['message']
        assert StudentProfile.objects.get(student_id='rlince').loyverse_id == ''

    def test_not_found(self, admin_client):
        with patch(CUSTOMERS, return_value=[]):
            resp = _create(admin_client)
        assert resp.data['loyverse_link']['status'] == 'not_found'
        assert resp.data['loyverse_link']['message'].startswith('No se encontró en Loyverse')

    def test_never_takes_a_customer_from_someone_else(self, admin_client):
        StudentProfileFactory(loyverse_id='uuid-r')
        with patch(CUSTOMERS, return_value=[_cust('uuid-r', 'rlince', 'rlince@interlaken.com.mx')]):
            resp = _create(admin_client)
        assert resp.data['loyverse_link']['status'] == 'taken'
        assert StudentProfile.objects.get(student_id='rlince').loyverse_id == ''

    def test_never_repoints_an_existing_link(self, admin_client):
        p = StudentProfileFactory(tipo='personal', grade='', loyverse_id='uuid-old', student_id='rlinze',
                                  user=UserFactory(email='rlince@interlaken.com.mx'))
        with patch(CUSTOMERS, return_value=[_cust('uuid-new', 'rlince', 'rlince@interlaken.com.mx')]):
            resp = admin_client.patch(reverse('admin-student-update', args=[p.pk]),
                                      {'student_id': 'rlince'}, format='json')
        assert resp.data['loyverse_link']['status'] == 'conflict'
        p.refresh_from_db()
        assert p.loyverse_id == 'uuid-old'


class TestMe:
    def test_me_reports_own_cafeteria_account(self, api_client):
        admin = AdminFactory(email='caja.demo@interlaken.com.mx')
        api_client.force_authenticate(user=admin)
        assert api_client.get(reverse('current-user')).data['cafeteria_account'] is None
        StudentProfileFactory(user=admin, tipo='personal', grade='', puesto='direccion')
        data = api_client.get(reverse('current-user')).data
        assert data['role'] == 'admin'
        assert data['cafeteria_account']['puesto_label'] == 'Dirección'
