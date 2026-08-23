"""
Medical data access policy (BACKLOG P5-6, LFPDPPP "datos sensibles").

Fields: StudentProfile.blood_type / allergies / medical_notes (encrypted at rest).

Who may read them
* admin: always (the school holds them to act in an emergency).
* the student's guardian: only after granting the MEDICAL_DATA consent for
  that student (or household-wide); otherwise the fields are masked and the
  API says why, so the portal can offer the consent switch.
* staff and students: never (rosters, analytics, exports).

Exports and audit logs never carry the values: `mask_medical()` replaces them
with MASK, and AuditLog already records '[set]' for these fields.
"""
from __future__ import annotations

from .serializers import MEDICAL_FIELDS

MASK = '●●●'
MASK_REASON_CONSENT = 'consent_required'
MASK_REASON_ROLE = 'role'


def medical_access(user, profile) -> tuple[bool, str]:
    """(allowed, reason). reason is '' when allowed."""
    role = getattr(user, 'role', None)
    if role == 'admin':
        return True, ''
    if role == 'parent' and profile.parents.filter(pk=user.pk).exists():
        from apps.legal.models import ConsentPurpose
        from apps.legal.services import has_consent
        if has_consent(user, ConsentPurpose.MEDICAL_DATA, student=profile) or has_consent(user, ConsentPurpose.MEDICAL_DATA):
            return True, ''
        return False, MASK_REASON_CONSENT
    return False, MASK_REASON_ROLE


def mask_medical(data: dict) -> dict:
    """Replace medical values with MASK (for exports / downgraded responses)."""
    for f in MEDICAL_FIELDS:
        if f in data and data[f]:
            data[f] = MASK
    return data
