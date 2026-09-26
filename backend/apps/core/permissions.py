"""
core/permissions.py — shared DRF permission classes.

``IsAdmin`` used to be copy-pasted into five modules (accounts.exports,
accounts.import_students, admissions, bookings, cafeteria); this is the only
definition now. Data Ops Phase 10 moved the last local duplicates here too,
each with its exact original rule (no behaviour change):

* ``IsParentOrAdmin`` (was in ``apps/cafeteria/views.py``): family portal actors.
* ``IsStaffOrAdmin`` (was in ``apps/portal/analytics.py``): role staff/admin, or
  the Django ``is_staff`` flag.
* ``is_admin_or_django_staff`` (was ``_is_staff`` in ``apps/admissions/views.py``):
  role admin, or the Django ``is_staff`` flag (a ``staff`` role without the flag
  does not count); it lets school users past the applicant token gate.

Staff-role granularity (BACKLOG P1-H1) will extend this file.
"""

from rest_framework import permissions

ADMIN = "admin"
STAFF = "staff"
PARENT = "parent"
STUDENT = "student"


def _authenticated(user) -> bool:
    return bool(user and user.is_authenticated)


def _role(user):
    return getattr(user, "role", None)


def is_admin_or_django_staff(user) -> bool:
    """Authenticated with role ``admin`` or the Django ``is_staff`` flag."""
    return _authenticated(user) and bool(getattr(user, "is_staff", False) or _role(user) == ADMIN)


class IsAdminOrStaff(permissions.BasePermission):
    """Authenticated ``admin`` or ``staff`` (content editors, BACKLOG P3-10)."""

    def has_permission(self, request, view):
        user = request.user
        return _authenticated(user) and _role(user) in (ADMIN, STAFF)


class IsStaffOrAdmin(permissions.BasePermission):
    """School personnel: role staff/admin (the Django ``is_staff`` flag also counts)."""

    def has_permission(self, request, view):
        user = request.user
        return _authenticated(user) and bool(
            _role(user) in (ADMIN, STAFF) or getattr(user, "is_staff", False)
        )


class IsAdmin(permissions.BasePermission):
    """Authenticated users with ``role == 'admin'`` only."""

    def has_permission(self, request, view):
        user = request.user
        return _authenticated(user) and _role(user) == ADMIN


class IsParentOrAdmin(permissions.BasePermission):
    """Family portal actors: parent, student (school-email / Loyverse self-guardian), or admin."""

    def has_permission(self, request, view):
        user = request.user
        return _authenticated(user) and _role(user) in (PARENT, STUDENT, ADMIN)
