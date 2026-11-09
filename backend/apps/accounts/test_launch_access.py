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


class TestMedicalDataInTheAuditTrail:
    """The student's Historial (alumnos staff) showed «Alergias: — → Nuez»."""

    def _legacy_row(self, profile):
        from apps.core.models import AuditLog
        # As written before 2026-11-09: medical values stored in cleartext.
        return AuditLog.objects.create(
            action='update', object_type='accounts.studentprofile', object_id=str(profile.pk),
            changes={'allergies': ['', 'Nuez'], 'medical_notes': [None, 'Epilepsia'], 'group': ['A', 'B']},
            context='student.personal')

    def test_a_new_change_stores_who_and_when_but_not_the_value(self):
        from apps.core.models import AuditLog
        profile = StudentProfileFactory()
        profile.allergies = 'Cacahuate'
        profile.save()
        row = AuditLog.objects.filter(object_type='accounts.studentprofile', object_id=str(profile.pk),
                                      action='update').latest('pk')
        assert row.changes['allergies'] == ['', '[redacted]']

    def test_history_masks_rows_stored_before_the_fix(self, api_client):
        profile = StudentProfileFactory()
        self._legacy_row(profile)
        api_client.force_authenticate(_staff('alumnos'))
        r = api_client.get(reverse('admin-student-history', args=[profile.pk]))
        assert r.status_code == 200
        body = str(r.data)
        assert 'Nuez' not in body and 'Epilepsia' not in body
        legacy = next(e for e in r.data if 'group' in e['changes'])
        assert legacy['changes']['allergies'] == ['', '[redacted]']
        assert legacy['changes']['group'] == ['A', 'B']  # non-sensitive fields untouched

    def test_the_audit_viewer_and_its_export_mask_them_too(self, api_client, admin_user):
        profile = StudentProfileFactory()
        self._legacy_row(profile)
        api_client.force_authenticate(admin_user)
        listing = api_client.get(reverse('core-admin-audit'), {'object_type': 'accounts.studentprofile'})
        assert listing.status_code == 200 and 'Nuez' not in str(listing.data)
        export = api_client.get(reverse('core-admin-audit-export'), {'fmt': 'csv'})
        assert export.status_code == 200
        content = b''.join(export.streaming_content) if export.streaming else export.content
        assert b'Nuez' not in content and b'Epilepsia' not in content


class TestUndoArchive:
    """«Deshacer» right after Archivar used to leave the students in «Baja definitiva»."""

    def _bulk(self, client, action, ids, payload=None):
        return client.post(reverse('admin-student-bulk'), {
            'action': action, 'ids': ids, 'all_matching': False, 'payload': payload or {}, 'dry_run': False,
        }, format='json')

    def test_undo_puts_back_the_status_and_the_login(self, api_client, admin_user):
        active = StudentProfileFactory()
        leave = StudentProfileFactory()
        StudentProfile.objects.filter(pk=leave.pk).update(status=StudentProfile.Status.ON_LEAVE, is_active=False)
        api_client.force_authenticate(admin_user)

        assert self._bulk(api_client, 'archive', [active.pk, leave.pk]).status_code == 200
        r = self._bulk(api_client, 'restore', [active.pk, leave.pk], {'undo': True})

        assert r.status_code == 200
        active.refresh_from_db()
        leave.refresh_from_db()
        assert (active.status, active.is_active, active.user.is_active, active.user.archived_at) == (
            'active', True, True, None)
        assert (leave.status, leave.user.archived_at) == ('on_leave', None)

    def test_a_plain_restore_still_lands_in_baja_definitiva(self, api_client, admin_user):
        profile = StudentProfileFactory()
        api_client.force_authenticate(admin_user)
        self._bulk(api_client, 'archive', [profile.pk])

        self._bulk(api_client, 'restore', [profile.pk])

        profile.refresh_from_db()
        assert (profile.status, profile.user.is_active, profile.user.archived_at) == ('withdrawn', False, None)
