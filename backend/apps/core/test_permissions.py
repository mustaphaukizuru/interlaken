"""
apps.core.permissions — the shared rules (Data Ops Phase 10 consolidation).

The three local duplicates (``IsParentOrAdmin`` in cafetería, ``IsStaffOrAdmin``
in portal analytics, ``_is_staff`` in admissions) moved here unchanged; this
table pins each rule per role and per Django ``is_staff`` flag so the move
cannot drift.
"""

import pytest
from django.contrib.auth.models import AnonymousUser
from rest_framework.test import APIRequestFactory

from apps.accounts.factories import UserFactory
from apps.accounts.models import User
from apps.core.permissions import (
    IsAdmin,
    IsAdminOrStaff,
    IsParentOrAdmin,
    IsStaffOrAdmin,
    is_admin_or_django_staff,
)

pytestmark = pytest.mark.django_db

# role, is_staff flag → (IsAdmin, IsAdminOrStaff, IsStaffOrAdmin, IsParentOrAdmin, admin_or_django_staff)
MATRIX = [
    (User.Role.ADMIN, True, (True, True, True, True, True)),
    (User.Role.ADMIN, False, (True, True, True, True, True)),
    (User.Role.STAFF, False, (False, True, True, False, False)),
    (User.Role.STAFF, True, (False, True, True, False, True)),
    (User.Role.PARENT, False, (False, False, False, True, False)),
    (User.Role.PARENT, True, (False, False, True, True, True)),
    (User.Role.STUDENT, False, (False, False, False, True, False)),
]


def _allowed(cls, user):
    request = APIRequestFactory().get("/x/")
    request.user = user
    return cls().has_permission(request, None)


@pytest.mark.parametrize("role,is_staff,expected", MATRIX)
def test_rules_per_role(role, is_staff, expected):
    user = UserFactory(role=role, is_staff=is_staff)
    got = (
        _allowed(IsAdmin, user),
        _allowed(IsAdminOrStaff, user),
        _allowed(IsStaffOrAdmin, user),
        _allowed(IsParentOrAdmin, user),
        is_admin_or_django_staff(user),
    )
    assert got == expected


def test_anonymous_is_refused_everywhere():
    anon = AnonymousUser()
    for cls in (IsAdmin, IsAdminOrStaff, IsStaffOrAdmin, IsParentOrAdmin):
        assert _allowed(cls, anon) is False
    assert is_admin_or_django_staff(anon) is False
    assert is_admin_or_django_staff(None) is False


def test_views_use_the_shared_classes():
    from apps.cafeteria import views as cafeteria_views
    from apps.portal import analytics

    assert cafeteria_views.IsParentOrAdmin is IsParentOrAdmin
    assert analytics.StaffAnalyticsView.permission_classes == [IsStaffOrAdmin]
