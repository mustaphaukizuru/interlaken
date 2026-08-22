"""P1-A6/A7: roster access filters and student status lifecycle."""
import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.accounts.models import StudentProfile

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(api_client):
    api_client.force_authenticate(user=AdminFactory())
    return api_client


def _ids(resp):
    return sorted(r['id'] for r in resp.data['results'])


def test_status_change_deactivates_student_login_and_mirrors_is_active(admin_client):
    p = StudentProfileFactory()
    resp = admin_client.patch(reverse('admin-student-update', args=[p.pk]), {'status': 'on_leave'}, format='json')
    assert resp.status_code == 200 and resp.data['status'] == 'on_leave' and resp.data['is_active'] is False
    p.refresh_from_db()
    p.user.refresh_from_db()
    assert p.is_active is False and p.user.is_active is False
    back = admin_client.patch(reverse('admin-student-update', args=[p.pk]), {'status': 'active'}, format='json')
    assert back.data['is_active'] is True
    p.user.refresh_from_db()
    assert p.user.is_active is True


def test_legacy_is_active_toggle_keeps_status_coherent(admin_client):
    p = StudentProfileFactory()
    admin_client.patch(reverse('admin-student-update', args=[p.pk]), {'is_active': False}, format='json')
    p.refresh_from_db()
    assert p.status == StudentProfile.Status.WITHDRAWN


def test_roster_filters(admin_client):
    never = StudentProfileFactory()
    logged = StudentProfileFactory()
    logged.user.last_login = timezone.now()
    logged.user.save(update_fields=['last_login'])
    nopass = StudentProfileFactory()
    nopass.user.set_unusable_password()
    nopass.user.save(update_fields=['password'])
    gone = StudentProfileFactory()
    gone.save(update_fields=gone.apply_status('graduated'))

    assert _ids(admin_client.get(reverse('students'), {'acceso': 'never'})) == sorted([never.id, nopass.id, gone.id])
    assert _ids(admin_client.get(reverse('students'), {'acceso': 'nopass'})) == [nopass.id]
    assert _ids(admin_client.get(reverse('students'), {'estado': 'graduated'})) == [gone.id]
    assert _ids(admin_client.get(reverse('students'), {'estado': 'active'})) == sorted([never.id, logged.id, nopass.id])
