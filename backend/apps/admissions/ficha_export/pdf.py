"""
admissions/ficha_export/pdf.py — the ficha as a 3-page Letter PDF.

No PDF library: the page is drawn with ``apps.core.pdf_document``'s canvas
from the template grid itself (``template.grid()``), so the PDF mirrors the
Excel file box for box: the logo, the black section bars with white bold
text, the grey #BFBFBF label boxes, the bordered value boxes and the «X»
marks, on the same three pages (page 2 starts at «DATOS DEL PADRE», page 3
after the emergency bar). Helvetica replaces the form's fonts. Values shrink
to fit their box; long free text wraps and shrinks, cut with «…» only past
5 pt. Page 3 adds the electronic acceptance (who accepted the privacy
notice, when, and which version) and every page says «Página n de 3».
"""

from __future__ import annotations

from openpyxl.utils import coordinate_to_tuple, get_column_letter

from apps.core.pdf_document import (
    BOLD,
    ITALIC,
    REGULAR,
    Canvas,
    assemble_pdf,
    fit_text,
    jpeg_image,
    text_width,
)

from . import cellmap, template
from .data import FichaSheet
from .template import CellStyle, Run

PDF_CONTENT_TYPE = "application/pdf"
PAGE_W, PAGE_H = 612.0, 792.0  # Letter
SIDE, TOP, BOTTOM = 36.0, 26.0, 34.0
PAD = 2.0
INDENT_PT = 12.6  # one Excel indent level, printed
MIN_SIZE = 4.5
BLACK = (0.0, 0.0, 0.0)
MUTED = (0.35, 0.35, 0.35)
ACCEPT_FILL = (0.95, 0.95, 0.95)
ACCEPT_LINE = (0.75, 0.75, 0.75)  # #BFBFBF, the form's label grey
FOOTER = "Colegio Interlaken · Ficha de inscripción"

TEXT_AREAS = {cellmap.CELLS["salud.alergias_cuales"], cellmap.CELLS["salud.enfermedades"]}
ACCEPTANCE = cellmap.CELLS["firma.aceptacion"]


def _font(bold: bool, italic: bool) -> str:
    if bold:
        return BOLD
    return ITALIC if italic else REGULAR


class _Page:
    """Sheet points → PDF points for one page (scaled, centred)."""

    def __init__(self, canvas: Canvas, scale: float, width: float):
        self.c = canvas
        self.s = scale
        self.x0 = (PAGE_W - width * scale) / 2
        self.top = PAGE_H - TOP

    def x(self, x: float) -> float:
        return self.x0 + x * self.s

    def y(self, y: float) -> float:
        return self.top - y * self.s


def _scale(grid) -> float:
    by_width = (PAGE_W - 2 * SIDE) / grid.width
    by_height = (PAGE_H - TOP - BOTTOM) / max(grid.page_heights)
    return min(by_width, by_height)


# ── text ─────────────────────────────────────────────────────────────────
def _parts(runs: list[Run], k: float) -> list[tuple[str, str, float, tuple]]:
    return [(r.text, _font(r.bold, r.italic), r.size * k, r.rgb) for r in runs if r.text]


def _width(parts) -> float:
    return sum(text_width(t, f, s) for t, f, s, _ in parts)


def _wrap_parts(parts, width: float) -> list[list[tuple]]:
    """Greedy word wrap over mixed runs; explicit line breaks respected."""
    lines: list[list[tuple]] = [[]]
    used = 0.0
    for text, font, size, rgb in parts:
        for n, chunk in enumerate(text.split("\n")):
            if n:
                lines.append([])
                used = 0.0
            for word in chunk.split(" "):
                if not word:
                    continue
                token = word if not lines[-1] else f" {word}"
                w = text_width(token, font, size)
                if lines[-1] and used + w > width:
                    lines.append([])
                    token, w = word, text_width(word, font, size)
                    used = 0.0
                lines[-1].append((token, font, size, rgb))
                used += w
    return [ln for ln in lines if ln] or [[]]


def _align(style: CellStyle) -> str:
    if style.horizontal in ("center", "centerContinuous", "distributed"):
        return "center"
    if style.horizontal == "right":
        return "right"
    return "left"


def _draw_lines(page: _Page, box, lines, style: CellStyle, *, overflow: bool) -> None:
    """Lay ``lines`` (lists of runs) in ``box`` (sheet points) per the cell's alignment."""
    _p, x, y, w, h = box
    s = page.s
    pitches = [max((p[2] for p in ln), default=style.size * s) * 1.15 for ln in lines]
    block = sum(pitches)
    inner_h = h * s
    if style.vertical == "top":
        top = PAD
    elif style.vertical == "center":
        top = (inner_h - block) / 2
    else:  # Excel's default: bottom
        top = inner_h - block - PAD
    align = _align(style)
    left = page.x(x) + PAD + style.indent * INDENT_PT * s
    right = page.x(x + w) - PAD
    if align == "left":
        ax = left
    elif align == "right":
        ax = right
    else:
        ax = (page.x(x) + page.x(x + w)) / 2
    cursor = page.y(y) - top
    for ln, pitch in zip(lines, pitches, strict=True):
        size = max((p[2] for p in ln), default=style.size * s)
        baseline = cursor - pitch + (pitch - size) / 2 + size * 0.22
        if not overflow and align == "left":
            ax = left
        page.c.runs(ax, baseline, ln, align=align)
        cursor -= pitch


def _draw_cell(page: _Page, box, runs: list[Run], style: CellStyle, *, merged: bool) -> None:
    """A label or a value with the cell's own font, alignment and wrapping."""
    _p, x, y, w, h = box
    s = page.s
    room = w * s - 2 * PAD - style.indent * INDENT_PT * s
    k = s
    parts = _parts(runs, k)
    if style.wrap:
        lines = _wrap_parts(parts, room)
        # Shrink until the wrapped block fits the box height.
        while (
            len(lines) > 1
            and sum(max(p[2] for p in ln) * 1.15 for ln in lines) > h * s
            and min(r.size for r in runs) * k > MIN_SIZE
        ):
            k *= 0.92
            parts = _parts(runs, k)
            lines = _wrap_parts(parts, room)
        _draw_lines(page, box, lines, style, overflow=False)
        return
    single = list(parts)
    text_w = _width(single)
    # A merged box (or «shrink to fit») holds its text; a lone left-aligned
    # cell lets it run over its empty neighbours, as Excel does.
    if (merged or style.shrink or _align(style) != "left") and text_w > room > 0:
        k *= room / text_w
        single = _parts(runs, max(k, MIN_SIZE / max(r.size for r in runs)))
    _draw_lines(page, box, [single], style, overflow=True)


def _draw_text_area(page: _Page, box, text: str, style: CellStyle) -> None:
    _p, x, y, w, h = box
    s = page.s
    size, lines = fit_text(
        text,
        REGULAR,
        w * s - 2 * PAD,
        h * s - 2 * PAD,
        max_size=style.size * s,
        min_size=5.0,
        leading=1.2,
    )
    cursor = page.y(y) - PAD
    for line in lines:
        cursor -= size * 1.2
        page.c.text(page.x(x) + PAD, cursor + size * 0.22, line, font=REGULAR, size=size, rgb=BLACK)


def _draw_acceptance(page: _Page, box, text: str) -> None:
    _p, x, y, w, h = box
    s = page.s
    left, top = page.x(x), page.y(y)
    page.c.rect(left, top - h * s, w * s, h * s, fill=ACCEPT_FILL, stroke=ACCEPT_LINE, width=0.6)
    size, lines = fit_text(
        text, ITALIC, w * s - 16, h * s - 8, max_size=8.5, min_size=5.0, leading=1.25
    )
    block = len(lines) * size * 1.25
    cursor = top - (h * s - block) / 2
    for line in lines:
        cursor -= size * 1.25
        page.c.text(
            left + w * s / 2,
            cursor + size * 0.3,
            line,
            font=ITALIC,
            size=size,
            rgb=BLACK,
            align="center",
        )


# ── pages ────────────────────────────────────────────────────────────────
def build_pdf(sheet: FichaSheet, *, title: str = "Ficha de inscripción") -> bytes:
    """The ficha (``sheet``) as PDF bytes: always 3 Letter pages."""
    g = template.grid()
    scale = _scale(g)
    pages = [_Page(Canvas(), scale, g.width) for _ in cellmap.PAGES]

    for n, (x, y, w, h), rgb in g.fills:
        p = pages[n]
        p.c.rect(p.x(x), p.y(y + h), w * scale, h * scale, fill=rgb)
    for n, (x1, y1, x2, y2), width in g.borders:
        p = pages[n]
        p.c.line(p.x(x1), p.y(y1), p.x(x2), p.y(y2), BLACK, width * scale)

    logo = jpeg_image(template.logo_jpeg())
    if logo and g.logo:
        n, (x, y, w, h) = g.logo
        p = pages[n]
        p.c.image("Logo", p.x(x), p.y(y + h), w * scale, h * scale)

    values = sheet.cells()
    by_pos = {coordinate_to_tuple(coord): value for coord, value in values.items()}
    positions = set(g.labels) | set(by_pos)
    for r, c in sorted(positions):
        coord = f"{get_column_letter(c)}{r}"
        style = g.styles.get((r, c), CellStyle())
        box = g.box(coord)
        page = pages[box[0]]
        merged = (r, c) in g.merges
        if (r, c) in by_pos:
            value = by_pos[(r, c)]
            if coord == ACCEPTANCE:
                _draw_acceptance(page, box, str(value))
            elif coord in TEXT_AREAS:
                _draw_text_area(page, box, str(value), style)
            else:
                run = Run(str(value), style.bold, style.italic, style.size, style.rgb)
                _draw_cell(page, box, [run], style, merged=merged)
        else:
            _draw_cell(page, box, g.labels[(r, c)], style, merged=merged)

    total = len(pages)
    for n, p in enumerate(pages, start=1):
        p.c.text(SIDE, 18, FOOTER, font=REGULAR, size=7.5, rgb=MUTED)
        p.c.text(
            PAGE_W - SIDE,
            18,
            f"Página {n} de {total}",
            font=REGULAR,
            size=7.5,
            rgb=MUTED,
            align="right",
        )
    return assemble_pdf([p.c for p in pages], (PAGE_W, PAGE_H), logo=logo, title=title)
