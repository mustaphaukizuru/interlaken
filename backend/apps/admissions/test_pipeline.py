import pytest
from django.core import mail
from django.core.files.base import ContentFile
from django.urls import reverse

from apps.accounts.models import StudentProfile, User
from apps.admissions.models import Registration, RegistrationDocument
from apps.content.models import SiteSettings

BASE = {
    'child_first_name': 'Ana', 'child_last_name': 'López', 'child_dob': '2018-05-01', 'level': 'primaria', 'grade_applying': '1° Primaria',
    'parent1_name': 'María López', 'parent1_email': 'maria@test.mx', 'parent1_phone': '5512345678',
    'parent2_name': 'Juan Pérez', 'parent2_email': 'juan@test.mx', 'parent2_phone': '5587654321',
    'emergency_name': 'Tía', 'emergency_phone': '5500000000',
}


@pytest.fixture
def reg(db):
    r = Registration.objects.create(**BASE, status=Registration.Status.SUBMITTED, allergies='Nuez')
    d = RegistrationDocument(registration=r, doc_type=RegistrationDocument.DocType.BIRTH_CERT, filename='acta.pdf', is_verified=True)
    d.file.save('acta.pdf', ContentFile(b'x'), save=False)
    d.save()
    return r


@pytest.mark.django_db
def test_pipeline_columns_and_checklist(admin_client, reg, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    r = admin_client.get(reverse('admissions-pipeline'))
    assert r.status_code == 200
    col = next(c for c in r.data['columns'] if c['status'] == 'submitted')
    card = col['cards'][0]
    assert card['child_name'] == 'Ana López' and card['docs_verified'] == 1 and card['docs_required'] == 6
    assert 'CURP' in card['missing'] and 'Acta de Nacimiento' not in card['missing']
    assert '{missing_list}' in r.data['templates']['missing_docs']


@pytest.mark.django_db
def test_request_docs_uses_editable_template(admin_client, reg, settings):
    settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
    bad = admin_client.patch(reverse('admissions-templates'), {'missing_docs': 'Hola {nope}'}, format='json')
    assert bad.status_code == 400
    ok = admin_client.patch(reverse('admissions-templates'), {'missing_docs': 'Estimado {parent_name}, falta:\n{missing_list}\nSuba en {upload_url}'}, format='json')
    assert ok.status_code == 200 and SiteSettings.load().tpl_missing_docs.startswith('Estimado')
    r = admin_client.post(reverse('register-request-docs', args=[reg.pk]), {}, format='json')
    assert r.status_code == 200 and r.data['sent_to'] == 'maria@test.mx'
    body = mail.outbox[-1].body
    assert body.startswith('Estimado María López') and '• CURP' in body and f'token={reg.access_token}' in body


@pytest.mark.django_db
def test_convert_creates_student_and_family(admin_client, reg, parent_user):
    url = reverse('register-convert', args=[reg.pk])
    assert admin_client.post(url, {}, format='json').status_code == 400  # still submitted
    reg.status = Registration.Status.APPROVED
    reg.save()
    # parent2 already has an account → linked, no password generated
    parent_user.email = 'juan@test.mx'
    parent_user.save()
    r = admin_client.post(url, {'group': 'A'}, format='json')
    assert r.status_code == 201, r.data
    sp = StudentProfile.objects.get(pk=r.data['student'])
    assert sp.grade == '1° Primaria' and sp.group == 'A' and sp.allergies == 'Nuez' and sp.registration_id == reg.pk
    assert sp.user.role == 'student' and sp.user.email.startswith(sp.student_id.lower())
    guardians = set(sp.parents.values_list('email', flat=True))
    assert {'maria@test.mx', 'juan@test.mx'} <= guardians
    maria = User.objects.get(email='maria@test.mx')
    cred = {c['email']: c for c in r.data['credentials']}
    assert cred['maria@test.mx']['password'] and maria.check_password(cred['maria@test.mx']['password'])
    assert cred['juan@test.mx']['password'] is None
    reg.refresh_from_db()
    assert reg.status == 'complete'
    again = admin_client.post(url, {}, format='json')
    assert again.status_code == 200 and again.data['already'] is True
