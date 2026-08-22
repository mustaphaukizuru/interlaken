"""P1-A1: portal student editor (create / edit) with audit trail."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.accounts.models import StudentProfile
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(api_client):
    api_client.force_authenticate(user=AdminFactory())
    return api_client


class TestCreate:
    def test_creates_user_profile_selfguardian_and_audit(self, admin_client):
        resp = admin_client.post(reverse('admin-student-create'), {
            'first_name': 'Ana', 'last_name': 'Pérez', 'student_id': 'a123',
            'grade': '1° Primaria', 'group': 'B',
        }, format='json')
        assert resp.status_code == 201, resp.data
        p = StudentProfile.objects.get(student_id='A123')
        assert p.user.email == 'a123@alumnos.interlaken.edu.mx'
        assert p.user.role == 'student'
        assert not p.user.has_usable_password()
        assert list(p.parents.all()) == [p.user]
        assert AuditLog.objects.filter(object_type='accounts.studentprofile', action='create',
                                       context='portal: alta de alumno').count() == 1

    def test_duplicate_matricula_rejected(self, admin_client):
        StudentProfileFactory(student_id='S1')
        resp = admin_client.post(reverse('admin-student-create'), {
            'first_name': 'X', 'last_name': 'Y', 'student_id': 's1', 'grade': '2° Primaria',
        }, format='json')
        assert resp.status_code == 400 and 'student_id' in resp.data

    def test_parent_forbidden(self, api_client):
        api_client.force_authenticate(user=ParentFactory())
        assert api_client.post(reverse('admin-student-create'), {}, format='json').status_code == 403


class TestUpdate:
    def test_patch_changes_fields_and_audits_diff(self, admin_client):
        p = StudentProfileFactory(grade='1° Primaria', group='A')
        resp = admin_client.patch(reverse('admin-student-update', args=[p.pk]), {
            'grade': '2° Primaria', 'first_name': 'Nuevo', 'is_active': False,
        }, format='json')
        assert resp.status_code == 200, resp.data
        p.refresh_from_db()
        assert (p.grade, p.user.first_name, p.is_active) == ('2° Primaria', 'Nuevo', False)
        log = AuditLog.objects.get(object_type='accounts.studentprofile', action='update',
                                   context='portal: edición de alumno')
        assert set(log.changes) == {'via', 'grade', 'first_name', 'is_active'}
        assert log.changes['grade'] == {'from': '1° Primaria', 'to': '2° Primaria'}

    def test_email_uniqueness(self, admin_client):
        other = StudentProfileFactory()
        p = StudentProfileFactory()
        resp = admin_client.patch(reverse('admin-student-update', args=[p.pk]),
                                  {'email': other.user.email}, format='json')
        assert resp.status_code == 400 and 'email' in resp.data

    def test_noop_patch_writes_no_audit(self, admin_client):
        p = StudentProfileFactory(grade='1° Primaria')
        admin_client.patch(reverse('admin-student-update', args=[p.pk]), {'grade': '1° Primaria'}, format='json')
        assert not AuditLog.objects.filter(action='update', object_type='accounts.studentprofile',
                                           context='portal: edición de alumno').exists()
