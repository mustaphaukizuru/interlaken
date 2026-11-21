"""
admissions/ficha_export/pdf.py — the ficha as the school's form, on 3 Letter pages.

No PDF library: ``apps.core.pdf_document``'s canvas draws the template grid
(``template.grid()``) where Excel prints it: the same three pages (rows
1-45, 46-91, 92-137), margins, boxes, black bars, grey labels, borders and
logo, nothing added (no footer, no box for the acceptance). Each label and
each value takes its cell's own font, size, colour and alignment, laid out
the way Excel lays out a cell: centred, left, justified or indented, top,
centre or bottom, wrapped where the cell wraps, clipped to its box.

The fonts stand in for the form's, with the same metrics: Times New Roman
values → Times-Roman; Century Gothic (and the Neutra Text titles) → TeX
Gyre Adventor; Calibri → Carlito; the Symbol bullets → Symbol. The
electronic acceptance of the privacy notice goes to the Info dictionary
(Subject and Keywords), never on the page.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from openpyxl.utils import coordinate_to_tuple, get_column_letter

from apps.core.pdf_document import (
    ADVENTOR,
    ADVENTOR_BOLD,
    CARLITO,
    SYMBOL,
    TIMES,
    Canvas,
    assemble_pdf,
    jpeg_image,
    text_width,
)

from . import cellmap, template
from .data import FichaSheet
from .template import CellStyle, Run

PDF_CONTENT_TYPE = "application/pdf"
PAGE_W, PAGE_H = 612.0, 792.0  # Letter
BLACK = (0.0, 0.0, 0.0)

# How Excel lays a cell's text out in print (measured on its PDF export).
UNIT = 0.12  # its printer unit (1/600 in): font sizes and line boxes round to it
LEADING = 1.44  # added under every line of wrapped text
CENTER_SHIFT = 0.31  # a vertically centred line sits this much lower than the middle
SINGLE_CELL_SHIFT = 0.48  # … and 0.48 lower still in a cell that is not merged
CENTER_X = 0.42  # and a horizontally centred one this much right of it
BOTTOM_GAP = 1.6  # bottom-aligned text: last line box ends this far above the gridline
BOTTOM_GAP_LINE = 1.66  # the same for a single unwrapped line (whose box has no leading)
ROW_DESCENT = 3.14  # in a row flagged «thickBot», text sits at least this descent high
TOP_GAP = 0.87  # top-aligned text: from the gridline to the first ascender line
RIGHT_PAD = 0.94  # justified / right-aligned text stops this far from the right gridline
INDENT_STEP = 7.564  # one indent level
UNDERLINE = (1.08, 0.72)  # single underline: gap under the baseline, thickness (at 11 pt)

# The form's fonts → the PDF's, and the vertical metrics Excel lays them out
# with (Windows ascent / descent, per em).
FONT_KEYS = {
    "Century Gothic": (ADVENTOR, ADVENTOR_BOLD),
    "Neutra Text": (ADVENTOR, ADVENTOR_BOLD),
    "Times New Roman": (TIMES, TIMES),
    "Calibri": (CARLITO, CARLITO),
    "Symbol": (SYMBOL, SYMBOL),
}
V_METRICS = {
    "Century Gothic": ((1989 / 2048, 451 / 2048), (2032 / 2048, 451 / 2048)),
    "Neutra Text": ((1989 / 2048, 451 / 2048), (2032 / 2048, 451 / 2048)),
    "Times New Roman": ((1825 / 2048, 443 / 2048),) * 2,
    "Calibri": ((1950 / 2048, 550 / 2048),) * 2,
    "Symbol": ((2059 / 2048, 450 / 2048),) * 2,
}


def printed_size(size: float) -> float:
    """Excel prints 11 pt as 11.04 pt, 7 as 6.96: sizes round to its unit."""
    return round(size / UNIT) * UNIT


def _ceil_unit(v: float) -> float:
    return math.ceil(v / UNIT - 1e-6) * UNIT


def font_key(run: Run) -> str:
    regular, bold = FONT_KEYS.get(run.font, FONT_KEYS["Century Gothic"])
    return bold if run.bold else regular


def _v_metrics(run: Run) -> tuple[float, float]:
    """(ascent, descent) in points at the printed size."""
    pair = V_METRICS.get(run.font, V_METRICS["Century Gothic"])[1 if run.bold else 0]
    size = printed_size(run.size)
    return pair[0] * size, pair[1] * size


def run_width(text: str, run: Run) -> float:
    return text_width(text, font_key(run), printed_size(run.size))


def pad_left(size: float) -> float:
    """Excel's gap between a cell's left gridline and its text (grows with the size)."""
    return min(1.92, 0.36 + 0.16 * printed_size(size))


@dataclass
class Piece:
    """One run of text placed on a page (y measured down from the page top)."""

    text: str
    run: Run
    x: float
    baseline: float
    word_spacing: float = 0.0


@dataclass
class Placed:
    page: int
    pieces: list[Piece]
    clip: tuple[float, float] | None  # (x, width): the box's sides


# ── wrapping ─────────────────────────────────────────────────────────────
def _tokens(runs: list[Run]):
    """(text, run) words and spaces; «\\n» as a hard break (None)."""
    for run in runs:
        for n, line in enumerate(run.text.split("\n")):
            if n:
                yield None, run
            word = ""
            for ch in line:
                if ch == " ":
                    if word:
                        yield word, run
                        word = ""
                    yield " ", run
                else:
                    word += ch
            if word:
                yield word, run


def _merge(line: list[tuple[str, Run]]) -> list[tuple[str, Run]]:
    out: list[tuple[str, Run]] = []
    for text, run in line:
        if out and out[-1][1] == run:
            out[-1] = (out[-1][0] + text, run)
        else:
            out.append((text, run))
    return out


def wrap_runs(runs: list[Run], width: float) -> list[list[tuple[str, Run]]]:
    """Greedy word wrap over mixed runs: lines of (text, run); trailing spaces dropped."""
    lines: list[list[tuple[str, Run]]] = [[]]
    used = 0.0
    for text, run in _tokens(runs):
        if text is None:
            lines.append([])
            used = 0.0
            continue
        w = run_width(text, run)
        if text != " " and lines[-1] and used + w > width:
            while lines[-1] and lines[-1][-1][0] == " ":
                lines[-1].pop()
            lines.append([])
            used = 0.0
        if text == " " and not lines[-1]:
            continue
        lines[-1].append((text, run))
        used += w
    for line in lines:
        while line and line[-1][0] == " ":
            line.pop()
    return [_merge(line) for line in lines]


# ── one cell ─────────────────────────────────────────────────────────────
def _line_box(line, runs) -> tuple[float, float, float]:
    """(ascent, descent, height) of a line: its tallest run, rounded, plus leading."""
    sample = [run for _text, run in line] or runs[:1]
    asc = max(_v_metrics(r)[0] for r in sample)
    desc = max(_v_metrics(r)[1] for r in sample)
    return asc, desc, _ceil_unit(asc + desc) + LEADING


def place_cell(grid, coord: str, runs: list[Run], style: CellStyle, *, number=False) -> Placed:
    """Lay out ``runs`` in the box of ``coord`` the way Excel prints the cell."""
    page, x, y, w, h = grid.box(coord)
    r, c = coordinate_to_tuple(coord)
    merged = (r, c) in grid.merges
    left_pad = pad_left(max(run.size for run in runs))
    horizontal = style.horizontal or ("right" if number else "left")
    if style.wrap or horizontal == "justify":
        lines = wrap_runs(runs, w - left_pad - RIGHT_PAD)
    else:
        lines = [_merge([(t, run) for t, run in _tokens(runs) if t is not None])]
    boxes = [_line_box(line, runs) for line in lines]
    block = sum(b[2] for b in boxes)
    vertical = style.vertical or "bottom"
    if vertical == "top":
        top = y + TOP_GAP - LEADING
    elif vertical == "center" or vertical == "distributed":
        top = y + (h - block) / 2 + CENTER_SHIFT + (0 if merged else SINGLE_CELL_SHIFT)
    elif style.wrap or horizontal == "justify":
        top = y + h - BOTTOM_GAP - block
    else:
        asc, desc, _height = boxes[0]
        last_row = grid.merges.get((r, c), (r, c, r, c))[2]
        if last_row in grid.thick_bottom:
            desc = max(desc, ROW_DESCENT)
        top = y + h - BOTTOM_GAP_LINE - desc - asc
    pieces = []
    cursor = top
    for n, (line, (asc, _desc, height)) in enumerate(zip(lines, boxes, strict=True)):
        baseline = cursor + LEADING + asc if vertical == "top" else cursor + asc
        cursor += height
        widths = [run_width(text, run) for text, run in line]
        total = sum(widths)
        spacing = 0.0
        if horizontal == "justify" and n < len(lines) - 1:
            spaces = sum(text.count(" ") for text, _run in line)
            if spaces:
                spacing = (w - left_pad - RIGHT_PAD - total) / spaces
            px = x + left_pad
        elif horizontal in ("center", "centerContinuous", "distributed"):
            px = x + (w - total) / 2 + CENTER_X
        elif horizontal == "right":
            px = x + w - RIGHT_PAD - total
        else:  # left, general text, justify's last line, fill
            px = x + left_pad + style.indent * INDENT_STEP
        for (text, run), width in zip(line, widths, strict=True):
            pieces.append(Piece(text, run, px, baseline, spacing))
            px += width + spacing * text.count(" ")
    # A merged box keeps its text between its sides, as in Excel; a taller
    # accent (Adventor's «Ó» in a 14 pt title) is never cut at the top.
    clip = (x, min(w, grid.right - x)) if merged else None
    return Placed(page, pieces, clip)


def layout(grid, cells: dict[str, object]) -> list[Placed]:
    """Every label and value of the form, placed."""
    values = {coordinate_to_tuple(coord): value for coord, value in cells.items()}
    out = []
    for r, c in sorted(set(grid.labels) | set(values)):
        coord = f"{get_column_letter(c)}{r}"
        style = grid.styles.get((r, c), CellStyle())
        if (r, c) in values:
            value = values[(r, c)]
            if value is None or value == "":
                continue
            number = isinstance(value, (int, float)) and not isinstance(value, bool)
            runs = [style.run(_display(value))]
            out.append(place_cell(grid, coord, runs, style, number=number))
        else:
            out.append(place_cell(grid, coord, grid.labels[(r, c)], style))
    return out


def _display(value) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


# ── drawing ──────────────────────────────────────────────────────────────
def _draw_text(c: Canvas, placed: Placed) -> None:
    if placed.clip:
        x, w = placed.clip
        c.clip(x, 0, w, PAGE_H)
    for p in placed.pieces:
        size = printed_size(p.run.size)
        c.text(
            p.x,
            PAGE_H - p.baseline,
            p.text,
            font=font_key(p.run),
            size=size,
            rgb=p.run.rgb,
            word_spacing=p.word_spacing,
        )
        if p.run.underline and p.text.strip():
            offset, thickness = (v * size / 11 for v in UNDERLINE)
            width = run_width(p.text, p.run) + p.word_spacing * p.text.count(" ")
            c.rect(p.x, PAGE_H - p.baseline - offset - thickness, width, thickness, fill=p.run.rgb)
    if placed.clip:
        c.unclip()


def render(cells: dict[str, object], *, title: str, subject: str = "", keywords: str = "") -> bytes:
    """The form with ``cells`` ({"B10": "LÓPEZ", …}) as PDF bytes: 3 Letter pages."""
    g = template.grid()
    pages = [Canvas() for _ in cellmap.PAGES]
    # As Excel prints: fills, then borders, then the picture, then the text.
    for n, (x, y, w, h), rgb in g.fills:
        pages[n].rect(x, PAGE_H - y - h, w, h, fill=rgb)
    half = template.BORDER_WIDTH / 2
    for n, (x1, y1, x2, y2) in g.borders:
        if y1 == y2:  # horizontal: gridline to gridline
            pages[n].rect(x1, PAGE_H - y1 - half, x2 - x1, 2 * half, fill=BLACK)
        else:  # vertical: half a line past each end, so box corners are square
            pages[n].rect(x1 - half, PAGE_H - y2 - half, 2 * half, y2 - y1 + 2 * half, fill=BLACK)
    logo = jpeg_image(template.logo_jpeg())
    if logo and g.logo:
        n, (x, y, w, h) = g.logo
        pages[n].image("Logo", x, PAGE_H - y - h, w, h)
    for placed in layout(g, cells):
        _draw_text(pages[placed.page], placed)
    return assemble_pdf(
        pages,
        (PAGE_W, PAGE_H),
        logo=logo,
        title=title,
        fonts=sorted(set().union(*(c.fonts_used for c in pages))),
        subject=subject,
        keywords=keywords,
    )


def build_pdf(sheet: FichaSheet, *, title: str = "Ficha de inscripción") -> bytes:
    """The ficha (``sheet``) as PDF bytes; the acceptance in Subject / Keywords."""
    return render(sheet.cells(), title=title, subject=sheet.description, keywords=sheet.keywords)
