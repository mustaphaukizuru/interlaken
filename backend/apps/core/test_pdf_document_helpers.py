"""
apps.core.pdf_document — the public drawing helpers added for documents laid
out outside the module (the ficha de inscripción): ``fit_text``,
``Canvas.runs``, ``jpeg_image`` and ``assemble_pdf``.
"""

from apps.core import pdf_document
from apps.core.pdf_document import (
    BOLD,
    REGULAR,
    Canvas,
    assemble_pdf,
    fit_text,
    jpeg_image,
    text_width,
)
from apps.core.test_pdf_document import assert_well_formed, has_text


def test_fit_text_keeps_the_largest_size_that_fits():
    size, lines = fit_text("Polen", REGULAR, 100, 20, max_size=9)
    assert (size, lines) == (9, ["Polen"])


def test_fit_text_shrinks_then_cuts_with_an_ellipsis():
    text = "Asma moderada con crisis estacionales. " * 4
    size, lines = fit_text(text, REGULAR, 120, 40, max_size=9, min_size=5)
    assert 5 <= size < 9
    assert len(lines) * size * 1.2 <= 40
    assert all(text_width(line, REGULAR, size) <= 120 for line in lines)

    size, lines = fit_text(text * 20, REGULAR, 120, 20, max_size=9, min_size=6)
    assert size == 6
    assert len(lines) == int(20 // (6 * 1.2)) and lines[-1].endswith("…")
    assert all(text_width(line, REGULAR, size) <= 120 for line in lines)


def test_fit_text_empty():
    assert fit_text("  ", REGULAR, 50, 10, max_size=8) == (8, [])


def test_jpeg_image_reads_the_logo_and_refuses_other_bytes():
    with open(pdf_document.LOGO_PATH, "rb") as fh:
        data = fh.read()
    image = jpeg_image(data)
    assert image is not None and image[0] == data and image[1][2] in (1, 3)
    assert jpeg_image(b"not a jpeg") is None
    assert jpeg_image(b"") is None


def test_runs_and_assemble_pdf():
    c = Canvas()
    parts = [("Celular ", BOLD, 9, (0, 0, 0)), ("(10 dígitos)", BOLD, 7, (0, 0, 0))]
    c.runs(300, 700, parts, align="center")
    total = text_width("Celular ", BOLD, 9) + text_width("(10 dígitos)", BOLD, 7)
    first = c.ops[1].decode("latin-1")
    assert f"{300 - total / 2:.2f}".rstrip("0").rstrip(".") in first
    pdf = assemble_pdf([c, Canvas()], (612, 792), title="Prueba")
    assert assert_well_formed(pdf) == 2
    assert has_text(pdf, "Celular ") and has_text(pdf, "(10 dígitos)")
    assert b"/Title (Prueba)" in pdf
