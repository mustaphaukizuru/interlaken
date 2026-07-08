"""
Consent capture flows (IK-LEGAL B2): public notice, guardian consent record/read,
re-acceptance on version change, per-student photo flag.
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.legal.models import ConsentPurpose, PrivacyNoticeVersion
from apps.legal.services import photo_media_allowed

pytestmark = pytest.mark.django_db


@pytest.fixture
def notice(db):
    return PrivacyNoticeVersion.objects.create(
        version='2026.1', body='Aviso ADCE EDUCACIÓN A.C.',
        effective_date='2026-01-01', is_active=True,
    )


def test_public_notice_endpoint(api_client, notice):
    resp = api_client.get(reverse('legal-notice'))
    assert resp.status_code == 200
    assert resp.data['version'] == '2026.1'


def test_notice_404_when_none(api_client):
    assert api_client.get(reverse('legal-notice')).status_code == 404


def test_new_guardian_needs_acceptance(api_client, notice):
    api_client.force_authenticate(user=ParentFactory())
    resp = api_client.get(reverse('legal-consent'))
    assert resp.status_code == 200
    assert resp.data['needs_acceptance'] is True


def test_recording_core_consent_clears_needs_acceptance(api_client, notice):
    api_client.force_authenticate(user=ParentFactory())
    resp = api_client.post(reverse('legal-consent'), {
        'purposes': {ConsentPurpose.ACADEMIC_PROCESSING: True},
    }, format='json')
    assert resp.status_code == 201, resp.data
    assert resp.data['needs_acceptance'] is False


def test_new_notice_version_triggers_reacceptance(api_client, notice):
    parent = ParentFactory()
    api_client.force_authenticate(user=parent)
    api_client.post(reverse('legal-consent'),
                    {'purposes': {ConsentPurpose.ACADEMIC_PROCESSING: True}}, format='json')
    assert api_client.get(reverse('legal-consent')).data['needs_acceptance'] is False

    # A material new version → must re-accept.
    PrivacyNoticeVersion.objects.create(version='2026.2', body='v2',
                                        effective_date='2026-06-01', is_active=True)
    assert api_client.get(reverse('legal-consent')).data['needs_acceptance'] is True


def test_photo_consent_is_per_student_and_queryable(api_client, notice):
    parent = ParentFactory()
    kid = StudentProfileFactory(parents=[parent])
    api_client.force_authenticate(user=parent)
    resp = api_client.post(reverse('legal-consent'), {
        'purposes': {ConsentPurpose.PHOTOS_MEDIA: True}, 'student': kid.id,
    }, format='json')
    assert resp.status_code == 201, resp.data
    assert photo_media_allowed(kid) is True

    other = StudentProfileFactory(parents=[parent])
    assert photo_media_allowed(other) is False


def test_cannot_record_consent_for_another_familys_child(api_client, notice):
    api_client.force_authenticate(user=ParentFactory())
    someone_elses = StudentProfileFactory()
    resp = api_client.post(reverse('legal-consent'), {
        'purposes': {ConsentPurpose.PHOTOS_MEDIA: True}, 'student': someone_elses.id,
    }, format='json')
    assert resp.status_code == 404
