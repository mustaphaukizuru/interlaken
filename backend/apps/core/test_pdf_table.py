"""
apps.core.pdf.table_pdf — fixed-width table: bold header, cut-to-width cells,
page numbers and the "Generado" stamp; ``simple_document_pdf`` untouched.
"""

import re

from apps.core.pdf import _column_widths, _fit, simple_document_pdf, table_pdf


def _pages(pdf: bytes) -> int:
    return len(re.findall(rb"/Type /Page[^s]", pdf))


def test_single_page_layout():
    pdf = table_pdf(
        "Alumnos", ["Nombre", "Monto"], [["Ana", "10.00"], ["Beto", "250.00"]], subtitle="2 filas"
    )
    assert pdf.startswith(b"%PDF-1.4") and pdf.endswith(b"%%EOF")
    assert _pages(pdf) == 1
    assert b"/MediaBox [0 0 792 612]" in pdf  # landscape by default
    assert b"/BaseFont /Courier-Bold" in pdf  # header font
    assert b"(Alumnos) Tj" in pdf and b"2 filas" in pdf
    assert re.search(rb"Generado \d\d/\d\d/\d{4} \d\d:\d\d  -  Pagina 1 de 1", pdf)
    # Numbers right-align inside their column, text left-aligns.
    assert b"(Nombre Monto ) Tj" in pdf
    assert b"(Ana     10.00) Tj" in pdf
    assert b"(Beto   250.00) Tj" in pdf


def test_multi_page_numbers_and_portrait():
    rows = [[f"Fila {i}", str(i)] for i in range(120)]
    pdf = table_pdf("Largo", ["Nombre", "N"], rows, landscape=False)
    assert b"/MediaBox [0 0 612 792]" in pdf
    total = _pages(pdf)
    assert total >= 2
    assert f"Pagina 1 de {total}".encode() in pdf
    assert f"Pagina {total} de {total}".encode() in pdf
    assert b"Fila 119" in pdf


def test_widths_and_truncation():
    assert _fit("abcdef", 4) == "abcd"
    assert _fit("12", 5) == "   12"
    assert _fit("ab", 5) == "ab   "
    widths = _column_widths(["A", "B"], [["x" * 100, "y"]], usable=50, widths=[None, 10])
    assert widths[1] == 10 and widths[0] + widths[1] + 1 <= 50
    pdf = table_pdf("T", ["A"], [["x" * 300]], widths=[8])
    assert b"xxxxxxxx" in pdf and b"x" * 9 not in pdf


def test_non_latin1_characters_do_not_break_the_stream():
    pdf = table_pdf("Título ñ", ["Año"], [["😀 emoji", "x"]])
    assert b"A\xf1o" in pdf  # Latin-1 survives (WinAnsi font encoding)
    assert b"? emoji" in pdf  # outside Latin-1 is replaced, never crashes


def test_simple_document_pdf_is_unchanged():
    pdf = simple_document_pdf("Estado de cuenta", ["linea 1", "linea 2"], subtitle="sub")
    assert pdf.startswith(b"%PDF-1.4") and b"/BaseFont /Helvetica" in pdf
    assert _pages(pdf) == 1
