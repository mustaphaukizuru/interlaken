"""
Bulk CSV import: permissions, dry-run purity, creation, idempotency,
parent linking, and per-row error isolation.
"""
import io

import pytest
from django.urls import reverse

from apps.accounts.models import StudentProfile, User

pytestmark = pytest.mark.django_db

URL = reverse('import-students')

HEADER = ('matricula,nombre,apellidos,grado,grupo,email_alumno,loyverse_id,'
          'nombre_padre,email_padre,telefono_padre\n')


def _csv(*lines):
    payload = HEADER + '\n'.join(lines)
    f = io.BytesIO(payload.encode('utf-8-sig'))
    f.name = 'alumnos.csv'
    return f


def _post(client, file, dry_run):
    return client.post(URL, {'file': file, 'dry_run': dry_run}, format='multipart')


class TestAccess:
    def test_parent_403(self, api_client, parent_user):
        api_client.force_authenticate(parent_user)
        assert _post(api_client, _csv(), '1').status_code == 403

    def test_anonymous_401(self, api_client):
        assert _post(api_client, _csv(), '1').status_code == 401


class TestImport:
    def test_dry_run_writes_nothing(self, api_client, admin_user):
        api_client.force_authenticate(admin_user)
        resp = _post(api_client, _csv(
            'INT-001,Ana,García,3° Primaria,A,,,Luis García,luis@x.mx,555'), '1')
        assert resp.status_code == 200
        body = resp.json()
        assert body['dry_run'] is True
        assert body['created_students'] == 1 and body['created_parents'] == 1
        assert StudentProfile.objects.count() == 0
        assert not User.objects.filter(email='luis@x.mx').exists()

    def test_real_run_creates_and_links(self, api_client, admin_user):
        api_client.force_authenticate(admin_user)
        resp = _post(api_client, _csv(
            'INT-001,Ana,García,3° Primaria,A,,LV-9,Luis García,luis@x.mx,555'), '0')
        assert resp.status_code == 200
        body = resp.json()
        assert body['created_students'] == 1 and body['created_parents'] == 1

        profile = StudentProfile.objects.get(student_id='INT-001')
        assert profile.grade == '3° Primaria' and profile.loyverse_id == 'LV-9'
        assert profile.user.role == User.Role.STUDENT
        assert profile.user.email == 'int-001@alumnos.interlaken.edu.mx'
        parent = User.objects.get(email='luis@x.mx')
        assert parent.role == User.Role.PARENT
        assert not parent.has_usable_password()
        # Self-guardian (school-email family login) + explicit padre/tutor.
        assert set(profile.parents.all()) == {profile.user, parent}

    def test_reimport_is_idempotent_update(self, api_client, admin_user):
        api_client.force_authenticate(admin_user)
        row = 'INT-001,Ana,García,3° Primaria,A,,,Luis García,luis@x.mx,555'
        _post(api_client, _csv(row), '0')
        resp = _post(api_client, _csv(
            'INT-001,Ana,García,4° Primaria,B,,,Luis García,luis@x.mx,555'), '0')
        body = resp.json()
        assert body['updated_students'] == 1 and body['created_students'] == 0
        assert body['created_parents'] == 0
        assert User.objects.filter(email='luis@x.mx').count() == 1
        profile = StudentProfile.objects.get(student_id='INT-001')
        assert profile.grade == '4° Primaria'
        assert profile.parents.count() == 2
        assert profile.user in profile.parents.all()

    def test_bad_row_isolated_good_rows_land(self, api_client, admin_user):
        api_client.force_authenticate(admin_user)
        resp = _post(api_client, _csv(
            'INT-001,Ana,García,3° Primaria,,,,,,',
            ',SinMatricula,X,1°,,,,,,',                      # missing matricula
            'INT-003,Beto,Pérez,2° Primaria,,,,Mamá Pérez,,555'), '0')  # parent sin email
        body = resp.json()
        assert body['errors'] == 2
        assert body['created_students'] == 1
        profile = StudentProfile.objects.get(student_id='INT-001')
        assert profile.user in profile.parents.all()
        assert not StudentProfile.objects.filter(student_id='INT-003').exists()

    def test_missing_required_headers_400(self, api_client, admin_user):
        api_client.force_authenticate(admin_user)
        f = io.BytesIO(b'matricula,nombre\nX,Y')
        f.name = 'malo.csv'
        resp = _post(api_client, f, '0')
        assert resp.status_code == 400
        assert 'apellidos' in resp.json()['error']
