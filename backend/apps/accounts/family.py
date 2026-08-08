"""
Family notification recipients for a student.

School-email family login often uses the alumno's User (role=student). Loyverse
import usually self-links via ``student.parents``, but when that M2M row is
missing the student can still pay — notifications must still reach them.
"""
from __future__ import annotations

from collections.abc import Iterable

from .models import StudentProfile, User


def family_notify_recipients(student: StudentProfile) -> list[User]:
    """Users who should receive money/cafeteria notices for ``student``.

    Returns linked guardians (``student.parents``) plus the student's own User
    when that account is a school-email family login and is not already linked.
    Deduped by primary key, order: linked guardians first, then own user.
    """
    seen: dict[int, User] = {}
    for guardian in student.parents.all():
        seen[guardian.pk] = guardian

    owner = getattr(student, 'user', None)
    if (
        owner is not None
        and owner.pk not in seen
        and getattr(owner, 'role', None) == User.Role.STUDENT
    ):
        seen[owner.pk] = owner

    return list(seen.values())


def iter_family_notify_recipients(students: Iterable[StudentProfile]) -> list[User]:
    """Flatten unique recipients across many students (rarely needed)."""
    seen: dict[int, User] = {}
    for student in students:
        for user in family_notify_recipients(student):
            seen[user.pk] = user
    return list(seen.values())
