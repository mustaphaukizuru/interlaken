"""
core/filters.py — Auditoría and Mensajes list filters, ordering and exports (Data Ops Phase 7).
"""

from __future__ import annotations

import json

import django_filters
from django.db.models import Q

from .exporting import Col, ExportSpec
from .filtersets import BoolParamFilter, ChoiceParamFilter, with_date_range
from .models import AuditLog, ContactMessage

# ── Auditoría ─────────────────────────────────────────────
# Public key → ORM field. ``actor`` sorts by the actor's email (a system entry
# has no actor and sorts with the NULLs).
AUDIT_ORDERING = {
    "date": "created_at",
    "action": "action",
    "actor": "actor__email",
    "object": ("object_type", "object_id"),
    "context": "context",
}

AUDIT_SEARCH_FIELDS = ("actor_label", "context", "object_id")


@with_date_range("created_at")
class AuditLogFilterSet(django_filters.FilterSet):
    """``action`` (choice), ``actor`` (label or email contains), ``object_type``
    and ``object_id`` (exact: one record's history), ``context`` (contains)."""

    action = ChoiceParamFilter(field_name="action", choices=AuditLog.Action.choices)
    actor = django_filters.CharFilter(method="filter_actor")
    object_type = django_filters.CharFilter(method="filter_exact_trimmed")
    object_id = django_filters.CharFilter(method="filter_exact_trimmed")
    context = django_filters.CharFilter(field_name="context", lookup_expr="icontains")

    class Meta:
        model = AuditLog
        fields: list[str] = []

    def filter_actor(self, qs, name, value):
        value = (value or "").strip()
        if not value:
            return qs
        return qs.filter(Q(actor_label__icontains=value) | Q(actor__email__icontains=value))

    def filter_exact_trimmed(self, qs, name, value):
        value = (value or "").strip()
        return qs.filter(**{name: value}) if value else qs


def _changes_json(entry) -> str:
    return json.dumps(entry.changes or {}, ensure_ascii=False, default=str)[:2000]


AUDIT_EXPORT_SPEC = ExportSpec(
    filename_prefix="auditoria",
    title="Auditoría",
    sheet_title="Auditoría",
    audit_entity="audit",
    columns=[
        Col("created_at", "Fecha", width=18, fmt="datetime"),
        Col(
            "actor",
            "Actor",
            getter=lambda a: a.actor_label or (a.actor.email if a.actor_id else ""),
            width=26,
        ),
        Col("action", "Acción", getter=lambda a: a.get_action_display(), width=14),
        Col("object_type", "Objeto", width=24),
        Col("object_id", "ID", width=10),
        Col("context", "Contexto", width=24),
        Col("changes", "Cambios", getter=_changes_json, width=60),
    ],
)


# ── Mensajes del sitio ────────────────────────────────────
CONTACT_ORDERING = {
    "date": "created_at",
    "name": "name",
    "email": "email",
    "subject": "subject",
    "handled": "is_handled",
}

CONTACT_SEARCH_FIELDS = ("name", "email", "subject", "message")


@with_date_range("created_at")
class ContactMessageFilterSet(django_filters.FilterSet):
    """``handled`` = 1 | 0 (anything else: all); ``from`` / ``to``."""

    handled = BoolParamFilter(field_name="is_handled")

    class Meta:
        model = ContactMessage
        fields: list[str] = []


CONTACT_EXPORT_SPEC = ExportSpec(
    filename_prefix="mensajes",
    title="Mensajes del sitio",
    sheet_title="Mensajes",
    audit_entity="contact_messages",
    columns=[
        Col("created_at", "Fecha", width=18, fmt="datetime"),
        Col("name", "Nombre", width=24),
        Col("email", "Correo", width=28),
        Col("subject", "Asunto", width=30),
        Col("message", "Mensaje", width=60),
        Col("is_handled", "Atendido", width=10, fmt="bool"),
    ],
)
