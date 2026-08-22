"""P1-H1: staff user management from the portal."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, UserFactory
from apps.accounts.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(api_client):
    admin = AdminFactory()
    api_client.force_authenticate(user=admin)
    return api_client, admin


def test_invite_lists_and_returns_password_once(admin_client):
    c, _ = admin_client
    resp = c.post(reverse('admin-staff'), {'email': 'Nuevo@Test.mx', 'first_name': 'Nuevo', 'role': 'staff'}, format='json')
    assert resp.status_code == 201 and resp.data['temporary_password']
    u = User.objects.get(email='nuevo@test.mx')
    assert u.role == 'staff' and u.check_password(resp.data['temporary_password']) and not u.is_staff
    rows = c.get(reverse('admin-staff')).data['results']
    assert any(r['email'] == 'nuevo@test.mx' and 'temporary_password' not in r for r in rows)


def test_role_change_active_toggle_and_guards(admin_client):
    c, me = admin_client
    other = UserFactory(role='staff', email='s@test.mx')
    ok = c.patch(reverse('admin-staff-detail', args=[other.pk]), {'role': 'admin'}, format='json')
    assert ok.status_code == 200 and ok.data['role'] == 'admin'
    other.refresh_from_db()
    assert other.is_staff is True
    # cannot demote/deactivate self
    assert c.patch(reverse('admin-staff-detail', args=[me.pk]), {'role': 'staff'}, format='json').status_code == 400
    assert c.patch(reverse('admin-staff-detail', args=[me.pk]), {'is_active': False}, format='json').status_code == 400
    # deactivate other admin fine (me remains), then last-admin guard protects me
    assert c.patch(reverse('admin-staff-detail', args=[other.pk]), {'is_active': False}, format='json').status_code == 200
    # parents and superusers are out of scope
    parent = ParentFactory()
    assert c.patch(reverse('admin-staff-detail', args=[parent.pk]), {'is_active': False}, format='json').status_code == 403


def test_reset_password_for_staff(admin_client):
    c, _ = admin_client
    other = UserFactory(role='staff', email='r@test.mx')
    resp = c.post(reverse('admin-staff-reset', args=[other.pk]), {}, format='json')
    assert resp.status_code == 200
    other.refresh_from_db()
    assert other.check_password(resp.data['temporary_password'])


def test_non_admin_forbidden(api_client):
    api_client.force_authenticate(user=UserFactory(role='staff'))
    assert api_client.get(reverse('admin-staff')).status_code == 403
