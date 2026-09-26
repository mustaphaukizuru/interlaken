"""
legal/filters.py — the ARCO console list: filters, overdue annotation, export (Data Ops Phase 7).
"""

from __future__ import annotations

import django_filters
from django.db.models import BooleanField, Case, Q, Value, When
from django.utils import timezone

from apps.core.exporting import Col, ExportSpec
from apps.core.filtersets import (
    BoolParamFilter,
    ChoiceParamFilter,
    parse_bool_param,
    with_date_range,
)

from .models import ArcoRequest

OPEN_STATUSES = (ArcoRequest.Status.RECEIVED, ArcoRequest.Status.IN_REVIEW)

ARCO_ORDERING = {
    "date": "created_at",
    "deadline": "statutory_deadline",
    "status": "status",
    "type": "request_type",
    "requester": "requester_email",
}

ARCO_SEARCH_FIELDS = ("requester_email", "requester_name", "details")


def overdue_q(today=None) -> Q:
    """Open (received / in review) and past the statutory deadline."""
    today = today or timezone.localdate()
    return Q(status__in=OPEN_STATUSES, statutory_deadline__lt=today)


def annotate_overdue(qs, today=None):
    """``is_overdue`` computed in SQL so filters, ordering and the banner count
    agree with the rows (the serializer reads the annotation)."""
    return qs.annotate(
        is_overdue_ann=Case(
            When(overdue_q(today), then=Value(True)),
            default=Value(False),
            output_field=BooleanField(),
        )
    )


class _ArcoStatusFilter(ChoiceParamFilter):
    """``?status=open`` is the console's default queue (received + in review)."""

    def filter(self, qs, value):
        if str(value or "").strip() == "open":
            return qs.filter(status__in=OPEN_STATUSES)
        return super().filter(qs, value)


class _OverdueFilter(BoolParamFilter):
    def filter(self, qs, value):
        parsed = parse_bool_param(value)
        if parsed is None:
            return qs
        return qs.filter(overdue_q()) if parsed else qs.exclude(overdue_q())


@with_date_range("created_at")
class ArcoFilterSet(django_filters.FilterSet):
    status = _ArcoStatusFilter(field_name="status", choices=ArcoRequest.Status.choices)
    type = ChoiceParamFilter(field_name="request_type", choices=ArcoRequest.Type.choices)
    channel = ChoiceParamFilter(field_name="channel", choices=ArcoRequest.Channel.choices)
    overdue = _OverdueFilter(field_name="statutory_deadline")

    class Meta:
        model = ArcoRequest
        fields: list[str] = []


def _is_overdue(r) -> bool:
    value = getattr(r, "is_overdue_ann", None)
    if value is None:
        return r.status in OPEN_STATUSES and r.statutory_deadline < timezone.localdate()
    return bool(value)


ARCO_EXPORT_SPEC = ExportSpec(
    filename_prefix="solicitudes_arco",
    title="Solicitudes ARCO",
    sheet_title="ARCO",
    audit_entity="arco",
    columns=[
        Col("created_at", "Recibida", width=18, fmt="datetime"),
        Col("request_type", "Derecho", getter=lambda r: r.get_request_type_display(), width=14),
        Col("requester_name", "Solicitante", width=24),
        Col("requester_email", "Correo", width=28),
        Col("channel", "Canal", getter=lambda r: r.get_channel_display(), width=14),
        Col("status", "Estado", getter=lambda r: r.get_status_display(), width=12),
        Col("statutory_deadline", "Fecha límite", width=12, fmt="date"),
        Col("is_overdue", "Vencida", getter=_is_overdue, width=8, fmt="bool"),
        Col("details", "Detalle", width=40),
        Col("resolution_note", "Resolución", width=40),
        Col("resolved_at", "Cerrada", width=18, fmt="datetime"),
    ],
)
