"""
admissions/ficha_export/template.py — the school's Excel ficha and its printed geometry.

``ficha_inscripcion.xlsx`` is the school's 2021 workbook with only the
personal values removed (``test_ficha_template.py`` holds it to the
original's fingerprint). ``template_bytes()`` is the package ``excel.py``
fills; ``grid()`` reads it once into what the PDF needs to draw the same
form: every box, fill, border, label (with its fonts and alignment) and the
logo, placed where Excel prints them.

Excel prints a sheet a little larger than its nominal sizes: it rounds the
column widths, row heights and font sizes to its printer units. The numbers
below were measured on Excel's own PDF export of this workbook (Excel 2024,
Letter, 100 %), so the PDF's boxes land on Excel's to a few hundredths of a
point.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.cell.rich_text import CellRichText
from openpyxl.utils import coordinate_to_tuple

from . import cellmap

TEMPLATE_PATH = Path(__file__).with_name("ficha_inscripcion.xlsx")

# Excel's print of the sheet, in points from the page's top-left corner.
PRINT_ORIGIN = 28.8  # A1's top-left corner on every page (the sheet's 1 cm margins)
PRINT_COLUMN = 18.8434  # every column (the sheet's 3.285-character default width)
PRINT_ROW = {15.75: 15.843, 12.0: 12.0, 23.25: 23.43}  # row height → printed height
BORDER_WIDTH = 1.92  # a «medium» border (the only kind the form uses)
PICTURE_SHIFT = -0.48  # Excel draws the logo half a border up and left of its anchor
DEFAULT_ROW_HEIGHT = 15.75
EMU_PER_POINT = 12700
# The workbook's theme colours that its cells use.
THEME_RGB = {0: (1.0, 1.0, 1.0), 1: (0.0, 0.0, 0.0), 10: (0x05 / 255, 0x63 / 255, 0xC1 / 255)}


@cache
def template_bytes() -> bytes:
    return TEMPLATE_PATH.read_bytes()


def load():
    """The template as an openpyxl workbook (rich-text labels kept). Read only:
    the export never saves through openpyxl."""
    return load_workbook(io.BytesIO(template_bytes()), rich_text=True)


@cache
def logo_jpeg() -> bytes:
    """The official logo the form embeds (``xl/media/image1.jpeg``)."""
    with zipfile.ZipFile(io.BytesIO(template_bytes())) as zf:
        return zf.read("xl/media/image1.jpeg")


def rgb(color, *, default=(0.0, 0.0, 0.0)):
    """An openpyxl colour → (r, g, b) 0-1 (explicit RGB or the theme's)."""
    if color is None:
        return default
    if color.type == "rgb" and isinstance(color.rgb, str) and len(color.rgb) >= 6:
        h = color.rgb[-6:]
        return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    if color.type == "theme":
        return THEME_RGB.get(color.theme, default)
    return default


@dataclass(frozen=True)
class Run:
    """A piece of text in one font (a label's rich-text run, or a value)."""

    text: str
    font: str  # the workbook's font name: «Century Gothic», «Times New Roman»…
    size: float
    bold: bool = False
    italic: bool = False
    underline: bool = False
    rgb: tuple = (0.0, 0.0, 0.0)


@dataclass(frozen=True)
class CellStyle:
    font: str = "Calibri"
    size: float = 11.0
    bold: bool = False
    italic: bool = False
    underline: bool = False
    rgb: tuple = (0.0, 0.0, 0.0)
    horizontal: str | None = None
    vertical: str | None = None
    wrap: bool = False
    indent: int = 0

    def run(self, text: str) -> Run:
        return Run(
            str(text), self.font, self.size, self.bold, self.italic, self.underline, self.rgb
        )


@dataclass
class Grid:
    """The printed form: positions in points from the top-left of each page."""

    col_x: list[float]  # col_x[c] = left edge of column c (1-based), col_x[31] = right of AD
    row_y: dict[int, float]  # top of row r on its page
    row_h: dict[int, float]
    page_of: dict[int, int]  # row → page index (0-based)
    merges: dict[tuple[int, int], tuple[int, int, int, int]]  # top-left → (r1, c1, r2, c2)
    covered: set[tuple[int, int]]  # the other cells of a merge
    thick_bottom: set[int]  # rows Excel flags as having a bottom border (``thickBot``)
    styles: dict[tuple[int, int], CellStyle]
    labels: dict[tuple[int, int], list[Run]]
    fills: list[tuple[int, tuple[float, float, float, float], tuple]] = field(default_factory=list)
    # Border lines: (page, (x1, y1, x2, y2) along the gridline).
    borders: list[tuple[int, tuple[float, float, float, float]]] = field(default_factory=list)
    logo: tuple[int, tuple[float, float, float, float]] | None = None  # (page, (x, y, w, h))

    @property
    def right(self) -> float:
        """The right edge of the printed area (column AC)."""
        return self.col_x[cellmap.LAST_COLUMN + 1]

    def box(self, coord: str) -> tuple[int, float, float, float, float]:
        """``(page, x, y, w, h)`` of the cell or merged box starting at ``coord``."""
        r, c = coordinate_to_tuple(coord)
        r1, c1, r2, c2 = self.merges.get((r, c), (r, c, r, c))
        y = self.row_y[r1]
        h = self.row_y[r2] + self.row_h[r2] - y
        return self.page_of[r1], self.col_x[c1], y, self.col_x[c2 + 1] - self.col_x[c1], h


def cell_style(cell) -> CellStyle:
    f, a = cell.font, cell.alignment
    return CellStyle(
        font=f.name or "Calibri",
        size=float(f.sz or 11),
        bold=bool(f.b),
        italic=bool(f.i),
        underline=bool(f.u),
        rgb=rgb(f.color),
        horizontal=a.horizontal,
        vertical=a.vertical,
        wrap=bool(a.wrap_text),
        indent=int(a.indent or 0),
    )


def _runs(value, style: CellStyle) -> list[Run]:
    """A label's runs; a rich-text run without its own font takes the cell's."""
    if not isinstance(value, CellRichText):
        return [style.run(str(value))]
    out = []
    for part in value:
        if isinstance(part, str):
            out.append(style.run(part))
            continue
        ft = part.font
        out.append(
            Run(
                part.text,
                ft.rFont or style.font,
                float(ft.sz or style.size),
                bool(ft.b) if ft.b is not None else style.bold,
                bool(ft.i) if ft.i is not None else style.italic,
                bool(ft.u) if ft.u is not None else style.underline,
                rgb(ft.color, default=style.rgb),
            )
        )
    return out


def _join(segments) -> list[tuple[int, tuple[float, float, float, float]]]:
    """Collinear touching border pieces → one line each (shared sides drawn once)."""
    out = []
    for (page, axis, at), spans in segments.items():
        spans.sort()
        start, end = spans[0]
        for a, b in spans[1:] + [(None, None)]:
            if a is not None and a <= end + 0.01:
                end = max(end, b)
                continue
            out.append((page, (start, at, end, at) if axis == "h" else (at, start, at, end)))
            if a is not None:
                start, end = a, b
    return out


@cache
def grid() -> Grid:
    ws = load()[cellmap.SHEET]
    col_x = [0.0] + [PRINT_ORIGIN + c * PRINT_COLUMN for c in range(31)]
    row_y, row_h, page_of, thick_bottom = {}, {}, {}, set()
    for page, (first, last) in enumerate(cellmap.PAGES):
        y = PRINT_ORIGIN
        for r in range(first, last + 1):
            dim = ws.row_dimensions.get(r)
            nominal = float(dim.height) if dim is not None and dim.height else DEFAULT_ROW_HEIGHT
            h = PRINT_ROW.get(nominal, nominal)
            if dim is not None and dim.thickBot:
                thick_bottom.add(r)
            row_y[r], row_h[r], page_of[r] = y, h, page
            y += h

    merges, covered, member = {}, set(), {}
    for rng in ws.merged_cells.ranges:
        extent = (rng.min_row, rng.min_col, rng.max_row, rng.max_col)
        merges[(rng.min_row, rng.min_col)] = extent
        for r in range(rng.min_row, rng.max_row + 1):
            for c in range(rng.min_col, rng.max_col + 1):
                member[(r, c)] = extent
                if (r, c) != (rng.min_row, rng.min_col):
                    covered.add((r, c))

    g = Grid(
        col_x=col_x,
        row_y=row_y,
        row_h=row_h,
        page_of=page_of,
        merges=merges,
        covered=covered,
        thick_bottom=thick_bottom,
        styles={},
        labels={},
    )
    last_row = cellmap.PAGES[-1][1]
    segments: dict[tuple, list[tuple[float, float]]] = {}
    # Every column, AD included: a box that runs into AD prints up to the
    # edge of the printed area, as in Excel (its lines are cut there below).
    for row in ws.iter_rows(min_row=1, max_row=last_row, max_col=30):
        for cell in row:
            r, c = cell.row, cell.column
            x0, x1 = col_x[c], col_x[c + 1]
            y0, y1 = row_y[r], row_y[r] + row_h[r]
            page = page_of[r]
            r1, c1, r2, c2 = member.get((r, c), (r, c, r, c))
            # Inside a merged box only its outline prints (Excel ignores the
            # sides its cells share), so «APELLIDO PATERNO» shows no seams.
            for side, on_edge, key, span in (
                ("top", r == r1, ("h", y0), (x0, x1)),
                ("bottom", r == r2, ("h", y1), (x0, x1)),
                ("left", c == c1, ("v", x0), (y0, y1)),
                ("right", c == c2, ("v", x1), (y0, y1)),
            ):
                s = getattr(cell.border, side)
                if on_edge and s is not None and s.style:
                    segments.setdefault((page, *key), []).append(span)
            if (r, c) in covered:
                continue
            style = cell_style(cell)
            g.styles[(r, c)] = style
            fill = cell.fill
            if fill is not None and fill.fill_type == "solid":
                color = rgb(fill.fgColor, default=None)
                if color is not None and color != (1.0, 1.0, 1.0):
                    _, bx, by, bw, bh = g.box(cell.coordinate)
                    g.fills.append((page, (bx, by, bw, bh), color))
            if cell.value not in (None, ""):
                g.labels[(r, c)] = _runs(cell.value, style)
    # Nothing prints right of column AC (the e-mail boxes run on into AD).
    right = g.right
    for page, (x1, y1, x2, y2) in _join(segments):
        if x1 > right + 0.01:
            continue
        g.borders.append((page, (x1, y1, min(x2, right), y2)))
    g.fills = [(p, (x, y, min(w, right - x), h), c) for p, (x, y, w, h), c in g.fills]

    if ws._images:
        anchor = ws._images[0].anchor
        frm, to = anchor._from, anchor.to
        x = col_x[frm.col + 1] + frm.colOff / EMU_PER_POINT
        y = row_y[frm.row + 1] + frm.rowOff / EMU_PER_POINT
        w = col_x[to.col + 1] + to.colOff / EMU_PER_POINT - x
        h = row_y[to.row + 1] + to.rowOff / EMU_PER_POINT - y
        g.logo = (page_of[frm.row + 1], (x + PICTURE_SHIFT, y + PICTURE_SHIFT, w, h))
    return g
