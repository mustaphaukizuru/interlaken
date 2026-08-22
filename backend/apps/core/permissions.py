"""
core/permissions.py — shared DRF permission classes.

``IsAdmin`` used to be copy-pasted into five modules (accounts.exports,
accounts.import_students, admissions, bookings, cafeteria); this is the only
definition now. Staff-role granularity (BACKLOG P1-H1) will extend this file.
"""
from rest_framework import permissions


class IsAdmin(permissions.BasePermission):
    """Authenticated users with ``role == 'admin'`` only."""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and getattr(user, 'role', None) == 'admin')
