"""
cafeteria/exports.py — CSV / PDF account statements (spec §5 F5 "Export").

Per-student statement: a student's balance + full transaction ledger. (The
whole-school roster export moved to ``admin/balances/export/`` in Data Ops
Phase 6; the old ``admin/export/school/`` endpoint was removed in Phase 10.)

CSV is produced with the stdlib ``csv`` module; PDF reuses the dependency-free
``apps.core.pdf`` helper. Each builder returns a ready-to-send
``django.http.HttpResponse`` with the right content-type and download filename.
"""
import csv
from decimal import Decimal

from django.http import HttpResponse
from django.utils import timezone

from apps.core.exports import as_download, export_filename, fmt_dt
from apps.core.pdf import simple_document_pdf

from .models import CafeteriaBalance, CafeteriaTransaction

# ── per-student statement ────────────────────────────────────────────────────

def _student_rows(student):
    """(header, list[row]) of a student's ledger, oldest first for a statement."""
    txns = (CafeteriaTransaction.objects
            .filter(student=student).order_by('date'))
    header = ['Fecha', 'Tipo', 'Descripción', 'Monto', 'Saldo']
    rows = []
    for tx in txns:
        rows.append([
            fmt_dt(tx.date),
            tx.get_transaction_type_display(),
            tx.description or '',
            f'{Decimal(str(tx.amount)):.2f}',
            f'{Decimal(str(tx.balance_after)):.2f}' if tx.balance_after is not None else '',
        ])
    return header, rows


def student_statement_csv(student) -> HttpResponse:
    cb, _ = CafeteriaBalance.objects.get_or_create(student=student)
    header, rows = _student_rows(student)

    response = HttpResponse(content_type='text/csv; charset=utf-8')
    # BOM so Excel opens UTF-8 (accents) correctly.
    response.write('﻿')
    writer = csv.writer(response)
    writer.writerow(['Estado de cuenta de cafetería'])
    writer.writerow(['Alumno', student.user.full_name])
    writer.writerow(['Matrícula', student.student_id])
    writer.writerow(['Saldo actual', f'{Decimal(str(cb.balance)):.2f}'])
    writer.writerow(['Generado', fmt_dt(timezone.now())])
    writer.writerow([])
    writer.writerow(header)
    writer.writerows(rows)
    response.export_row_count = len(rows)  # read by the view's record_export
    return as_download(response, export_filename(f'estado_cafeteria_{student.student_id}', 'csv'))


def student_statement_pdf(student) -> HttpResponse:
    cb, _ = CafeteriaBalance.objects.get_or_create(student=student)
    header, rows = _student_rows(student)

    # Fixed-width columns so the single-font PDF stays readable.
    widths = [17, 12, 34, 11, 11]

    def _line(cells):
        return ''.join(str(c)[:w - 1].ljust(w) for c, w in zip(cells, widths, strict=False))

    lines = [
        f'Alumno: {student.user.full_name}   Matrícula: {student.student_id}',
        f'Saldo actual: ${Decimal(str(cb.balance)):.2f}',
        f'Generado: {fmt_dt(timezone.now())}',
        '',
        _line(header),
        '-' * sum(widths),
    ]
    lines += [_line(r) for r in rows] or ['(Sin movimientos)']

    pdf = simple_document_pdf('Estado de cuenta de cafetería', lines)
    response = HttpResponse(pdf, content_type='application/pdf')
    response.export_row_count = len(rows)  # read by the view's record_export
    return as_download(response, export_filename(f'estado_cafeteria_{student.student_id}', 'pdf'))
