"""
Admin-side admissions from the React console:

  * #2 invite-only enrollment — admin issues a pre-filled enrollment invite from a
    pre-registration (idempotent, advances the pre-reg, returns a shareable link).
  * #1 registration review — admin lists registrations, approves/rejects them, and
    verifies uploaded documents. All actions are admin-only.
"""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.admissions.models import PreRegistration, Registration, RegistrationDocument


def _pre(**over):
    data = dict(
        child_first_name='Ana', child_last_name='Pérez', child_dob='2012-03-04',
        level=PreRegistration.Level.PRIMARY, grade_applying='Primaria 2°',
        parent_name='Roberto Pérez', parent_email='rp@test.mx',
        parent_phone='5551234567', status=PreRegistration.Status.PENDING)
    data.update(over)
    return PreRegistration.objects.create(**data)


def _reg(**over):
    data = dict(
        child_first_name='Ana', child_last_name='Pérez', child_dob='2012-03-04',
        level='primaria', grade_applying='Primaria 2°',
        parent1_name='Roberto Pérez', parent1_email='rp@test.mx',
        parent1_phone='5551234567')
    data.update(over)
    return Registration.objects.create(**data)


@pytest.mark.django_db
class TestPreRegistrationInvite:
    """#2 — admin issues an enrollment invite from a pre-registration."""

    def test_admin_invite_creates_prefilled_draft_and_link(self, api_client):
        pre = _pre()
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(reverse('pre-register-invite', args=[pre.id]))
        assert resp.status_code == 201, resp.content
        body = resp.json()
        # A shareable, token-bearing link back to the enrollment wizard.
        assert body['invite_url'].endswith(
            f"/inscripcion?rid={body['registration_id']}&token={body['invite_token']}")
        reg = Registration.objects.get(id=body['registration_id'])
        # Draft pre-filled from the pre-registration.
        assert reg.pre_registration_id == pre.id
        assert reg.status == Registration.Status.DRAFT
        assert reg.child_first_name == 'Ana' and reg.grade_applying == 'Primaria 2°'
        assert reg.parent1_email == 'rp@test.mx'
        # Issuing the invite advances the pipeline out of "pending".
        pre.refresh_from_db()
        assert pre.status == PreRegistration.Status.CONTACTED

    def test_invite_is_idempotent(self, api_client):
        """Re-inviting refreshes the token on the SAME draft, never duplicates."""
        pre = _pre()
        api_client.force_authenticate(AdminFactory())
        first = api_client.post(reverse('pre-register-invite', args=[pre.id])).json()
        second = api_client.post(reverse('pre-register-invite', args=[pre.id])).json()
        assert first['registration_id'] == second['registration_id']
        assert first['invite_token'] != second['invite_token']
        assert pre.registrations.count() == 1

    def test_non_admin_cannot_invite(self, api_client):
        pre = _pre()
        api_client.force_authenticate(ParentFactory())
        resp = api_client.post(reverse('pre-register-invite', args=[pre.id]))
        assert resp.status_code == 403
        assert pre.registrations.count() == 0


@pytest.mark.django_db
class TestRegistrationAdminReview:
    """#1 — admin reviews registrations from the console."""

    def test_admin_lists_registrations(self, api_client):
        _reg()
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(reverse('register-create'))
        assert resp.status_code == 200, resp.content
        rows = resp.json()['results']
        assert rows[0]['child_name'] == 'Ana Pérez'
        assert 'doc_count' in rows[0]
        # The list must NOT leak encrypted medical fields.
        assert 'medical_notes' not in rows[0]

    def test_non_admin_cannot_list_registrations(self, api_client):
        _reg()
        api_client.force_authenticate(ParentFactory())
        assert api_client.get(reverse('register-create')).status_code == 403

    def test_admin_approves_registration(self, api_client):
        reg = _reg(status=Registration.Status.SUBMITTED)
        api_client.force_authenticate(AdminFactory())
        resp = api_client.patch(reverse('register-status', args=[reg.id]),
                                {'status': 'approved', 'admin_notes': 'OK'}, format='json')
        assert resp.status_code == 200, resp.content
        reg.refresh_from_db()
        assert reg.status == Registration.Status.APPROVED
        assert reg.admin_notes == 'OK'

    def test_non_admin_cannot_change_status(self, api_client):
        reg = _reg(status=Registration.Status.SUBMITTED)
        resp = api_client.patch(reverse('register-status', args=[reg.id]),
                                {'status': 'approved'}, format='json')
        assert resp.status_code in (401, 403)
        reg.refresh_from_db()
        assert reg.status == Registration.Status.SUBMITTED

    def test_admin_verifies_document(self, api_client):
        reg = _reg()
        doc = RegistrationDocument.objects.create(
            registration=reg, doc_type=RegistrationDocument.DocType.BIRTH_CERT,
            file=SimpleUploadedFile('acta.pdf', b'%PDF-1.4', content_type='application/pdf'),
            filename='acta.pdf', file_size=8)
        api_client.force_authenticate(AdminFactory())
        resp = api_client.patch(reverse('document-verify', args=[doc.id]),
                                {'is_verified': True}, format='json')
        assert resp.status_code == 200, resp.content
        doc.refresh_from_db()
        assert doc.is_verified is True

    def test_non_admin_cannot_verify_document(self, api_client):
        reg = _reg()
        doc = RegistrationDocument.objects.create(
            registration=reg, doc_type=RegistrationDocument.DocType.BIRTH_CERT,
            file=SimpleUploadedFile('acta.pdf', b'%PDF-1.4', content_type='application/pdf'),
            filename='acta.pdf', file_size=8)
        api_client.force_authenticate(ParentFactory())
        resp = api_client.patch(reverse('document-verify', args=[doc.id]),
                                {'is_verified': True}, format='json')
        assert resp.status_code == 403
        doc.refresh_from_db()
        assert doc.is_verified is False


@pytest.mark.django_db
class TestDocumentUploadValidation:
    """Upload input-validation hardening (pre-go-live review): size cap +
    doc_type + extension. Staff JWT bypasses authorize_registration."""

    def _upload(self, api_client, reg, *, name='acta.pdf', content=b'%PDF-1.4 data',
                doc_type=RegistrationDocument.DocType.BIRTH_CERT):
        api_client.force_authenticate(AdminFactory())
        f = SimpleUploadedFile(name, content, content_type='application/pdf')
        return api_client.post(reverse('register-docs', args=[reg.id]),
                               {'file': f, 'doc_type': doc_type}, format='multipart')

    def test_valid_upload_succeeds(self, api_client):
        reg = _reg()
        resp = self._upload(api_client, reg)
        assert resp.status_code == 201, resp.content
        assert RegistrationDocument.objects.filter(registration=reg).count() == 1

    def test_oversized_file_is_rejected(self, api_client, settings):
        settings.MAX_DOCUMENT_UPLOAD_SIZE = 1024  # 1 KB cap for the test
        reg = _reg()
        resp = self._upload(api_client, reg, content=b'x' * 4096)
        assert resp.status_code == 400
        assert not RegistrationDocument.objects.filter(registration=reg).exists()

    def test_invalid_doc_type_is_rejected(self, api_client):
        reg = _reg()
        resp = self._upload(api_client, reg, doc_type='not_a_real_type')
        assert resp.status_code == 400
        assert not RegistrationDocument.objects.filter(registration=reg).exists()

    def test_disallowed_extension_is_rejected(self, api_client):
        reg = _reg()
        resp = self._upload(api_client, reg, name='evil.svg', content=b'<svg/>')
        assert resp.status_code == 400
        assert not RegistrationDocument.objects.filter(registration=reg).exists()

    def test_reupload_same_doc_type_replaces_previous(self, api_client):
        reg = _reg()
        first = self._upload(api_client, reg, name='acta-v1.pdf', content=b'%PDF-1.4 v1')
        assert first.status_code == 201, first.content
        second = self._upload(api_client, reg, name='acta-v2.pdf', content=b'%PDF-1.4 v2')
        assert second.status_code == 201, second.content
        docs = list(RegistrationDocument.objects.filter(
            registration=reg, doc_type=RegistrationDocument.DocType.BIRTH_CERT,
        ))
        assert len(docs) == 1
        assert docs[0].filename == 'acta-v2.pdf'


@pytest.mark.django_db
class TestDocumentDownload:
    """Authenticated download — prod serves no /media/, so this view IS the
    download path; it must be authorized (staff or owning applicant) and must
    not leak document existence to anonymous callers."""

    def _doc(self, reg, content=b'%PDF-1.4 secret'):
        return RegistrationDocument.objects.create(
            registration=reg, doc_type=RegistrationDocument.DocType.BIRTH_CERT,
            file=SimpleUploadedFile('acta.pdf', content, content_type='application/pdf'),
            filename='acta.pdf', file_size=len(content))

    def test_staff_can_download_as_attachment(self, api_client):
        doc = self._doc(_reg())
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(reverse('document-download', args=[doc.id]))
        assert resp.status_code == 200
        assert b''.join(resp.streaming_content) == b'%PDF-1.4 secret'
        assert 'attachment' in resp['Content-Disposition']

    def test_owning_applicant_can_download_with_session_token(self, api_client):
        from apps.admissions.tokens import issue_session
        reg = _reg()
        doc = self._doc(reg)
        resp = api_client.get(reverse('document-download', args=[doc.id]),
                              HTTP_X_SESSION_TOKEN=issue_session(reg))
        assert resp.status_code == 200

    def test_anonymous_without_token_is_rejected(self, api_client):
        doc = self._doc(_reg())
        resp = api_client.get(reverse('document-download', args=[doc.id]))
        assert resp.status_code == 401

    def test_session_token_for_another_registration_is_rejected(self, api_client):
        from apps.admissions.tokens import issue_session
        reg_a, reg_b = _reg(), _reg(child_first_name='Otro')
        doc_b = self._doc(reg_b)
        resp = api_client.get(reverse('document-download', args=[doc_b.id]),
                              HTTP_X_SESSION_TOKEN=issue_session(reg_a))
        assert resp.status_code == 401

    def test_missing_doc_is_uniform_401_for_anon(self, api_client):
        # Anti-enumeration: a missing document is a 401 (same as unauthorized),
        # not a 404, so anon can't probe which document ids exist.
        resp = api_client.get(reverse('document-download', args=[999999]))
        assert resp.status_code == 401

    def test_missing_doc_is_404_for_staff(self, api_client):
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(reverse('document-download', args=[999999]))
        assert resp.status_code == 404
