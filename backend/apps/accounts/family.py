"""
Who a family login may see, and who a student's notices reach.

``family_students(user)`` is the ONE rule for "the children of this login" in
the family portal (students, dashboard, cafetería, payments, consents, ARCO
export). A login reaches a student when:

* it is linked on ``student.parents`` (a guardian, or the student's own
  school-email login, which the importers link as its own guardian);
* it IS the student's own login (defence when that M2M row is missing);
* or one of the students above belongs to a ``Family``: then every student of
  that family (siblings the school grouped, 2026-11-13).

``test_family_scope_contract`` fails if a view goes back to filtering
``parents=user`` by hand.

``family_notify_recipients`` (who gets a child's alert by email, push and in
the bell) is unchanged by families: families read each child's school mailbox,
so a sibling's login copy by email would only repeat every message. Instead
``family_alert_logins`` names the OTHER accounts of the child's family, which
get an in-app copy only (``apps.portal.services.copy_to_family``): whichever
login a parent uses, the bell shows every child's alerts.
"""
from __future__ import annotations

from collections.abc import Iterable

from django.db.models import Q, QuerySet

from .models import StudentProfile, User
from .recipients import delivery_users


def family_students(user) -> QuerySet[StudentProfile]:
    """Every student ``user`` sees and acts for in the family portal.

    Admin and staff scoping is the caller's business (they see the roster
    through their own views); for them this answers "their own children",
    usually none. Ids are resolved in subqueries, so the result has no
    duplicate rows and needs no DISTINCT.
    """
    if user is None or not getattr(user, 'is_authenticated', False) or not getattr(user, 'pk', None):
        return StudentProfile.objects.none()
    direct = Q(parents=user) | Q(user_id=user.pk)
    direct_ids = StudentProfile.objects.filter(direct).values('pk')
    family_ids = StudentProfile.objects.filter(direct, family__isnull=False).values('family_id')
    return StudentProfile.objects.filter(Q(pk__in=direct_ids) | Q(family_id__in=family_ids))


def own_student_ids(user) -> set[int]:
    """The students ``user`` reaches WITHOUT a family: its own school login, or
    a guardian link. A family can take a sibling out of its account (Mis hijos
    → «Quitar»), never one of these."""
    if user is None or not getattr(user, 'is_authenticated', False) or not getattr(user, 'pk', None):
        return set()
    return set(StudentProfile.objects.filter(Q(parents=user) | Q(user_id=user.pk))
               .values_list('pk', flat=True))


def can_access_student(user, student: StudentProfile | int) -> bool:
    """True when ``student`` is one of ``family_students(user)``."""
    pk = student if isinstance(student, int) else getattr(student, 'pk', None)
    if pk is None:
        return False
    return family_students(user).filter(pk=pk).exists()


def family_notify_recipients(student: StudentProfile) -> list[User]:
    """Guardians (active) first, then the student's own school-email User.

    Thin wrapper over ``apps.accounts.recipients.delivery_users`` (the single
    source of truth for "who receives what is addressed to this student").
    Callers that loop over this list must call ``notify(..., fanout=False)`` so
    guardians are not notified twice.
    """
    owner = getattr(student, 'user', None)
    if owner is None:
        return [g for g in student.parents.filter(is_active=True).order_by('pk')]
    users = delivery_users(owner)
    guardians = [u for u in users if u.pk != owner.pk]
    own = [u for u in users if u.pk == owner.pk and getattr(u, 'role', None) == User.Role.STUDENT]
    return guardians + own


def family_alert_logins(student: StudentProfile) -> list[User]:
    """Active accounts of ``student``'s Family that do not already receive its
    notices: each sibling's own school-email login and each sibling's guardians.

    Empty when the student has no family. Order: by pk, for stable fan-out.
    """
    if not getattr(student, 'family_id', None):
        return []
    already = {u.pk for u in family_notify_recipients(student)}
    out: dict[int, User] = {}
    siblings = (StudentProfile.objects.filter(family_id=student.family_id)
                .exclude(pk=student.pk).select_related('user').prefetch_related('parents'))
    for sib in siblings:
        own = sib.user
        if own.is_active and own.role == User.Role.STUDENT:
            out[own.pk] = own
        for guardian in sib.parents.all():
            if guardian.is_active:
                out[guardian.pk] = guardian
    return [out[pk] for pk in sorted(out) if pk not in already]


def iter_family_notify_recipients(students: Iterable[StudentProfile]) -> list[User]:
    """Flatten unique recipients across many students (rarely needed)."""
    seen: dict[int, User] = {}
    for student in students:
        for user in family_notify_recipients(student):
            seen[user.pk] = user
    return list(seen.values())
