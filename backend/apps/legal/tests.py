"""
Consent data model (IK-LEGAL B1): current notice, immutability, latest-wins
resolution, per-student medical consent, and audit-log wiring.
"""
import pytest
from django.db import IntegrityError

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.core.models import AuditLog
from apps.legal.models import ConsentPurpose, ConsentRecord, PrivacyNoticeVersion
from apps.legal.services import consent_state, has_consent, record_consent

pytestmark = pytest.mark.django_db


@pytest.fixture
def notice(db):
    return PrivacyNoticeVersion.objects.create(
        version='2026.1', body='Aviso ADCE EDUCACIÓN A.C.',
        effective_date='2026-01-01', is_active=True,
    )


def test_current_returns_active_notice(notice):
    assert PrivacyNoticeVersion.current() == notice


def test_grant_then_revoke_latest_wins(notice):
    parent = ParentFactory()
    record_consent(guardian=parent, purpose=ConsentPurpose.CAFETERIA, granted=True)
    assert has_consent(parent, ConsentPurpose.CAFETERIA) is True

    # Revocation is a NEW record, not an edit.
    record_consent(guardian=parent, purpose=ConsentPurpose.CAFETERIA, granted=False)
    assert has_consent(parent, ConsentPurpose.CAFETERIA) is False
    assert ConsentRecord.objects.filter(
        guardian=parent, purpose=ConsentPurpose.CAFETERIA).count() == 2


def test_consent_record_is_immutable(notice):
    parent = ParentFactory()
    rec = record_consent(guardian=parent, purpose=ConsentPurpose.PHOTOS_MEDIA, granted=True)

    rec.granted = False
    with pytest.raises(IntegrityError):
        rec.save()
    with pytest.raises(IntegrityError):
        rec.delete()
    with pytest.raises(IntegrityError):
        ConsentRecord.objects.all().update(granted=False)
    with pytest.raises(IntegrityError):
        ConsentRecord.objects.all().delete()


def test_medical_consent_is_per_student(notice):
    parent = ParentFactory()
    kid_a = StudentProfileFactory(parents=[parent])
    kid_b = StudentProfileFactory(parents=[parent])
    record_consent(guardian=parent, purpose=ConsentPurpose.MEDICAL_DATA,
                   granted=True, student=kid_a)
    assert has_consent(parent, ConsentPurpose.MEDICAL_DATA, student=kid_a) is True
    assert has_consent(parent, ConsentPurpose.MEDICAL_DATA, student=kid_b) is False


def test_consent_creation_is_audited(notice):
    parent = ParentFactory()
    rec = record_consent(guardian=parent, purpose=ConsentPurpose.ACADEMIC_PROCESSING,
                         granted=True)
    entry = AuditLog.objects.filter(
        object_type='legal.consentrecord', object_id=str(rec.pk)).latest('created_at')
    assert entry.action == 'create'
    assert entry.context == 'legal.consent'


def test_record_without_active_notice_raises():
    parent = ParentFactory()
    with pytest.raises(ValueError):
        record_consent(guardian=parent, purpose=ConsentPurpose.CAFETERIA, granted=True)


def test_consent_state_maps_all_purposes(notice):
    parent = ParentFactory()
    record_consent(guardian=parent, purpose=ConsentPurpose.COMMUNICATIONS_MARKETING,
                   granted=True)
    state = consent_state(parent)
    assert state[ConsentPurpose.COMMUNICATIONS_MARKETING] is True
    assert state[ConsentPurpose.CAFETERIA] is False
    assert set(state.keys()) == {p.value for p in ConsentPurpose}
