"""P1-G4: standalone documents page — list with status, approve/reject with note, documents link."""
import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.admissions.models import RegistrationDocument
from apps.admissions.test_registration_admin import _reg
from apps.admissions.tokens import issue_session

pytestmark = pytest.mark.django_db


def _doc(reg, dt=RegistrationDocument.DocType.BIRTH_CERT):
    return RegistrationDocument.objects.create(
        registration=reg, doc_type=dt,
        file=SimpleUploadedFile('acta.pdf', b'%PDF-1.4', content_type='application/pdf'),
        filename='acta.pdf', file_size=8)


def test_applicant_lists_own_documents_with_status(api_client):
    reg = _reg()
    _doc(reg)
    token = issue_session(reg)
    assert api_client.get(reverse('register-docs-list', args=[reg.id])).status_code == 401
    resp = api_client.get(reverse('register-docs-list', args=[reg.id]), HTTP_X_SESSION_TOKEN=token)
    assert resp.status_code == 200
    assert resp.data['documents'][0]['status'] == 'pending'
    assert {r['code'] for r in resp.data['required']} >= {'birth_cert', 'curp_doc', 'photo'}


def test_reject_with_note_emails_family_and_syncs_is_verified(api_client):
    reg = _reg()
    doc = _doc(reg)
    api_client.force_authenticate(AdminFactory())
    mail.outbox.clear()
    resp = api_client.patch(reverse('document-verify', args=[doc.id]),
                            {'status': 'rejected', 'review_note': 'Ilegible'}, format='json')
    assert resp.status_code == 200
    doc.refresh_from_db()
    assert doc.status == 'rejected' and doc.is_verified is False and doc.review_note == 'Ilegible'
    assert mail.outbox and 'Ilegible' in mail.outbox[-1].body
    ok = api_client.patch(reverse('document-verify', args=[doc.id]), {'status': 'approved'}, format='json')
    assert ok.status_code == 200
    doc.refresh_from_db()
    assert doc.is_verified is True


def test_documents_link_issues_invite_and_lists_missing(api_client):
    reg = _reg()
    api_client.force_authenticate(AdminFactory())
    mail.outbox.clear()
    resp = api_client.post(reverse('register-docs-link', args=[reg.id]), {}, format='json')
    assert resp.status_code == 200
    assert '/inscripcion/documentos?rid=' in resp.data['url'] and 'Acta de Nacimiento' in resp.data['missing']
    assert mail.outbox[-1].to == [reg.parent1_email] and resp.data['url'] in mail.outbox[-1].body
