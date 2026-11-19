"""Admin dashboard (2026-11-18): pupils' and staff wallet totals apart.

The three institutional staff wallets hold over $20,000; counted with the
pupils they would distort the «Saldo alumnos» figure. Student counts and KPIs
count pupils only. Invented names only.
"""
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, StudentProfileFactory, StudentUserFactory
from apps.cafeteria.models import CafeteriaBalance

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


class TestDashboard:
    def test_wallet_totals_apart_and_pupil_counts(self, admin_api):
        wallet(StudentProfileFactory(), '120')
        wallet(StudentProfileFactory(), '30')
        wallet(staff_account(), '20500')
        data = admin_api.get(reverse('dashboard')).data
        assert data['total_students'] == 2 and data['total_staff_accounts'] == 1
        assert Decimal(data['cafeteria_students_balance']) == Decimal('150')
        assert Decimal(data['cafeteria_staff_balance']) == Decimal('20500')
        assert Decimal(data['cafeteria_total_balance']) == Decimal('20650')


def test_family_dashboard_tells_a_staff_wallet_apart(api_client):
    """A staff member's own login: its one «child» says it is staff, with the puesto."""
    s = staff_account()
    wallet(s, '50')
    api_client.force_authenticate(user=s.user)
    child = api_client.get(reverse('dashboard')).data['children'][0]
    assert (child['tipo'], child['puesto_label']) == ('personal', 'Docente')
