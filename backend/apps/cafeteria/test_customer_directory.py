"""Every Loyverse customer is synced into the app, not only the pupils.

2026-09-23: the store had 394 customers; the app knew 350 (linked students).
The other 44 (staff meal cards, the school's own cards, test records) were
invisible, and the office read that as "students missing". Now each card has
a LoyverseProfile row with its kind, live points, visits and whether Loyverse
still has it, refreshed on every full pass and on webhooks, and the console
lists them with their receipts.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.cafeteria import services as S
from apps.cafeteria.loyverse_profile import classify_customer, refresh_all_profiles
from apps.cafeteria.models import CafeteriaBalance, LoyverseProfile, UnmatchedReceipt

SECRET = 'test-webhook-secret'


def cust(uuid, **f):
    return {'id': uuid, 'total_points': 0, 'total_visits': 0, **f}


PUPIL = dict(customer_code='ci10999', name='Perez Lopez Ana-1PRI', address='1PRI',
             email='ci10999@interlaken.com.mx')
STAFF = dict(customer_code='170', name='ZP-Rivero Montes de Oca Nadia',
             email='nrivero@interlaken.com.mx', total_points=178, total_visits=177)
OFFICE = dict(customer_code='9002', name='ZP-Martha Alicia Magana Perez',
              email='direccion@interlaken.com.mx', total_points=6928)
TEST = dict(customer_code='CI29098', name='PROBANDO ALUMNO', email='PRUEBA@INTERLAKEN.COM.MX')
GMAIL_TEST = dict(customer_code='PFINAL', name='PRUEBA FINAL', email='pruebafinal@GMAIL.COM')
NOCODE = dict(customer_code=None, name='Mariana Herrera Rosas', email='mherrera@interlaken.com.mx')


class TestClassify:
    def test_pupil_staff_test_other(self):
        assert classify_customer(cust('a', **PUPIL)) == 'student'
        assert classify_customer(cust('b', **STAFF)) == 'staff'
        assert classify_customer(cust('c', **OFFICE)) == 'staff'
        assert classify_customer(cust('d', **TEST)) == 'test'
        assert classify_customer(cust('e', **GMAIL_TEST)) == 'test'
        assert classify_customer(cust('f', **NOCODE)) == 'staff'
        assert classify_customer(cust('g', name='Cliente suelto', email='x@gmail.com')) == 'other'


@pytest.mark.django_db
class TestRefreshStoresEveryCard:
    def test_staff_and_test_cards_get_rows_with_their_kind(self):
        s = StudentProfileFactory(loyverse_id='p1')
        report = refresh_all_profiles([cust('p1', **PUPIL), cust('s1', **STAFF),
                                       cust('t1', **TEST), cust('o1', name='X', email='x@y.z')])

        assert report['total'] == 4 and report['matched'] == 1 and report['unmatched'] == 3
        assert report['staff'] == 1 and report['test'] == 1 and report['other'] == 1
        assert LoyverseProfile.objects.count() == 4
        staff = LoyverseProfile.objects.get(loyverse_id='s1')
        assert staff.kind == 'staff' and staff.student is None
        assert staff.total_points == Decimal('178') and staff.total_visits == 177
        assert LoyverseProfile.objects.get(loyverse_id='p1').student_id == s.id
        assert LoyverseProfile.objects.get(loyverse_id='p1').kind == 'student'

    def test_full_list_marks_a_vanished_card_missing_and_a_partial_list_never_does(self):
        refresh_all_profiles([cust('s1', **STAFF), cust('s2', **OFFICE)])

        r = refresh_all_profiles([cust('s1', **STAFF)])
        assert r['missing'] == 1
        assert LoyverseProfile.objects.get(loyverse_id='s2').missing_since is not None

        refresh_all_profiles([cust('s1', **{**STAFF, 'total_visits': 178})], mark_missing=False)
        assert LoyverseProfile.objects.get(loyverse_id='s2').missing_since is not None

        refresh_all_profiles([cust('s1', **STAFF), cust('s2', **OFFICE)])
        assert LoyverseProfile.objects.get(loyverse_id='s2').missing_since is None

    def test_unchanged_cards_are_not_rewritten_but_stay_fresh(self):
        from datetime import timedelta
        old = timezone.now() - timedelta(days=2)
        refresh_all_profiles([cust('s1', **STAFF)])
        LoyverseProfile.objects.filter(loyverse_id='s1').update(synced_at=old)

        r = refresh_all_profiles([cust('s1', **STAFF)])

        assert r['created'] == 0 and r['updated'] == 0
        assert LoyverseProfile.objects.get(loyverse_id='s1').synced_at > old

    def test_relinking_a_student_moves_the_binding(self):
        s = StudentProfileFactory(loyverse_id='old')
        refresh_all_profiles([cust('old', **PUPIL)])
        s.loyverse_id = 'new'
        s.save(update_fields=['loyverse_id'])

        refresh_all_profiles([cust('old', **PUPIL), cust('new', **PUPIL)])

        assert LoyverseProfile.objects.get(loyverse_id='new').student_id == s.id
        assert LoyverseProfile.objects.get(loyverse_id='old').student is None

    def test_full_mirror_pass_refreshes_the_store_and_reports_it(self):
        s = StudentProfileFactory(loyverse_id='p1')
        CafeteriaBalance.objects.create(student=s, balance=Decimal('5'), last_synced=timezone.now())
        with patch('apps.cafeteria.services.get_all_customers',
                   return_value=[cust('p1', **PUPIL, total_points=5), cust('s1', **STAFF)]):
            audit = S.mirror_pos_topups()['audit']
        assert audit['profiles_total'] == 2 and audit['profiles_staff'] == 1
        assert LoyverseProfile.objects.filter(kind='staff').count() == 1

    def test_customers_update_webhook_refreshes_cards_in_real_time(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = SECRET
        refresh_all_profiles([cust('s1', **STAFF), cust('s2', **OFFICE)])

        api_client.post(reverse('cafeteria-loyverse-webhook-token', args=[SECRET]),
                        {'type': 'customers.update',
                         'customers': [cust('s1', **{**STAFF, 'total_points': 378})]},
                        format='json')

        assert LoyverseProfile.objects.get(loyverse_id='s1').total_points == Decimal('378')
        assert LoyverseProfile.objects.get(loyverse_id='s2').missing_since is None


@pytest.mark.django_db
class TestCustomerDirectoryEndpoints:
    def test_lists_every_card_with_kind_student_link_and_receipt_counts(self, api_client):
        s = StudentProfileFactory(loyverse_id='p1')
        refresh_all_profiles([cust('p1', **PUPIL), cust('s1', **STAFF), cust('t1', **TEST)])
        S.record_receipts([{
            'receipt_number': 'r-1', 'customer_id': 's1', 'receipt_type': 'SALE',
            'receipt_date': '2026-09-22T17:00:00.000Z', 'total_money': 0,
            'total_discounts': [{'type': 'DISCOUNT_BY_POINTS', 'money_amount': 45}],
            'line_items': [{'item_name': 'Comida corrida', 'quantity': 1}],
        }], students={})
        api_client.force_authenticate(AdminFactory())

        data = api_client.get(reverse('admin-customers')).json()

        assert data['count'] == 3
        assert data['summary'] == {'student': 1, 'staff': 1, 'test': 1, 'other': 0, 'missing': 0}
        by_id = {r['loyverse_id']: r for r in data['results']}
        assert by_id['p1']['student']['id'] == s.id and by_id['p1']['kind'] == 'student'
        assert by_id['s1']['student'] is None and by_id['s1']['receipts'] == 1
        assert by_id['s1']['kind_display'] == 'Personal'

        nonstudents = api_client.get(reverse('admin-customers'), {'kind': 'nonstudent'}).json()
        assert {r['loyverse_id'] for r in nonstudents['results']} == {'s1', 't1'}
        found = api_client.get(reverse('admin-customers'), {'q': 'rivero'}).json()
        assert [r['loyverse_id'] for r in found['results']] == ['s1']

    def test_receipts_of_a_staff_card(self, api_client):
        refresh_all_profiles([cust('s1', **STAFF)])
        S.record_receipts([{
            'receipt_number': 'r-9', 'customer_id': 's1', 'receipt_type': 'SALE',
            'receipt_date': '2026-09-22T17:00:00.000Z', 'total_money': 0,
            'total_discounts': [{'type': 'DISCOUNT_BY_POINTS', 'money_amount': 45}],
            'line_items': [{'item_name': 'Comida corrida', 'quantity': 1},
                           {'item_name': 'Agua', 'quantity': 2}],
        }], students={})
        api_client.force_authenticate(AdminFactory())

        data = api_client.get(reverse('admin-customer-receipts', args=['s1'])).json()

        assert data['customer']['name'].startswith('ZP-')
        assert data['results'][0]['points'] == '45.00'
        assert data['results'][0]['items'] == 'Comida corrida, 2× Agua'
        assert data['results'][0]['resolved'] is False
        assert UnmatchedReceipt.objects.count() == 1

    def test_family_cannot_read_the_directory(self, api_client):
        from apps.accounts.factories import ParentFactory
        api_client.force_authenticate(ParentFactory())
        assert api_client.get(reverse('admin-customers')).status_code == 403
