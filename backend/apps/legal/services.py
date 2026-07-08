"""
legal/services.py — capture and resolve consent.

`record_consent` appends an immutable ConsentRecord (always tied to the current
privacy-notice version). `has_consent` / `consent_state` resolve the current
state as "the latest record wins" per purpose.
"""
from .models import ConsentPurpose, ConsentRecord, PrivacyNoticeVersion


def record_consent(*, guardian, purpose, granted, student=None,
                   notice_version=None, context='', ip=None):
    """Append a consent (or revocation) record. Revocation = a new record."""
    notice = notice_version or PrivacyNoticeVersion.current()
    if notice is None:
        raise ValueError('No hay un Aviso de Privacidad vigente para registrar consentimiento.')
    return ConsentRecord.objects.create(
        guardian=guardian,
        student=student,
        notice_version=notice,
        purpose=purpose,
        granted=granted,
        capture_context=context,
        capture_ip=ip,
    )


def has_consent(guardian, purpose, student=None) -> bool:
    """True if the most recent record for this (guardian, purpose[, student]) grants it."""
    qs = ConsentRecord.objects.filter(guardian=guardian, purpose=purpose)
    qs = qs.filter(student=student) if student is not None else qs.filter(student__isnull=True)
    latest = qs.order_by('-captured_at').first()
    return bool(latest and latest.granted)


def consent_state(guardian, student=None) -> dict:
    """Map each purpose → current granted state for the guardian (optionally per student)."""
    return {p.value: has_consent(guardian, p.value, student) for p in ConsentPurpose}
