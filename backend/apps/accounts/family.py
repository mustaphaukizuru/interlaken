"""
Family notification recipients for a student.

Thin wrapper over ``apps.accounts.recipients.delivery_users`` (the single
source of truth for "who receives what is addressed to this student"):
active linked guardians first, then the student's own User when it is a
school-email family login. Callers that loop over this list must call
``notify(..., fanout=False)`` so guardians are not notified twice.
"""
from __future__ import annotations

from collections.abc import Iterable

from .models import StudentProfile, User
from .recipients import delivery_users


def family_notify_recipients(student: StudentProfile) -> list[User]:
    """Guardians (active) first, then the student's own school-email User."""
    owner = getattr(student, 'user', None)
    if owner is None:
        return [g for g in student.parents.filter(is_active=True).order_by('pk')]
    users = delivery_users(owner)
    guardians = [u for u in users if u.pk != owner.pk]
    own = [u for u in users if u.pk == owner.pk and getattr(u, 'role', None) == User.Role.STUDENT]
    return guardians + own


def iter_family_notify_recipients(students: Iterable[StudentProfile]) -> list[User]:
    """Flatten unique recipients across many students (rarely needed)."""
    seen: dict[int, User] = {}
    for student in students:
        for user in family_notify_recipients(student):
            seen[user.pk] = user
    return list(seen.values())
