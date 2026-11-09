"""Pre-launch fixes (2026-11-09): staff password takeover and medical data in the student editor.

- The family password flows («accesos») refused only admin and superuser
  targets, so a Secretaría account could set the cafetería cashier's password
  and sign in as them. They now handle family accounts only.
- The student editor answered with the real medical data to «Alumnos» staff,
  and saving the form they see (masked «●●●») wrote the mask over the real
  allergies. Answers are masked like the read endpoint; writes are guarded.
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import PasswordRequest, StudentProfile, User

pytestmark = pytest.mark.django_db


def _staff(*areas):
    return UserFactory(role=User.Role.STAFF, staff_areas=list(areas))


class TestFamilyPasswordFlowsAreForFamiliesOnly:
    def test_accesos_cannot_set_a_colleagues_password(self, api_client):
        api_client.force_authenticate(_staff('accesos'))
        cashier = _staff('cafeteria', 'alumnos')
        r = api_client.post(reverse('admin-set-password', args=[cashier.pk]), {}, format='json')
        assert r.status_code == 403
        assert 'temporary_password' not in r.data
        cashier.refresh_from_db()
        assert cashier.check_password('test-pass-12345')  # untouched

    def test_accesos_still_resets_a_family_account(self, api_client):
        api_client.force_authenticate(_staff('accesos'))
        family = ParentFactory()
        r = api_client.post(reverse('admin-set-password', args=[family.pk]), {}, format='json')
        assert r.status_code == 200 and r.data['temporary_password']

    def test_a_password_request_cannot_be_resolved_onto_a_staff_account(self, api_client):
        api_client.force_authenticate(_staff('accesos'))
        cashier = _staff('cafeteria')
        req = PasswordRequest.objects.create(user=cashier, requested_email=cashier.email,
                                             channel=PasswordRequest.Channel.WHATSAPP)
        r = api_client.patch(reverse('password-request-detail', args=[req.pk]),
                             {'action': 'resolve', 'delivered_via': req.channel}, format='json')
        assert r.status_code == 403


class TestMedicalDataInTheEditor:
    def _student(self):
        profile = StudentProfileFactory()
        StudentProfile.objects.filter(pk=profile.pk).update(allergies='Nuez', blood_type='O+', medical_notes='Asma leve')
        profile.refresh_from_db()
        return profile

    def test_alumnos_staff_get_the_mask_and_cannot_overwrite_it(self, api_client):
        profile = self._student()
        api_client.force_authenticate(_staff('alumnos'))
        url = f'/api/v1/accounts/admin/students/{profile.pk}/'
        empty = api_client.patch(url, {}, format='json')
        assert empty.status_code == 200
        assert empty.data['allergies'] == '●●●' and empty.data['medical_masked'] == 'role'

        r = api_client.patch(url, {'allergies': '●●●', 'medical_notes': 'otra cosa', 'group': 'B'}, format='json')
        assert r.status_code == 200 and r.data['group'] == 'B'
        profile.refresh_from_db()
        assert (profile.allergies, profile.medical_notes, profile.group) == ('Nuez', 'Asma leve', 'B')

    def test_an_admin_reads_and_edits_them(self, api_client, admin_user):
        profile = self._student()
        api_client.force_authenticate(admin_user)
        url = f'/api/v1/accounts/admin/students/{profile.pk}/'
        r = api_client.patch(url, {'allergies': 'Nuez y cacahuate'}, format='json')
        assert r.status_code == 200 and r.data['allergies'] == 'Nuez y cacahuate'
        # The mask is never stored, whoever sends it.
        api_client.patch(url, {'allergies': '●●●'}, format='json')
        profile.refresh_from_db()
        assert profile.allergies == 'Nuez y cacahuate'
