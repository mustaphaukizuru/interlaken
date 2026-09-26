"""
payments/portal_exports.py — the family Pagos export (Data Ops Phase 9).

``views.PaymentHistoryExportView`` subclasses ``PaymentHistoryView``, so the
family scoping (``payments_visible_to``), the ``status``/``student``/``from``/
``to`` filters and the whitelisted ``ordering`` are shared with the list. This
module only declares the columns (the same eight the family CSV always had).
The per-payment comprobante PDF is a separate endpoint and is unchanged.
"""

from __future__ import annotations

from apps.core.exporting import Col, ExportSpec

FAMILY_EXPORT_FORMATS = ("csv", "xlsx")


def _student(p):
    topup = p.related_topup
    return topup.student.user.full_name if topup and topup.student_id else ""


FAMILY_PAYMENTS_EXPORT_SPEC = ExportSpec(
    filename_prefix="pagos",
    title="Pagos",
    sheet_title="Pagos",
    audit_entity="payments.family",
    columns=[
        Col("created_at", "Fecha", width=18, fmt="datetime"),
        Col("student", "Alumno", getter=_student, width=28),
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
        Col(
            "reference",
            "Referencia",
            getter=lambda p: p.gateway_tx_id or p.gateway_ref or "",
            width=24,
        ),
    ],
)
