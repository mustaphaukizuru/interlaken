"""
Medical data access policy (BACKLOG P5-6, LFPDPPP "datos sensibles").

Fields: StudentProfile.blood_type / allergies / medical_notes (encrypted at rest).

Who may read them
* admin: always (the school holds them to act in an emergency).
* the student's guardian: only after granting the MEDICAL_DATA consent for
  that student (or household-wide); otherwise the fields are masked and the
  API says why, so the portal can offer the consent switch. A guardian of one
  sibling of a ``Family`` counts as the guardian of every sibling (school
  decision, 2026-11-13: linked logins see the sibling's file like their own).
* staff and students: never (rosters, analytics, exports).
* the cafetería console: the ``allergies`` field only, and only when the
  school turned on «La cafetería ve las alergias» (Ajustes) AND the family
  authorised health data (``family_authorised_ids``: the guardian rule
  above). See ``apps.cafeteria.serializers.console_allergies``.

Exports and audit logs never carry the values: `mask_medical()` replaces them
with MASK, and AuditLog already records '[set]' for these fields.
"""
from __future__ import annotations

from django.db.models import Q

from .family import can_access_student
from .serializers import MEDICAL_FIELDS

MASK = '●●●'
MASK_REASON_CONSENT = 'consent_required'
MASK_REASON_ROLE = 'role'


def medical_access(user, profile) -> tuple[bool, str]:
    """(allowed, reason). reason is '' when allowed."""
    role = getattr(user, 'role', None)
    if role == 'admin':
        return True, ''
    if role == 'parent' and can_access_student(user, profile):
        from apps.legal.models import ConsentPurpose
        from apps.legal.services import has_consent
        if has_consent(user, ConsentPurpose.MEDICAL_DATA, student=profile) or has_consent(user, ConsentPurpose.MEDICAL_DATA):
            return True, ''
        return False, MASK_REASON_CONSENT
    return False, MASK_REASON_ROLE


def family_authorised_ids(students) -> set[int]:
    """The pks of ``students`` whose family authorised health data.

    The same rule ``medical_access`` applies to a guardian, asked of the whole
    family: True when at least one login it lets in as a guardian (role
    ``parent``, reaching the student through ``family_students``: linked on
    ``student.parents``, the student's own login, or a guardian of a sibling
    in the same ``Family``) holds a granted MEDICAL_DATA consent for that
    student or household-wide. Latest record wins per (guardian, student or
    household), so a revocation counts. A fixed number of queries for a whole
    page of students (``test_family_authorised_ids`` checks it agrees with
    ``medical_access``).
    """
    from apps.legal.models import ConsentPurpose, ConsentRecord

    from .models import StudentProfile, User

    students = [s for s in students if getattr(s, 'pk', None)]
    if not students:
        return set()
    ids = {s.pk for s in students}
    family_ids = {s.family_id for s in students if s.family_id}
    # Every student whose guardians count: the ones asked about and their siblings.
    members = list(StudentProfile.objects.filter(Q(pk__in=ids) | Q(family_id__in=family_ids))
                   .values_list('pk', 'family_id', 'user_id'))
    member_ids = [pk for pk, _fam, _uid in members]
    guardians_of: dict[int, set[int]] = {pk: set() for pk in member_ids}
    for sid, uid in (StudentProfile.parents.through.objects
                     .filter(studentprofile_id__in=member_ids, user__role=User.Role.PARENT)
                     .values_list('studentprofile_id', 'user_id')):
        guardians_of[sid].add(uid)
    own_logins = {uid for _pk, _fam, uid in members if uid}
    parent_logins = set(User.objects.filter(pk__in=own_logins, role=User.Role.PARENT)
                        .values_list('pk', flat=True)) if own_logins else set()
    for pk, _fam, uid in members:
        if uid in parent_logins:
            guardians_of[pk].add(uid)
    by_family: dict[int, set[int]] = {}
    for pk, fam, _uid in members:
        if fam:
            by_family.setdefault(fam, set()).update(guardians_of[pk])

    family_guardians = {
        s.pk: guardians_of.get(s.pk, set()) | (by_family.get(s.family_id, set()) if s.family_id else set())
        for s in students
    }
    everyone = set().union(*family_guardians.values())
    if not everyone:
        return set()
    latest: dict[tuple[int, int | None], bool] = {}
    for gid, sid, granted in (ConsentRecord.objects
                              .filter(purpose=ConsentPurpose.MEDICAL_DATA, guardian_id__in=everyone)
                              .filter(Q(student_id__in=ids) | Q(student__isnull=True))
                              .order_by('captured_at', 'pk')
                              .values_list('guardian_id', 'student_id', 'granted')):
        latest[(gid, sid)] = granted
    return {
        pk for pk, guardians in family_guardians.items()
        if any(latest.get((g, pk)) or latest.get((g, None)) for g in guardians)
    }


def mask_medical(data: dict) -> dict:
    """Replace medical values with MASK (for exports / downgraded responses)."""
    for f in MEDICAL_FIELDS:
        if f in data and data[f]:
            data[f] = MASK
    return data
