"""
accounts/filters.py — django-filter FilterSets for the people lists (Data Ops C1).

The roster keeps the Spanish params the console has used since P1-A6/A8
(``estado``, ``acceso``, ``nivel``, ``grado``, ``grupo``) as aliases of the
English list-contract names (``status``, ``access``, ``level``, ``grade``,
``group``). Unknown values are ignored instead of answering 400, so a stale
bookmark shows the unfiltered list (the behaviour the roster always had).
"""

from __future__ import annotations

import django_filters
from django.db.models import Q

from apps.core.listing import _to_date, apply_date_range

from .models import PasswordRequest, StudentProfile, User

LEVELS = ("maternal", "preescolar", "primaria", "secundaria")
YES = frozenset({"1", "true", "si", "sí", "yes", "linked", "vinculado"})
NO = frozenset({"0", "false", "no", "unlinked", "sin_vinculo"})
STAFF_ROLES = (User.Role.ADMIN, User.Role.STAFF)


def _yes_no(value) -> bool | None:
    text = str(value or "").strip().lower()
    if text in YES:
        return True
    if text in NO:
        return False
    return None


class StudentFilterSet(django_filters.FilterSet):
    """``status|estado``, ``access|acceso``, ``level|nivel``, ``grade|grado``,
    ``group|grupo``, ``linked|vinculado`` and ``enrolled_from``/``enrolled_to``."""

    status = django_filters.CharFilter(method="filter_status")
    estado = django_filters.CharFilter(method="filter_status")
    access = django_filters.CharFilter(method="filter_access")
    acceso = django_filters.CharFilter(method="filter_access")
    level = django_filters.CharFilter(method="filter_level")
    nivel = django_filters.CharFilter(method="filter_level")
    grade = django_filters.CharFilter(method="filter_grade")
    grado = django_filters.CharFilter(method="filter_grade")
    group = django_filters.CharFilter(method="filter_group")
    grupo = django_filters.CharFilter(method="filter_group")
    linked = django_filters.CharFilter(method="filter_linked")
    vinculado = django_filters.CharFilter(method="filter_linked")
    enrolled_from = django_filters.CharFilter(method="filter_enrolled_from")
    enrolled_to = django_filters.CharFilter(method="filter_enrolled_to")

    class Meta:
        model = StudentProfile
        fields: list[str] = []

    def filter_status(self, qs, name, value):
        return qs.filter(status=value) if value in StudentProfile.Status.values else qs

    def filter_access(self, qs, name, value):
        if value == "never":  # family login never used
            return qs.filter(user__last_login__isnull=True)
        if value == "nopass":  # Django stores unusable passwords with a leading '!'
            return qs.filter(user__password__startswith="!")
        if value == "active":  # has logged in at least once
            return qs.filter(user__last_login__isnull=False)
        return qs

    def filter_level(self, qs, name, value):
        value = (value or "").strip().lower()
        return qs.filter(grade__icontains=value) if value in LEVELS else qs

    def filter_grade(self, qs, name, value):
        return qs.filter(grade=value[:20]) if value else qs

    def filter_group(self, qs, name, value):
        return qs.filter(group__iexact=value.strip()[:5]) if value else qs

    def filter_linked(self, qs, name, value):
        flag = _yes_no(value)
        if flag is True:
            return qs.exclude(loyverse_id="")
        if flag is False:
            return qs.filter(loyverse_id="")
        return qs

    def filter_enrolled_from(self, qs, name, value):
        day = _to_date(value)
        return qs.filter(enrollment_date__gte=day) if day else qs

    def filter_enrolled_to(self, qs, name, value):
        day = _to_date(value)
        return qs.filter(enrollment_date__lte=day) if day else qs


class StaffFilterSet(django_filters.FilterSet):
    """``role|rol`` (admin/staff) and ``active|activo`` (1/0)."""

    role = django_filters.CharFilter(method="filter_role")
    rol = django_filters.CharFilter(method="filter_role")
    active = django_filters.CharFilter(method="filter_active")
    activo = django_filters.CharFilter(method="filter_active")

    class Meta:
        model = User
        fields: list[str] = []

    def filter_role(self, qs, name, value):
        return qs.filter(role=value) if value in STAFF_ROLES else qs

    def filter_active(self, qs, name, value):
        flag = _yes_no(value)
        return qs if flag is None else qs.filter(is_active=flag)


class PasswordRequestFilterSet(django_filters.FilterSet):
    """``status|estado``, ``channel|canal``, ``linked`` and ``from``/``to`` (created_at)."""

    status = django_filters.CharFilter(method="filter_status")
    estado = django_filters.CharFilter(method="filter_status")
    channel = django_filters.CharFilter(method="filter_channel")
    canal = django_filters.CharFilter(method="filter_channel")
    linked = django_filters.CharFilter(method="filter_linked")

    class Meta:
        model = PasswordRequest
        fields: list[str] = []

    def filter_status(self, qs, name, value):
        return qs.filter(status=value) if value in PasswordRequest.Status.values else qs

    def filter_channel(self, qs, name, value):
        return qs.filter(channel=value) if value in PasswordRequest.Channel.values else qs

    def filter_linked(self, qs, name, value):
        flag = _yes_no(value)
        if flag is None:
            return qs
        return qs.filter(~Q(user=None)) if flag else qs.filter(user=None)

    @property
    def qs(self):
        qs = super().qs
        params = self.data or {}
        return apply_date_range(qs, "created_at", params.get("from"), params.get("to"))
