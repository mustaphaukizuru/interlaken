"""Console «Aviso de privacidad» (legal/notices.py): versions, drafts, publishing.

The privacy notice is legal evidence: consent rows and registrations keep
pointing at the exact version accepted. These tests pin that publishing a
new version never modifies them, that published text is read-only, that the
re-consent rule is the existing one, and that every change is audited.
All texts here are dummy data.
"""
import datetime as dt

import pytest
from django.contrib import admin
from django.core.cache import cache
from django.test import RequestFactory
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, UserFactory
from apps.core.models import AuditLog
from apps.legal.models import ConsentPurpose, ConsentRecord, PrivacyNoticeVersion
from apps.legal.services import needs_acceptance, record_consent

pytestmark = pytest.mark.django_db

BODY = (
    'Texto de prueba del responsable.\n\n'
    'PRIMER APARTADO DE PRUEBA PARA EL AVISO\n\nPárrafo uno.\n\n'
    'SEGUNDO APARTADO DE PRUEBA PARA EL AVISO\n\nPárrafo dos.\n\n'
    'TERCER APARTADO DE PRUEBA PARA EL AVISO\n\nPárrafo tres.'
)


@pytest.fixture(autouse=True)
def _cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def current():
    """A known current version (the one the migrations seeded is retired)."""
    PrivacyNoticeVersion.objects.filter(is_active=True).update(is_active=False)
    notice = PrivacyNoticeVersion(version='2026.8', title='Aviso de prueba', body=BODY,
                                  effective_date=dt.date(2026, 1, 15), is_active=True)
    notice.save()
    return notice


@pytest.fixture
def admin_api(api_client):
    api_client.force_authenticate(AdminFactory())
    return api_client


def _consents_snapshot():
    return list(ConsentRecord.objects.order_by('pk').values(
        'pk', 'guardian_id', 'student_id', 'notice_version_id', 'purpose', 'granted', 'captured_at', 'capture_context'))


def test_activation_marks_the_version_published(current):
    assert current.published_at is not None
    assert current.was_published


def test_list_shows_status_and_how_many_consents_each_version_holds(admin_api, current):
    parent = ParentFactory()
    record_consent(guardian=parent, purpose=ConsentPurpose.ACADEMIC_PROCESSING, granted=True)
    record_consent(guardian=parent, purpose=ConsentPurpose.PHOTOS_MEDIA, granted=True)
    draft = PrivacyNoticeVersion.objects.create(version='2027.1', title='Borrador', body='x', effective_date=dt.date(2027, 1, 1))
    r = admin_api.get(reverse('legal-admin-notices'))
    assert r.status_code == 200
    rows = {row['version']: row for row in r.json()['results']}
    assert r.json()['current_id'] == current.pk
    assert rows['2026.8']['status'] == 'vigente' and rows['2026.8']['consent_count'] == 2
    assert rows['2027.1']['status'] == 'borrador' and rows['2027.1']['consent_count'] == 0
    assert 'body' not in rows['2027.1']
    # The version the migrations seeded was public: it is «anterior», never a draft.
    seeded = [row for v, row in rows.items() if v not in ('2026.8', '2027.1')]
    assert seeded and all(row['status'] == 'anterior' for row in seeded)
    assert draft.pk in {row['id'] for row in r.json()['results']}


def test_new_version_is_a_draft_copied_from_the_current_one_and_audited(admin_api, current):
    r = admin_api.post(reverse('legal-admin-notices'), {}, format='json')
    assert r.status_code == 201, r.content
    data = r.json()
    assert data['status'] == 'borrador' and data['is_active'] is False
    assert data['body'] == BODY and data['title'] == current.title
    assert data['version'] != current.version
    entry = AuditLog.objects.get(object_type='legal.privacynoticeversion', object_id=str(data['id']), action='create')
    assert entry.context == 'legal.notice.draft'
    assert PrivacyNoticeVersion.current() == current  # nothing changes for families yet


def test_draft_is_editable_and_each_edit_is_audited(admin_api, current):
    draft_id = admin_api.post(reverse('legal-admin-notices'), {}, format='json').json()['id']
    url = reverse('legal-admin-notice', args=[draft_id])
    r = admin_api.patch(url, {'body': BODY + '\n\nCUARTO APARTADO DE PRUEBA PARA EL AVISO\n\nPárrafo cuatro.',
                              'version': '2026.10', 'title': 'Aviso nuevo de prueba'}, format='json')
    assert r.status_code == 200, r.content
    assert r.json()['version'] == '2026.10'
    entry = AuditLog.objects.filter(object_id=str(draft_id), action='update').latest('created_at')
    assert entry.changes['version'][1] == '2026.10'
    assert entry.changes['title'] == ['Aviso de prueba', 'Aviso nuevo de prueba']
    assert isinstance(entry.changes['body'][0], int)  # sizes, not a copy of the text


@pytest.mark.parametrize('payload, field', [
    ({'version': '2026.8'}, 'version'),       # taken
    ({'version': 'con espacios'}, 'version'),
    ({'title': '  '}, 'title'),
    ({'integral_notice_url': 'http://example.com'}, 'integral_notice_url'),
])
def test_draft_validation_errors_name_the_field(admin_api, current, payload, field):
    draft_id = admin_api.post(reverse('legal-admin-notices'), {}, format='json').json()['id']
    r = admin_api.patch(reverse('legal-admin-notice', args=[draft_id]), payload, format='json')
    assert r.status_code == 400 and field in r.json()


def test_published_versions_are_read_only_and_cannot_be_deleted(admin_api, current):
    url = reverse('legal-admin-notice', args=[current.pk])
    assert admin_api.patch(url, {'body': 'otro texto'}, format='json').status_code == 400
    assert admin_api.delete(url).status_code == 400
    current.refresh_from_db()
    assert current.body == BODY


def test_publish_keeps_every_consent_row_untouched_and_keeps_the_reconsent_rule(admin_api, current, client):
    accepted = ParentFactory()
    other = ParentFactory()
    record_consent(guardian=accepted, purpose=ConsentPurpose.ACADEMIC_PROCESSING, granted=True)
    record_consent(guardian=accepted, purpose=ConsentPurpose.PHOTOS_MEDIA, granted=False)
    record_consent(guardian=other, purpose=ConsentPurpose.CAFETERIA, granted=True)
    before = _consents_snapshot()
    assert needs_acceptance(accepted) is False

    draft_id = admin_api.post(reverse('legal-admin-notices'), {}, format='json').json()['id']
    r = admin_api.post(reverse('legal-admin-notice-publish', args=[draft_id]), {}, format='json')
    assert r.status_code == 200, r.content
    assert r.json()['status'] == 'vigente'

    # Consent rows: same rows, same values, still pointing at the version they accepted.
    assert _consents_snapshot() == before
    assert set(ConsentRecord.objects.values_list('notice_version_id', flat=True)) == {current.pk}

    new = PrivacyNoticeVersion.objects.get(pk=draft_id)
    current.refresh_from_db()
    assert PrivacyNoticeVersion.current() == new and new.is_active and new.published_at
    assert current.is_active is False and current.published_at  # retired, still frozen
    # Existing rule (services.needs_acceptance): the family is asked to accept the new version.
    assert needs_acceptance(accepted) is True
    # The public page serves the new version right away (cache dropped on save).
    assert client.get(reverse('legal-notice')).json()['version'] == new.version
    # Audited: the new version went live and the old one was retired.
    assert AuditLog.objects.filter(object_id=str(new.pk), context='legal.notice.publish').exists()
    assert AuditLog.objects.filter(object_id=str(current.pk), context='legal.notice.publish').exists()
    # Published text is frozen from now on, and it cannot be published twice.
    assert admin_api.patch(reverse('legal-admin-notice', args=[new.pk]), {'title': 'x'}, format='json').status_code == 400
    assert admin_api.post(reverse('legal-admin-notice-publish', args=[new.pk])).status_code == 400


def test_a_retired_version_nobody_accepted_stays_frozen(admin_api, current):
    draft_id = admin_api.post(reverse('legal-admin-notices'), {}, format='json').json()['id']
    admin_api.post(reverse('legal-admin-notice-publish', args=[draft_id]))
    current.refresh_from_db()
    assert not current.is_active and not current.consent_records.exists()
    assert admin_api.patch(reverse('legal-admin-notice', args=[current.pk]), {'title': 'x'}, format='json').status_code == 400
    rows = {row['id']: row for row in admin_api.get(reverse('legal-admin-notices')).json()['results']}
    assert rows[current.pk]['status'] == 'anterior'


def test_an_empty_draft_cannot_be_published(admin_api, current):
    draft_id = admin_api.post(reverse('legal-admin-notices'), {}, format='json').json()['id']
    r = admin_api.patch(reverse('legal-admin-notice', args=[draft_id]), {'body': '  '}, format='json')
    assert r.status_code == 400 and 'body' in r.json()
    PrivacyNoticeVersion.objects.filter(pk=draft_id).update(body='')
    r = admin_api.post(reverse('legal-admin-notice-publish', args=[draft_id]))
    assert r.status_code == 400 and 'body' in r.json()
    assert PrivacyNoticeVersion.current() == current


def test_discarding_a_draft_is_audited(admin_api, current):
    draft_id = admin_api.post(reverse('legal-admin-notices'), {}, format='json').json()['id']
    assert admin_api.delete(reverse('legal-admin-notice', args=[draft_id])).status_code == 204
    assert not PrivacyNoticeVersion.objects.filter(pk=draft_id).exists()
    assert AuditLog.objects.filter(object_id=str(draft_id), action='delete', context='legal.notice.draft').exists()


@pytest.mark.parametrize('make_user', [
    lambda: UserFactory(role='staff', staff_areas=['alumnos', 'accesos', 'admisiones', 'visitas', 'mensajes', 'comunicados', 'cafeteria']),
    lambda: ParentFactory(),
])
def test_only_admins_reach_the_console(api_client, current, make_user):
    api_client.force_authenticate(make_user())
    assert api_client.get(reverse('legal-admin-notices')).status_code == 403
    assert api_client.post(reverse('legal-admin-notices'), {}, format='json').status_code == 403
    assert api_client.post(reverse('legal-admin-notice-publish', args=[current.pk])).status_code == 403


def test_django_admin_keeps_published_versions_frozen(current):
    req = RequestFactory().get('/django-admin/')
    req.user = AdminFactory(is_superuser=True, is_staff=True)
    model_admin = admin.site._registry[PrivacyNoticeVersion]
    current.is_active = False
    current.save(update_fields=['is_active'])
    assert 'body' in model_admin.get_readonly_fields(req, current)
