"""QA 2026-11-24 (critical): «Alumnos» staff could take over an administrator.

The chain: attach a staff cafetería account to an admin's login (student
editor, ``tipo=personal``), PATCH that record's email to an address the staff
member controls, then «Continuar con Google» with that address, because
Google sign-in finds the user by email and overwrote a different google_id.
Each link is closed here; families keep their behaviour.
"""
from unittest.mock import patch

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import StudentProfile, User

pytestmark = pytest.mark.django_db


def _client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def secretaria():
    return UserFactory(email='secre@test.mx', role=User.Role.STAFF, staff_areas=['alumnos'])


@pytest.fixture
def admin_with_wallet():
    admin = AdminFactory(email='director@test.mx', google_id='g-admin')
    profile = StudentProfile.objects.create(user=admin, student_id='P-001', grade='', tipo='personal',
                                            puesto='direccion')
    return admin, profile


class TestStudentEditorCannotRepointPrivilegedLogins:
    def test_staff_cannot_change_an_admin_login_email(self, secretaria, admin_with_wallet):
        admin, profile = admin_with_wallet
        r = _client(secretaria).patch(reverse('admin-student-update', args=[profile.pk]),
                                      {'email': 'attacker@gmail.example'}, format='json')
        assert r.status_code == 403
        admin.refresh_from_db()
        assert admin.email == 'director@test.mx'

    def test_not_even_an_admin_changes_an_admin_login_email_here(self, admin_with_wallet):
        admin, profile = admin_with_wallet
        other_admin = AdminFactory(email='otro@test.mx')
        r = _client(other_admin).patch(reverse('admin-student-update', args=[profile.pk]),
                                       {'email': 'nuevo@test.mx'}, format='json')
        assert r.status_code == 403

    def test_a_staff_login_email_needs_an_administrator(self, secretaria):
        cashier = UserFactory(email='caja@test.mx', role=User.Role.STAFF, staff_areas=['cafeteria'])
        profile = StudentProfile.objects.create(user=cashier, student_id='P-002', grade='', tipo='personal')
        url = reverse('admin-student-update', args=[profile.pk])
        assert _client(secretaria).patch(url, {'email': 'x@gmail.example'}, format='json').status_code == 403
        assert _client(AdminFactory()).patch(url, {'email': 'caja2@test.mx'}, format='json').status_code == 200
        cashier.refresh_from_db()
        assert cashier.email == 'caja2@test.mx'

    def test_a_family_login_email_is_still_editable_by_alumnos_staff(self, secretaria):
        pupil = StudentProfileFactory(user__email='ci12345@test.mx')
        r = _client(secretaria).patch(reverse('admin-student-update', args=[pupil.pk]),
                                      {'email': 'ci12346@test.mx'}, format='json')
        assert r.status_code == 200, r.data
        pupil.user.refresh_from_db()
        assert pupil.user.email == 'ci12346@test.mx'

    def test_names_and_other_fields_still_save_for_a_staff_record(self, secretaria, admin_with_wallet):
        _, profile = admin_with_wallet
        r = _client(secretaria).patch(reverse('admin-student-update', args=[profile.pk]),
                                      {'puesto': 'coordinacion', 'email': 'director@test.mx'}, format='json')
        assert r.status_code == 200, r.data
        profile.refresh_from_db()
        assert profile.puesto == 'coordinacion'

    def test_staff_cannot_attach_a_cafeteria_account_to_an_admin_login(self, secretaria):
        AdminFactory(email='admin2@test.mx')
        r = _client(secretaria).post(reverse('admin-student-create'), {
            'tipo': 'personal', 'puesto': 'direccion', 'email': 'admin2@test.mx',
            'student_id': 'QA-ADMW', 'first_name': 'QA', 'last_name': 'Admin'}, format='json')
        assert r.status_code == 403
        assert not StudentProfile.objects.filter(student_id='QA-ADMW').exists()

    def test_an_admin_may_still_attach_one_to_an_admin_login(self):
        AdminFactory(email='admin3@test.mx')
        with patch('apps.accounts.student_admin._link_on_save', return_value=None):
            r = _client(AdminFactory()).post(reverse('admin-student-create'), {
                'tipo': 'personal', 'puesto': 'direccion', 'email': 'admin3@test.mx',
                'student_id': 'QA-ADM3', 'first_name': 'QA', 'last_name': 'Admin'}, format='json')
        assert r.status_code == 201, r.data


@patch('apps.accounts.views.google_id_token.verify_oauth2_token')
class TestGoogleSignInKeepsPrivilegedLoginsOnTheirGoogleAccount:
    def _login(self, mock_verify, sub, email):
        mock_verify.return_value = {'sub': sub, 'email': email, 'email_verified': True}
        return APIClient().post(reverse('google-token'), {'credential': 'fake'}, format='json')

    def test_an_admin_bound_to_another_google_account_is_refused(self, mock_verify):
        AdminFactory(email='boss@test.mx', google_id='g-original')
        r = self._login(mock_verify, 'g-attacker', 'boss@test.mx')
        assert r.status_code == 403 and r.data['code'] == 'google_mismatch'
        assert User.objects.get(email='boss@test.mx').google_id == 'g-original'

    def test_the_same_admin_with_its_own_google_account_signs_in(self, mock_verify):
        AdminFactory(email='boss2@test.mx', google_id='g-boss2')
        assert self._login(mock_verify, 'g-boss2', 'boss2@test.mx').status_code == 200

    def test_an_admin_never_bound_signs_in_and_gets_bound(self, mock_verify):
        AdminFactory(email='boss3@test.mx', google_id=None)
        assert self._login(mock_verify, 'g-boss3', 'boss3@test.mx').status_code == 200
        assert User.objects.get(email='boss3@test.mx').google_id == 'g-boss3'

    def test_a_family_whose_google_account_was_recreated_still_signs_in(self, mock_verify):
        ParentFactory(email='familia@test.mx', google_id='g-old')
        assert self._login(mock_verify, 'g-new', 'familia@test.mx').status_code == 200
        assert User.objects.get(email='familia@test.mx').google_id == 'g-new'
