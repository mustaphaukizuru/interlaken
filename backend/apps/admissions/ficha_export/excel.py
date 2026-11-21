"""
admissions/ficha_export/excel.py — the ficha as the school's own Excel file.

The anonymised template is filled cell by cell from ``data.FichaSheet``:
logo, merged boxes, fills, borders and the print setup (Letter, 1 page wide,
3 pages) stay exactly as the template has them. Long free text (allergies,
chronic conditions) shrinks, and is cut with «…» only when even 6 pt cannot
hold it, so nothing spills over the printed box.
"""

from __future__ import annotations

import io
import re
import unicodedata
from copy import copy

from apps.core.pdf_document import REGULAR, fit_text

from . import cellmap, template
from .data import FichaSheet

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Free-text boxes: (max font size, min font size). Their width/height come
# from the template grid; Helvetica metrics stand in for Times New Roman
# (wider, so the estimate errs on the safe side).
TEXT_AREAS = {
    cellmap.CELLS["salud.alergias_cuales"]: (9.0, 6.0),
    cellmap.CELLS["salud.enfermedades"]: (9.0, 6.0),
}
PADDING = 3.0


def fitted_text(coord: str, text: str) -> tuple[float, str]:
    """``(font size, text)`` that fits the template box at ``coord``."""
    max_size, min_size = TEXT_AREAS[coord]
    _page, _x, _y, w, h = template.grid().box(coord)
    # Excel wraps the text itself (its own metrics, its own cell padding):
    # estimate with a narrower box and a generous line pitch.
    size, lines = fit_text(
        text,
        REGULAR,
        w - 2 * PADDING - 8,
        h - PADDING,
        max_size=max_size,
        min_size=min_size,
        leading=1.4,
    )
    if lines and lines[-1].endswith("…") and not text.endswith("…"):
        return size, " ".join(lines)
    return size, text


def _write(cell, value) -> None:
    cell.value = value
    if isinstance(value, str) and cell.data_type == "f":
        # openpyxl stores text starting with «=» as a live formula; a family
        # typed it, so it stays text.
        cell.data_type = "s"


def build_xlsx(sheet: FichaSheet) -> bytes:
    """The filled workbook as bytes."""
    wb = template.load()
    ws = wb[cellmap.SHEET]
    for coord, value in sheet.cells().items():
        cell = ws[coord]
        if coord in TEXT_AREAS and isinstance(value, str):
            size, value = fitted_text(coord, value)
            font = copy(cell.font)
            font.sz = size
            cell.font = font
        _write(cell, value)
    props = wb.properties
    props.creator = "Colegio Interlaken"
    props.lastModifiedBy = "Colegio Interlaken"
    props.title = "Ficha de inscripción"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def ascii_part(text: str) -> str:
    """«Ana Sofía» → «Ana-Sofia» (letters, digits and hyphens only)."""
    folded = unicodedata.normalize("NFKD", str(text or ""))
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    words = re.findall(r"[A-Za-z0-9]+", folded)
    return "-".join(words)


def ficha_filename(sheet: FichaSheet, ext: str, *, fallback: str = "") -> str:
    """``Ficha_<ApellidoPaterno>_<Nombre>_<ciclo>.<ext>``, ASCII-safe; never the CURP."""
    parts = [
        ascii_part(sheet.child_paternal),
        ascii_part(sheet.child_given),
        ascii_part(sheet.ciclo),
    ]
    parts = [p for p in parts if p]
    if not parts and fallback:
        parts = [ascii_part(fallback)]
    return "_".join(["Ficha", *parts]) + f".{ext}"
