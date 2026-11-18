"""
apps.core.pdf_document — the branded receipt and statement PDFs.

Checks the file is a well-formed PDF (every xref offset lands on its object),
that the facts are on the page in WinAnsi (accents, $), the brand pieces
(logo, footer, page numbers), multi-page tables with the header repeated,
A4/Letter, and the receipt/statement endpoints end to end. When PyMuPDF is
installed the pages are also rasterised (optional visual check).
"""
import re
from datetime import datetime
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.core import pdf_document
from apps.core.pdf_document import (
    Column,
    Document,
    Row,
    Table,
    ellipsize,
    receipt_pdf,
    render_document_pdf,
    text_width,
    wrap,
)
from apps.payments.models import Payment

MX = ZoneInfo('America/Mexico_City')


def assert_well_formed(pdf: bytes) -> int:
    """Header, trailer, and an xref whose every offset starts its object. Returns the page count."""
    assert pdf.startswith(b'%PDF-1.4\n') and pdf.rstrip().endswith(b'%%EOF')
    start = int(re.search(rb'startxref\n(\d+)\n%%EOF', pdf).group(1))
    assert pdf[start:start + 4] == b'xref'
    count = int(re.search(rb'xref\n0 (\d+)\n', pdf[start:]).group(1))
    offsets = re.findall(rb'(\d{10}) 00000 n ', pdf[start:])
    assert len(offsets) == count - 1
    for n, off in enumerate(offsets, start=1):
        assert pdf[int(off):int(off) + len(f'{n} 0 obj')] == f'{n} 0 obj'.encode()
    # Every stream's /Length is its exact byte length.
    for m in re.finditer(rb'/Length (\d+)[^>]*>>\nstream\n', pdf):
        end = m.end() + int(m.group(1))
        assert pdf[end:end + 10] == b'\nendstream'
    pages = len(re.findall(rb'/Type /Page[^s]', pdf))
    assert re.search(rf'/Count {pages} '.encode(), pdf)
    return pages


def has_text(pdf: bytes, text: str) -> bool:
    """A text run as the content stream holds it: cp1252, with ( ) and \\ escaped."""
    raw = text.encode('cp1252').replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)')
    return raw in pdf


def _doc(**kw) -> Document:
    base = dict(
        title='Estado de cuenta', reference='Cafetería · Noviembre 2026',
        summary=[('Saldo inicial', '$100.00'), ('Saldo final', '$70.00')],
        info=[('Alumno', 'Ana Peña Ibáñez'), ('Matrícula', 'IK9001')],
        table=Table(columns=[Column('Fecha', 64), Column('Detalle'), Column('Importe', 76, 'right', strong=True)],
                    rows=[Row(['01/11 08:05', 'Torta de jamón', '-42.00'])]),
        totals=[('Saldo inicial', '$100.00'), ('Saldo final', '$70.00')],
        notes=['Nota informativa.'],
        generated_at=datetime(2026, 11, 18, 14, 5, tzinfo=MX),
    )
    base.update(kw)
    return Document(**base)


# ── layout engine ──────────────────────────────────────────────────────────
def test_renders_a_well_formed_branded_page():
    pdf = render_document_pdf(_doc())
    assert assert_well_formed(pdf) == 1
    assert b'/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding' in pdf
    assert b'/Filter /DCTDecode' in pdf and b'/Logo Do' in pdf            # the official logo
    for text in ('Estado de cuenta', 'Cafetería · Noviembre 2026', 'Ana Peña Ibáñez', 'Torta de jamón',
                 '-42.00', '$100.00', 'Saldo final', 'Nota informativa.', 'Colegio Interlaken'):
        assert has_text(pdf, text), text
    assert has_text(pdf, 'Generado el 18/11/2026 14:05  ·  Página 1 de 1')
    assert b'/MediaBox [0 0 612 792]' in pdf                               # US Letter by default
    assert b'/Title (' + 'Estado de cuenta Cafetería · Noviembre 2026'.encode('cp1252') + b')' in pdf


def test_long_tables_paginate_with_the_header_on_every_page():
    rows = [Row([f'{i % 28 + 1:02d}/11 08:05', f'Movimiento número {i}', f'-{i}.00']) for i in range(120)]
    pdf = render_document_pdf(_doc(table=Table(columns=_doc().table.columns, rows=rows), footer='Pie de prueba'))
    pages = assert_well_formed(pdf)
    assert pages >= 3
    # Every page that carries rows starts them with the header row (the last
    # page may hold only the totals and notes).
    streams = re.findall(rb'stream\n(.*?)\nendstream', pdf, re.S)
    with_rows = [st for st in streams if b'Movimiento n' in st]
    assert len(with_rows) >= pages - 1
    assert all(b'(IMPORTE) Tj' in st for st in with_rows)
    assert has_text(pdf, f'Página {pages} de {pages}')
    assert has_text(pdf, 'Movimiento número 119')
    # Continuation pages carry a compact header with the school name.
    assert pdf.count(b'(Colegio Interlaken) Tj') == pages - 1


def test_a4_and_history_rows():
    rows = [Row(['01/11', '(ya en el saldo) Devolución en caja', '25.00'], muted=True)]
    pdf = render_document_pdf(_doc(page_size='a4', table=Table(columns=_doc().table.columns, rows=rows)))
    assert assert_well_formed(pdf) == 1
    assert b'/MediaBox [0 0 595.28 841.89]' in pdf
    assert has_text(pdf, '(ya en el saldo) Devolución en caja')
    assert b'/F3 8.6 Tf' in pdf                                            # muted rows in italics


def test_empty_table_says_so():
    pdf = render_document_pdf(_doc(table=Table(columns=_doc().table.columns, rows=[])))
    assert has_text(pdf, 'Sin movimientos en el periodo.')


def test_falls_back_to_the_name_when_the_logo_file_is_missing(monkeypatch):
    monkeypatch.setattr(pdf_document, 'LOGO_PATH', '/nonexistent/logo.jpg')
    pdf = render_document_pdf(_doc())
    assert_well_formed(pdf)
    assert b'/DCTDecode' not in pdf and has_text(pdf, 'INTERLAKEN')


def test_text_outside_cp1252_never_breaks_the_file():
    pdf = render_document_pdf(_doc(info=[('Alumno', 'Zoë 🙂 Ŀ (prueba) \\ fin')]))
    assert_well_formed(pdf)
    assert has_text(pdf, 'Zoë ? ? (prueba) \\ fin')


def test_text_metrics_wrap_and_ellipsis():
    assert text_width('0000', 'F1', 10) == pytest.approx(22.24)
    assert text_width('á', 'F1', 10) == text_width('a', 'F1', 10)
    cut = ellipsize('Chilaquiles verdes con pollo y frijoles', 'F1', 9, 80)
    assert cut.endswith('…') and text_width(cut, 'F1', 9) <= 80
    lines = wrap('una frase bastante larga para partir en varias líneas', 'F1', 10, 90)
    assert len(lines) > 1 and all(text_width(line, 'F1', 10) <= 90 for line in lines)


def test_text_lines_lists_every_fact():
    lines = _doc().text_lines()
    assert 'Saldo inicial: $100.00' in lines and 'Alumno: Ana Peña Ibáñez' in lines
    assert '01/11 08:05  Torta de jamón  -42.00' in lines


def test_receipt_is_laid_out_from_label_value_lines(monkeypatch):
    seen = {}
    monkeypatch.setattr(pdf_document, 'render_document_pdf', lambda doc, **kw: seen.update(doc=doc, **kw) or b'%PDF')
    receipt_pdf('Comprobante de pago', [
        'Folio: 9', 'Fecha: 2026-11-18 13:47', 'Estado: Exitoso', '',
        'Concepto: Recarga de cafetería', 'Alumno: Ana Peña', 'Pagó: Luis Peña (luis@ejemplo.mx)', '',
        'Monto: $350.00 MXN', 'Pasarela: Banorte', 'Referencia bancaria: 248233587990', '',
        'Este comprobante acredita una recarga de saldo de cafetería. No es un CFDI;',
        'para facturación escriba a facturas@ejemplo.mx.',
    ], subtitle='Portal de Familias', status=('Pagado', 'success'))
    doc = seen['doc']
    assert doc.reference == 'Folio 9' and doc.status == ('Pagado', 'success')
    assert doc.summary == [('Monto', '$350.00 MXN')] and doc.totals == [('Total', '$350.00 MXN')]
    assert doc.table.rows[0].cells == ['Recarga de cafetería', 'Ana Peña', '$350.00 MXN']
    assert [k for k, _ in doc.info] == ['Fecha', 'Estado', 'Pagó', 'Pasarela', 'Referencia bancaria']
    assert doc.notes == ['Este comprobante acredita una recarga de saldo de cafetería. No es un CFDI; '
                         'para facturación escriba a facturas@ejemplo.mx.']


def test_optional_raster_check(tmp_path):
    """Rasterise when PyMuPDF is around (not in the image or CI): MuPDF reads it without repairs."""
    pymupdf = pytest.importorskip('pymupdf')
    pdf = render_document_pdf(_doc())
    doc = pymupdf.open(stream=pdf, filetype='pdf')
    assert doc.page_count == 1 and 'Ana Peña Ibáñez' in doc[0].get_text()
    doc[0].get_pixmap(dpi=72).save(tmp_path / 'p1.png')
    assert not pymupdf.TOOLS.mupdf_warnings()


# ── endpoints ──────────────────────────────────────────────────────────────
@pytest.mark.django_db
def test_receipt_endpoint_returns_the_branded_comprobante(api_client, settings):
    settings.BILLING_EMAIL = 'facturas@ejemplo.mx'
    parent = ParentFactory(first_name='Lucía', last_name='Peña')
    kid = StudentProfileFactory(parents=[parent])
    topup = TopUpRequest.objects.create(student=kid, amount=Decimal('350'), method=TopUpRequest.Method.ONLINE)
    p = Payment.objects.create(user=parent, payment_type=Payment.Type.CAFETERIA, amount=Decimal('350.00'),
                               related_topup=topup, status=Payment.Status.SUCCESS, description='Recarga de cafetería')
    api_client.force_authenticate(parent)
    r = api_client.get(reverse('payment-receipt', args=[p.pk]))
    assert r.status_code == 200 and r['Content-Type'] == 'application/pdf'
    assert f'comprobante_{p.pk}.pdf' in r['Content-Disposition']
    pdf = r.content
    assert_well_formed(pdf)
    for text in ('Comprobante de pago', f'Folio {p.pk}', 'PAGADO', '$350.00 MXN', 'Lucía Peña',
                 'Recarga de cafetería', 'No es un CFDI;', 'facturas@ejemplo.mx.'):
        assert has_text(pdf, text) or text in pdf.decode('cp1252'), text


@pytest.mark.django_db
def test_refunded_receipt_says_devuelto(api_client):
    parent = ParentFactory()
    kid = StudentProfileFactory(parents=[parent])
    topup = TopUpRequest.objects.create(student=kid, amount=Decimal('100'), method=TopUpRequest.Method.ONLINE)
    p = Payment.objects.create(user=parent, payment_type=Payment.Type.CAFETERIA, amount=Decimal('100.00'),
                               related_topup=topup, status=Payment.Status.REFUNDED)
    api_client.force_authenticate(parent)
    pdf = api_client.get(reverse('payment-receipt', args=[p.pk])).content
    assert has_text(pdf, 'DEVUELTO') and not has_text(pdf, 'PAGADO')


@pytest.mark.django_db
def test_statement_endpoint_lists_local_times_in_spanish_with_history_rows(api_client):
    parent = ParentFactory()
    kid = StudentProfileFactory(parents=[parent], grade='2° Primaria', group='A')
    CafeteriaBalance.objects.get_or_create(student=kid, defaults={'balance': Decimal('80')})
    # 12:07 in Mexico City is 18:07 UTC: the statement must print the local time.
    when = timezone.localtime().replace(day=1, hour=12, minute=7, second=0, microsecond=0)
    CafeteriaTransaction.objects.create(student=kid, transaction_type='topup', amount=Decimal('100'), date=when,
                                        balance_after=Decimal('120'), loyverse_receipt_id='st-1')
    CafeteriaTransaction.objects.create(student=kid, transaction_type='purchase', amount=Decimal('40'), date=when,
                                        balance_after=Decimal('80'), description='Sándwich', loyverse_receipt_id='st-2')
    CafeteriaTransaction.objects.create(student=kid, transaction_type='refund', amount=Decimal('25'), date=when,
                                        balance_after=None, applied=False, description='Devolución en caja',
                                        loyverse_receipt_id='st-3')
    api_client.force_authenticate(parent)
    month = timezone.localdate().strftime('%Y-%m')
    r = api_client.get(reverse('cafeteria-statement'), {'student': kid.pk, 'month': month})
    assert r.status_code == 200 and f'cafeteria-{kid.student_id}-{month}.pdf' in r['Content-Disposition']
    pdf = r.content
    assert_well_formed(pdf)
    months = ('Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre',
              'Octubre', 'Noviembre', 'Diciembre')
    local = timezone.localdate()
    assert has_text(pdf, f'Cafetería · {months[local.month - 1]} {local.year}')
    assert has_text(pdf, f'{when:%d/%m} 12:07') and not has_text(pdf, f'{when:%d/%m} 18:07')
    assert has_text(pdf, 'Sándwich') and has_text(pdf, '-40.00')
    assert has_text(pdf, '(ya en el saldo) Devolución en caja')
    assert has_text(pdf, 'Saldo inicial') and has_text(pdf, '$20.00') and has_text(pdf, '$80.00')
    assert has_text(pdf, 'Total recargas') and has_text(pdf, 'Total consumos')
    assert not has_text(pdf, 'Total devoluciones')                         # history rows are never counted
    assert has_text(pdf, 'GRADO Y GRUPO') and has_text(pdf, '2° Primaria A')   # labels are set in capitals


@pytest.mark.django_db
def test_statement_facts_reach_the_document(api_client, monkeypatch):
    seen = {}
    monkeypatch.setattr('apps.core.pdf_document.render_document_pdf', lambda doc, **kw: seen.setdefault('doc', doc) and b'%PDF')
    parent = ParentFactory()
    kid = StudentProfileFactory(parents=[parent])
    CafeteriaTransaction.objects.create(student=kid, transaction_type='purchase', amount=Decimal('30'),
                                        date=timezone.now(), balance_after=Decimal('70'), loyverse_receipt_id='f-1')
    api_client.force_authenticate(parent)
    assert api_client.get(reverse('cafeteria-statement'), {'student': kid.pk}).status_code == 200
    text = '\n'.join(seen['doc'].text_lines())
    assert 'Saldo inicial: $100.00' in text and 'Saldo final: $70.00' in text
    assert 'Total consumos: -$30.00' in text and '-30.00  70.00' in text
    with mock.patch.object(pdf_document, 'LOGO_PATH', '/missing.jpg'):
        assert render_document_pdf(seen['doc']).startswith(b'%PDF-1.4')
