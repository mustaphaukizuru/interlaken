"""
payments/filters.py — the admin Pagos ledger filters and export (Data Ops Phase 7).

``?status=`` ``?gateway=`` ``?type=`` ``?student=<profile id>`` ``?from=`` ``?to=``
(aware America/Mexico_City bounds on ``created_at``). Unknown values are
ignored so a stale bookmark shows the whole ledger instead of a 400.
"""

from __future__ import annotations

import django_filters

from apps.core.exporting import Col, ExportSpec
from apps.core.filtersets import ChoiceParamFilter, IdParamFilter, with_date_range

from .models import Payment

# Public ordering keys of the admin ledger (``?ordering=[-]<key>``); the
# frontend column ``sortKey`` values are the same strings (docs/API-LISTING.md).
ADMIN_PAYMENT_ORDERING = {
    "date": "created_at",
    "amount": "amount",
    "status": "status",
    "gateway": "gateway",
    "student": (
        "related_topup__student__user__last_name",
        "related_topup__student__user__first_name",
    ),
}

ADMIN_PAYMENT_SEARCH_FIELDS = (
    "related_topup__student__user__first_name",
    "related_topup__student__user__last_name",
    "related_topup__student__student_id",
    "user__email",
    "user__first_name",
    "user__last_name",
    "gateway_tx_id",
    "gateway_ref",
    "description",
)


@with_date_range("created_at")
class AdminPaymentFilterSet(django_filters.FilterSet):
    status = ChoiceParamFilter(field_name="status", choices=Payment.Status.choices)
    gateway = ChoiceParamFilter(field_name="gateway", choices=Payment.Gateway.choices)
    type = ChoiceParamFilter(field_name="payment_type", choices=Payment.Type.choices)
    student = IdParamFilter(field_name="related_topup__student_id")

    class Meta:
        model = Payment
        fields: list[str] = []


def _student(p):
    topup = p.related_topup
    return topup.student.user.full_name if topup and topup.student_id else ""


def _matricula(p):
    topup = p.related_topup
    return topup.student.student_id if topup and topup.student_id else ""


PAYMENT_EXPORT_SPEC = ExportSpec(
    filename_prefix="pagos",
    title="Pagos en línea",
    sheet_title="Pagos",
    audit_entity="payments",
    columns=[
        Col("created_at", "Fecha", width=18, fmt="datetime"),
        Col("student", "Alumno", getter=_student, width=28),
        Col("matricula", "Matrícula", getter=_matricula, width=12),
        Col("payer", "Pagó", getter=lambda p: p.user.email if p.user_id else "", width=28),
        Col(
            "description",
            "Concepto",
            getter=lambda p: p.description or p.get_payment_type_display(),
            width=26,
        ),
        Col("amount", "Monto", width=12, fmt="money"),
        Col("currency", "Moneda", width=8),
        Col("status", "Estado", getter=lambda p: p.get_status_display(), width=12),
        Col("gateway", "Pasarela", getter=lambda p: p.get_gateway_display(), width=16),
        Col("reference", "Referencia", getter=lambda p: p.gateway_tx_id or p.gateway_ref, width=24),
    ],
)
