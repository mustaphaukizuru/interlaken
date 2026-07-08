"""
cafeteria/exports.py — CSV / PDF account statements (spec §5 F5 "Export").

Two scopes:
- **per-student statement** — a student's balance + full transaction ledger,
- **whole-school roster** — every student's current balance & low-balance flag.

CSV is produced with the stdlib ``csv`` module; PDF reuses the dependency-free
``apps.core.pdf`` helper. Each builder returns a ready-to-send
``django.http.HttpResponse`` with the right content-type and download filename.
"""
import csv
import io
from decimal import Decimal

from django.http import HttpResponse
from django.utils import timezone

from apps.core.pdf import simple_document_pdf

from .models import CafeteriaBalance, CafeteriaTransaction


def _fmt_dt(dt) -> str:
    if not dt:
        return ''
    return timezone.localtime(dt).strftime('%Y-%m-%d %H:%M')


def _filename(prefix: str, ext: str) -> str:
    stamp = timezone.localtime(timezone.now()).strftime('%Y%m%d')
    return f'{prefix}_{stamp}.{ext}'


def _download(response: HttpResponse, filename: str) -> HttpResponse:
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


# ── per-student statement ────────────────────────────────────────────────────

def _student_rows(student):
    """(header, list[row]) of a student's ledger, oldest first for a statement."""
    txns = (CafeteriaTransaction.objects
            .filter(student=student).order_by('date'))
    header = ['Fecha', 'Tipo', 'Descripción', 'Monto', 'Saldo']
    rows = []
    for tx in txns:
        rows.append([
            _fmt_dt(tx.date),
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
    writer.writerow(['Generado', _fmt_dt(timezone.now())])
    writer.writerow([])
    writer.writerow(header)
    writer.writerows(rows)
    return _download(response, _filename(f'estado_cafeteria_{student.student_id}', 'csv'))


def student_statement_pdf(student) -> HttpResponse:
    cb, _ = CafeteriaBalance.objects.get_or_create(student=student)
    header, rows = _student_rows(student)

    # Fixed-width columns so the single-font PDF stays readable.
    widths = [17, 12, 34, 11, 11]

    def _line(cells):
        return ''.join(str(c)[:w - 1].ljust(w) for c, w in zip(cells, widths))

    lines = [
        f'Alumno: {student.user.full_name}   Matrícula: {student.student_id}',
        f'Saldo actual: ${Decimal(str(cb.balance)):.2f}',
        f'Generado: {_fmt_dt(timezone.now())}',
        '',
        _line(header),
        '-' * sum(widths),
    ]
    lines += [_line(r) for r in rows] or ['(Sin movimientos)']

    pdf = simple_document_pdf('Estado de cuenta de cafetería', lines)
    response = HttpResponse(pdf, content_type='application/pdf')
    return _download(response, _filename(f'estado_cafeteria_{student.student_id}', 'pdf'))


# ── whole-school roster ──────────────────────────────────────────────────────

def _school_rows():
    balances = (CafeteriaBalance.objects
                .select_related('student__user')
                .order_by('student__user__last_name', 'student__user__first_name'))
    header = ['Alumno', 'Matrícula', 'Grado', 'Saldo', 'Saldo bajo', 'Últ. sinc.']
    rows = []
    for cb in balances:
        s = cb.student
        rows.append([
            s.user.full_name,
            s.student_id,
            f'{s.grade} {s.group}'.strip(),
            f'{Decimal(str(cb.balance)):.2f}',
            'Sí' if cb.is_low_balance else 'No',
            _fmt_dt(cb.last_synced),
        ])
    return header, rows


def school_statement_csv() -> HttpResponse:
    header, rows = _school_rows()
    response = HttpResponse(content_type='text/csv; charset=utf-8')
    response.write('﻿')
    writer = csv.writer(response)
    writer.writerow(['Saldos de cafetería — toda la escuela'])
    writer.writerow(['Generado', _fmt_dt(timezone.now())])
    writer.writerow([])
    writer.writerow(header)
    writer.writerows(rows)
    return _download(response, _filename('saldos_cafeteria_escuela', 'csv'))


def school_statement_pdf() -> HttpResponse:
    header, rows = _school_rows()
    widths = [26, 12, 14, 11, 10]

    def _line(cells):
        # Last column (last-synced) is free-width at the end.
        fixed = ''.join(str(c)[:w - 1].ljust(w) for c, w in zip(cells, widths))
        return fixed + str(cells[-1]) if len(cells) > len(widths) else fixed

    lines = [
        f'Generado: {_fmt_dt(timezone.now())}   Alumnos: {len(rows)}',
        '',
        _line(header),
        '-' * 90,
    ]
    lines += [_line(r) for r in rows] or ['(Sin saldos registrados)']

    pdf = simple_document_pdf('Saldos de cafetería — toda la escuela', lines)
    response = HttpResponse(pdf, content_type='application/pdf')
    return _download(response, _filename('saldos_cafeteria_escuela', 'pdf'))
