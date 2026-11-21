"""
admissions/ficha_export/template.py — the anonymised Excel ficha and its grid.

``ficha_inscripcion.xlsx`` is the school's 2021 form with every personal value
removed (``test_ficha_template.py`` proves it holds labels only). ``load()``
opens a fresh copy to fill; ``grid()`` reads it once into plain geometry and
styles (column / row sizes in points, merged boxes, fills, borders, fonts,
alignment, the logo) so the PDF builder can draw the same form without
opening the workbook again.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.cell.rich_text import CellRichText
from openpyxl.utils import coordinate_to_tuple, get_column_letter

from . import cellmap

TEMPLATE_PATH = Path(__file__).with_name("ficha_inscripcion.xlsx")

# Excel prints this template's columns (3.285 width units, its default) 18 pt
# wide (measured with Excel's Columns.Width): 30 columns A:AD = 540 pt.
POINTS_PER_WIDTH_UNIT = 18.0 / 3.28515625
DEFAULT_ROW_HEIGHT = 15.75
EMU_PER_POINT = 12700
# Excel's border weights, in points.
BORDER_WIDTHS = {
    "hair": 0.25,
    "thin": 0.5,
    "dotted": 0.5,
    "dashed": 0.5,
    "medium": 1.0,
    "mediumDashed": 1.0,
    "double": 1.2,
    "thick": 1.5,
}


@cache
def template_bytes() -> bytes:
    return TEMPLATE_PATH.read_bytes()


def load():
    """A fresh workbook from the template (rich-text labels kept)."""
    return load_workbook(io.BytesIO(template_bytes()), rich_text=True)


@cache
def logo_jpeg() -> bytes:
    """The official logo the form embeds (``xl/media/image1.jpeg``)."""
    with zipfile.ZipFile(io.BytesIO(template_bytes())) as zf:
        return zf.read("xl/media/image1.jpeg")


def _rgb(color, *, default=None):
    """An openpyxl colour → (r, g, b) 0-1; theme 0 (white) / 1 (black) only."""
    if color is None:
        return default
    if color.type == "rgb" and isinstance(color.rgb, str) and len(color.rgb) >= 6:
        h = color.rgb[-6:]
        return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    if color.type == "theme":
        return {0: (1.0, 1.0, 1.0), 1: (0.0, 0.0, 0.0)}.get(color.theme, default)
    return default


@dataclass(frozen=True)
class Run:
    text: str
    bold: bool
    italic: bool
    size: float
    rgb: tuple


@dataclass(frozen=True)
class CellStyle:
    bold: bool = False
    italic: bool = False
    size: float = 11.0
    rgb: tuple = (0.0, 0.0, 0.0)
    horizontal: str | None = None
    vertical: str | None = None
    wrap: bool = False
    shrink: bool = False
    indent: float = 0.0


@dataclass
class Grid:
    """The template as geometry, in sheet points (origin: A1's top-left corner)."""

    col_x: list[float]  # col_x[c] = left edge of column c (1-based); col_x[31] = right edge of AD
    row_y: dict[int, float]  # row_y[r] = top of row r, from the top of its page
    row_h: dict[int, float]
    page_of: dict[int, int]  # row → page index (0-based)
    page_heights: list[float]
    merges: dict[tuple[int, int], tuple[int, int, int, int]]  # top-left → (r1, c1, r2, c2)
    covered: set[tuple[int, int]]  # cells inside a merge, other than its top-left
    styles: dict[tuple[int, int], CellStyle]
    labels: dict[tuple[int, int], list[Run]]
    fills: list[tuple[int, tuple[float, float, float, float], tuple]] = field(default_factory=list)
    borders: list[tuple[int, tuple[float, float, float, float], float]] = field(
        default_factory=list
    )
    logo: tuple[int, tuple[float, float, float, float]] | None = None  # (page, (x, y_top, w, h))

    @property
    def width(self) -> float:
        return self.col_x[cellmap.LAST_COLUMN + 1]

    def box(self, coord: str) -> tuple[int, float, float, float, float]:
        """``(page, x, y_top, w, h)`` of the cell or merged box starting at ``coord``."""
        r, c = coordinate_to_tuple(coord)
        r1, c1, r2, c2 = self.merges.get((r, c), (r, c, r, c))
        y = self.row_y[r1]
        h = self.row_y[r2] + self.row_h[r2] - y
        return self.page_of[r1], self.col_x[c1], y, self.col_x[c2 + 1] - self.col_x[c1], h


def _style(cell) -> CellStyle:
    f, a = cell.font, cell.alignment
    return CellStyle(
        bold=bool(f.b),
        italic=bool(f.i),
        size=float(f.sz or 11),
        rgb=_rgb(f.color, default=(0.0, 0.0, 0.0)),
        horizontal=a.horizontal,
        vertical=a.vertical,
        wrap=bool(a.wrap_text),
        shrink=bool(a.shrink_to_fit),
        indent=float(a.indent or 0),
    )


def _runs(value, style: CellStyle) -> list[Run]:
    if isinstance(value, CellRichText):
        out = []
        for part in value:
            if isinstance(part, str):
                out.append(Run(part, style.bold, style.italic, style.size, style.rgb))
            else:
                ft = part.font
                out.append(
                    Run(
                        part.text,
                        bool(ft.b) if ft.b is not None else style.bold,
                        bool(ft.i) if ft.i is not None else style.italic,
                        float(ft.sz or style.size),
                        _rgb(ft.color, default=style.rgb),
                    )
                )
        return out
    return [Run(str(value), style.bold, style.italic, style.size, style.rgb)]


def _join(segments) -> list[tuple[int, tuple[float, float, float, float], float]]:
    """Collinear touching border pieces → one line each (shared sides drawn once)."""
    out = []
    for (page, axis, at, width), spans in segments.items():
        spans.sort()
        start, end = spans[0]
        for a, b in spans[1:] + [(None, None)]:
            if a is not None and a <= end + 0.01:
                end = max(end, b)
                continue
            seg = (start, at, end, at) if axis == "h" else (at, start, at, end)
            out.append((page, seg, width))
            if a is not None:
                start, end = a, b
    return out


@cache
def grid() -> Grid:
    wb = load()
    ws = wb[cellmap.SHEET]
    last_col = cellmap.LAST_COLUMN
    col_x = [0.0, 0.0]
    for c in range(1, last_col + 1):
        dim = ws.column_dimensions.get(get_column_letter(c))
        width = dim.width if dim is not None and dim.width else ws.sheet_format.defaultColWidth
        col_x.append(col_x[-1] + float(width) * POINTS_PER_WIDTH_UNIT)

    row_y, row_h, page_of, heights = {}, {}, {}, []
    for page, (first, last) in enumerate(cellmap.PAGES):
        y = 0.0
        for r in range(first, last + 1):
            dim = ws.row_dimensions.get(r)
            h = float(dim.height) if dim is not None and dim.height else DEFAULT_ROW_HEIGHT
            row_y[r], row_h[r], page_of[r] = y, h, page
            y += h
        heights.append(y)

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
        page_heights=heights,
        merges=merges,
        covered=covered,
        styles={},
        labels={},
    )
    last_row = cellmap.PAGES[-1][1]
    segments: dict[tuple, list[tuple[float, float]]] = {}
    for row in ws.iter_rows(min_row=1, max_row=last_row, max_col=last_col):
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
                    width = BORDER_WIDTHS.get(s.style, 0.5)
                    segments.setdefault((page, *key, width), []).append(span)
            if (r, c) in covered:
                continue
            style = _style(cell)
            g.styles[(r, c)] = style
            fill = cell.fill
            if fill is not None and fill.fill_type == "solid":
                rgb = _rgb(fill.fgColor)
                if rgb is not None and rgb != (1.0, 1.0, 1.0):
                    _, bx, by, bw, bh = g.box(cell.coordinate)
                    g.fills.append((page, (bx, by, bw, bh), rgb))
            if cell.value not in (None, ""):
                g.labels[(r, c)] = _runs(cell.value, style)

    g.borders = _join(segments)

    if ws._images:
        anchor = ws._images[0].anchor
        frm = anchor._from
        x = col_x[frm.col + 1] + frm.colOff / EMU_PER_POINT
        y = row_y[frm.row + 1] + frm.rowOff / EMU_PER_POINT
        to = getattr(anchor, "to", None)
        if to is not None:
            w = col_x[to.col + 1] + to.colOff / EMU_PER_POINT - x
            h = row_y[to.row + 1] + to.rowOff / EMU_PER_POINT - y
        else:
            w, h = anchor.ext.width / EMU_PER_POINT, anchor.ext.height / EMU_PER_POINT
        g.logo = (page_of[frm.row + 1], (x, y, w, h))
    return g
