"""
admissions/ficha_export/files.py — the downloadable files: one ficha, the
blank form, and a ZIP of several fichas (≤ ``ZIP_CAP`` per request).
"""

from __future__ import annotations

import io
import zipfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from functools import cache

from django.utils import timezone

from . import data
from .excel import XLSX_CONTENT_TYPE, build_xlsx, ficha_filename
from .pdf import PDF_CONTENT_TYPE, build_pdf

FORMATS = ("xlsx", "pdf")
CONTENT_TYPES = {"xlsx": XLSX_CONTENT_TYPE, "pdf": PDF_CONTENT_TYPE}
ZIP_CONTENT_TYPE = "application/zip"
ZIP_CAP = 50
BLANK_STEM = "Ficha_de_inscripcion_en_blanco"


@dataclass(frozen=True)
class FichaFile:
    content: bytes
    filename: str
    content_type: str


def render(sheet: data.FichaSheet, fmt: str) -> bytes:
    if fmt == "xlsx":
        return build_xlsx(sheet)
    name = " ".join(x for x in (sheet.child_given, sheet.child_paternal) if x)
    title = f"Ficha de inscripción · {name}" if name else "Ficha de inscripción"
    return build_pdf(sheet, title=title)


def ficha_file(reg, fmt: str, *, medical_ok: bool, guardians: dict | None = None) -> FichaFile:
    sheet = data.ficha_sheet(reg, medical_ok=medical_ok, guardians=guardians)
    return FichaFile(
        content=render(sheet, fmt),
        filename=ficha_filename(sheet, fmt, fallback=f"inscripcion {reg.pk}"),
        content_type=CONTENT_TYPES[fmt],
    )


@cache
def blank_file(fmt: str) -> FichaFile:
    """The form with nothing filled in (the same for everyone: built once)."""
    return FichaFile(
        content=render(data.blank_sheet(), fmt),
        filename=f"{BLANK_STEM}.{fmt}",
        content_type=CONTENT_TYPES[fmt],
    )


def zip_fichas(regs: Iterable, fmt: str, *, medical_ok: Callable[[object], bool]) -> FichaFile:
    """One file per registration (same name twice → «_<id>» added)."""
    buf = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for reg in regs:
            item = ficha_file(reg, fmt, medical_ok=medical_ok(reg))
            name = item.filename
            if name in used:
                stem, ext = name.rsplit(".", 1)
                name = f"{stem}_{reg.pk}.{ext}"
            used.add(name)
            zf.writestr(name, item.content)
    stamp = timezone.localdate().strftime("%Y%m%d")
    return FichaFile(buf.getvalue(), f"Fichas_de_inscripcion_{stamp}_{fmt}.zip", ZIP_CONTENT_TYPE)
