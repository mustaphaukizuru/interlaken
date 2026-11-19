"""«Mi cafetería» (2026-11-18): ``?mine=1`` scopes the family cafetería
endpoints to the caller's OWN account whatever its role, so a console user
(an admin, or staff with console areas) sees their own staff wallet instead of
the admin-wide view. It only narrows; a cafetería account grants nothing else.
Invented names only.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import (
    AdminFactory,
    ParentFactory,
    StudentProfileFactory,
    StudentUserFactory,
    UserFactory,
)
from apps.accounts.models import StudentProfile, User
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

pytestmark = pytest.mark.django_db


def staff_account(user=None, **kw):
    return StudentProfileFactory(user=user or StudentUserFactory(), tipo='personal', grade='',
                                 group='', puesto='docente', **kw)


def wallet(profile, amount):
    return CafeteriaBalance.objects.create(student=profile, balance=Decimal(amount),
                                           last_synced=timezone.now())


class TestMine:
    def test_console_admin_sees_only_own_wallet_with_mine(self, api_client):
        admin = AdminFactory()
        own = staff_account(user=admin)
        wallet(own, '20500')
        other = StudentProfileFactory()
        wallet(other, '10')
        api_client.force_authenticate(user=admin)
        mine = api_client.get(reverse('cafeteria-balance'), {'mine': 1}).data
        assert [b['student']['id'] for b in mine] == [own.pk]
        wide = api_client.get(reverse('cafeteria-balance')).data        # unchanged admin view
        assert {b['student']['id'] for b in wide} == {own.pk, other.pk}
        CafeteriaTransaction.objects.create(student=other, transaction_type='purchase', amount=Decimal('3'),
                                            loyverse_receipt_id='R-o')
        CafeteriaTransaction.objects.create(student=own, transaction_type='purchase', amount=Decimal('4'),
                                            loyverse_receipt_id='R-m')
        tx = api_client.get(reverse('cafeteria-transactions'), {'mine': 1}).data['results']
        assert len(tx) == 1 and tx[0]['amount'] == '4.00'
        cards = api_client.get(reverse('cafeteria-cards'), {'mine': 1}).data
        assert [c['student']['id'] for c in cards] == [own.pk]

    def test_staff_role_tops_up_own_account_only(self, api_client, settings):
        teacher = UserFactory(role=User.Role.STAFF, staff_areas=['visitas'])
        own = staff_account(user=teacher, loyverse_id='u-own')
        other = StudentProfileFactory()
        api_client.force_authenticate(user=teacher)
        url = reverse('cafeteria-topup')
        refused = api_client.post(url, {'student': other.pk, 'amount': 100, 'method': 'office'},
                                  format='json')
        assert refused.status_code == 403
        ok = api_client.post(url, {'student': own.pk, 'amount': 100, 'method': 'office'}, format='json')
        # Past the permission and ownership checks: the next rule is the
        # school's (office top-ups are not offered), same as for a family.
        assert ok.status_code == 400 and ok.data['code'] == 'office_not_available'
        threshold = api_client.patch(reverse('cafeteria-threshold', args=[own.pk]),
                                     {'threshold': 40}, format='json')
        assert threshold.status_code == 200
        assert api_client.patch(reverse('cafeteria-threshold', args=[other.pk]),
                                {'threshold': 40}, format='json').status_code == 403
        # Still no console: the cafetería account grants nothing in /admin.
        assert api_client.get(reverse('admin-balances')).status_code == 403

    def test_staff_without_account_still_refused(self, api_client):
        api_client.force_authenticate(user=UserFactory(role=User.Role.STAFF))
        resp = api_client.post(reverse('cafeteria-topup'), {'student': StudentProfileFactory().pk,
                                                            'amount': 100, 'method': 'office'},
                               format='json')
        assert resp.status_code == 403

    def test_mine_never_widens_a_parent(self, api_client):
        parent = ParentFactory()
        child = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(user=parent)
        assert api_client.get(reverse('cafeteria-balance'), {'mine': 1}).data == []
        family = api_client.get(reverse('cafeteria-balance')).data
        assert [b['student']['id'] for b in family] == [child.pk]

    def test_staff_login_family_portal_shows_own_wallet(self, api_client):
        s = staff_account()
        wallet(s, '42')
        api_client.force_authenticate(user=s.user)
        data = api_client.get(reverse('cafeteria-balance')).data
        assert data['student']['id'] == s.pk and data['balance'] == '42.00'


def test_statement_pdf_for_own_account(api_client):
    admin = AdminFactory()
    own = staff_account(user=admin)
    wallet(own, '15')
    api_client.force_authenticate(user=admin)
    with patch('apps.core.pdf_document.render_document_pdf', return_value=b'%PDF-1.4'):
        resp = api_client.get(reverse('cafeteria-statement'), {'mine': 1, 'student': own.pk,
                                                               'month': '2026-11'})
    assert resp.status_code == 200
    assert StudentProfile.objects.filter(user=admin).count() == 1
