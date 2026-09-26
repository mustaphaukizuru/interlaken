"""
cafeteria/portal_exports.py — the family "Descargar movimientos" file (Data Ops Phase 9).

The portal export is the family history list with another renderer: the view
(``views.ParentExportView``) subclasses ``MyTransactionsView``, so the scoping
(own children only), the ``student``/``type``/``from``/``to`` filters and the
whitelisted ``ordering`` are the list's own code, never a second copy. This
module only declares the columns.

CSV and Excel only: the monthly statement PDF (``/cafeteria/statement/``) is
the family's printable document and stays as it is.
"""

from __future__ import annotations

from apps.core.exporting import Col, ExportSpec

FAMILY_EXPORT_FORMATS = ("csv", "xlsx")


def _student_name(tx):
    return tx.student.user.full_name if tx.student_id else ""


def _matricula(tx):
    return tx.student.student_id if tx.student_id else ""


FAMILY_TRANSACTIONS_EXPORT_SPEC = ExportSpec(
    filename_prefix="movimientos_cafeteria",
    title="Movimientos de cafetería",
    sheet_title="Movimientos",
    audit_entity="cafeteria.family_transactions",
    columns=[
        Col("student", "Alumno", getter=_student_name, width=28),
        Col("matricula", "Matrícula", getter=_matricula, width=12),
        Col("date", "Fecha", width=18, fmt="datetime"),
        Col("type", "Tipo", getter=lambda tx: tx.get_transaction_type_display(), width=12),
        Col("description", "Descripción", getter=lambda tx: tx.description or "", width=34),
        Col("amount", "Monto", width=12, fmt="money"),
        Col("balance_after", "Saldo", width=12, fmt="money"),
    ],
)
