"""
finance/receipts.py — printable tuition payment receipt (comprobante de pago).

Produces a dependency-free PDF via ``apps.core.pdf`` for a **paid** invoice. This
is an internal receipt, not a fiscal CFDI: a real CFDI 4.0 is issued through a PAC
(see Prompt 16 / DEPLOYMENT.md). ``cfdi_available`` stays False until that PAC
integration lands, so the UI can offer the receipt now and the CFDI later.
"""
from decimal import Decimal

from django.http import HttpResponse
from django.utils import timezone

from apps.core.pdf import simple_document_pdf

from .services import _period_label


def _fmt_dt(dt) -> str:
    return timezone.localtime(dt).strftime('%d/%m/%Y %H:%M') if dt else ''


def invoice_receipt_pdf(invoice) -> HttpResponse:
    """Return an ``HttpResponse`` streaming a PDF receipt for a paid invoice."""
    student = invoice.student
    lines = [
        'COLEGIO INTERLAKEN',
        'Comprobante de pago de colegiatura',
        '',
        f'Alumno:      {student.user.full_name}',
        f'Matrícula:   {student.student_id}',
        f'Grado:       {student.grade} {student.group}'.rstrip(),
        f'Periodo:     {_period_label(invoice.period)}',
        f'Vencimiento: {invoice.due_date.strftime("%d/%m/%Y")}',
        f'Pagada:      {_fmt_dt(invoice.paid_at)}',
        '',
        'Conceptos',
        '-' * 60,
    ]
    for li in invoice.line_items.all():
        amount = Decimal(str(li.amount))
        lines.append(f'{li.description[:44].ljust(44)} ${amount:>10.2f}')
    lines += [
        '-' * 60,
        f'{"Subtotal".ljust(44)} ${Decimal(str(invoice.subtotal)):>10.2f}',
        f'{"Descuentos".ljust(44)} ${Decimal(str(invoice.discount_total)):>10.2f}',
        f'{"Recargos".ljust(44)} ${Decimal(str(invoice.late_fee_total)):>10.2f}',
        f'{"TOTAL PAGADO".ljust(44)} ${Decimal(str(invoice.amount_paid)):>10.2f} {invoice.currency}',
        '',
        f'Comprobante generado el {_fmt_dt(timezone.now())}.',
        'Este documento es un comprobante interno, no una factura fiscal (CFDI).',
    ]

    pdf = simple_document_pdf('Comprobante de pago', lines)
    response = HttpResponse(pdf, content_type='application/pdf')
    response['Content-Disposition'] = (
        f'attachment; filename="colegiatura_{student.student_id}_{invoice.period}.pdf"')
    return response
