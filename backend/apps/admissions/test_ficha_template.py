"""
The «Ficha de inscripción» template IS the school's 2021 Excel form.

``ficha_export/ficha_inscripcion.xlsx`` is the original workbook with only
the personal values removed. ``ficha_fingerprint.json`` was derived from the
original (structure only: no value of the family that filled it): the
hashes of the parts that never change, the sheet's raw layout XML (columns,
rows, merges, margins), every cell's resolved format (font, size, bold,
fill, border, alignment, number format), the label texts with their rich-text
runs, the logo's anchor and the coordinates of the cleared value cells.

The template must match it exactly except the owner-approved changes:
«CURP MADRE» in the mother's block, «Ciclo Escolar» (the export writes the
student's cycle) and the privacy link; plus the print setup (print area
A1:AC137, Letter, no printer settings) and no hyperlinks. It must also hold
no personal data anywhere in the package.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from functools import cache
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.cell.rich_text import CellRichText

from apps.admissions.ficha_export import cellmap, template
from apps.core.pdf_document import jpeg_image

FINGERPRINT_PATH = Path(template.__file__).with_name("ficha_fingerprint.json")
OLD_LINK = "https://www.interlaken.com.mx/AvisoPrivacidad.pdf"
AVISO_URL = "https://interlaken.edu.mx/aviso-de-privacidad"
# Parts copied byte for byte from the original.
UNCHANGED_PARTS = (
    "xl/styles.xml",
    "xl/theme/theme1.xml",
    "xl/drawings/drawing1.xml",
    "xl/drawings/_rels/drawing1.xml.rels",
    "xl/media/image1.jpeg",
    "docProps/app.xml",
    "_rels/.rels",
    "xl/_rels/workbook.xml.rels",
)
# Raw sheet XML that holds the form's layout.
SHEET_TAGS = {
    "dimension": r"<dimension [^>]*/>",
    "sheetViews": r"<sheetViews>.*?</sheetViews>",
    "sheetFormatPr": r"<sheetFormatPr [^>]*/>",
    "cols": r"<cols>.*?</cols>",
    "mergeCells": r"<mergeCells [^>]*>.*?</mergeCells>",
    "pageMargins": r"<pageMargins [^>]*/>",
}
CURP_PATTERN = re.compile(rb"[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d")
PHONE_PATTERN = re.compile(rb"(?<!\d)\d{10}(?!\d)")


# ── the fingerprint (also how ficha_fingerprint.json was made) ───────────
def _plain(v):
    return v if v is None or isinstance(v, (bool, int, float)) else str(v)


def _color(c):
    if c is None:
        return None
    return [c.type, _plain(getattr(c, c.type)), c.tint]


def _font(f):
    """A cell's Font or a rich-text run's InlineFont (whose name is ``rFont``)."""
    if f is None:
        return None
    name = f.rFont if hasattr(f, "rFont") else f.name
    return [_plain(v) for v in (name, f.sz, bool(f.b), bool(f.i), f.u, f.charset, f.family)] + [
        _color(f.color)
    ]


def _style(cell) -> dict:
    b, a = cell.border, cell.alignment
    return {
        "font": _font(cell.font),
        "fill": [_plain(cell.fill.fill_type), _color(cell.fill.fgColor), _color(cell.fill.bgColor)],
        "border": {
            side: [_plain(getattr(b, side).style), _color(getattr(b, side).color)]
            for side in ("left", "right", "top", "bottom")
        },
        "alignment": [
            _plain(v)
            for v in (
                a.horizontal,
                a.vertical,
                bool(a.wrap_text),
                a.indent,
                bool(a.shrink_to_fit),
                a.text_rotation,
            )
        ],
        "number_format": _plain(cell.number_format),
    }


def _label(value) -> list:
    if isinstance(value, CellRichText):
        return [
            [part, None] if isinstance(part, str) else [part.text, _font(part.font)]
            for part in value
        ]
    return [[str(value), None]]


def fingerprint(xlsx: bytes, *, value_cells: set[str] | None = None) -> dict:
    """The structure of a ficha workbook. ``value_cells``: cells whose content
    is personal (only their coordinates are kept; default: none)."""
    value_cells = value_cells or set()
    zf = zipfile.ZipFile(io.BytesIO(xlsx))
    sheet_xml = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
    ws = load_workbook(io.BytesIO(xlsx), rich_text=True)[cellmap.SHEET]
    styles: list[dict] = []
    rows: dict[str, list] = {}
    labels: dict[str, list] = {}
    for row in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=ws.max_column):
        ids = []
        for cell in row:
            style = _style(cell)
            if style not in styles:
                styles.append(style)
            ids.append(styles.index(style))
            if cell.value is not None and cell.coordinate not in value_cells:
                labels[cell.coordinate] = _label(cell.value)
        rows[str(row[0].row)] = ids
    anchor = ws._images[0].anchor
    return {
        "parts_sha256": {
            name: hashlib.sha256(zf.read(name)).hexdigest() for name in UNCHANGED_PARTS
        },
        "sheet_xml": {
            key: re.search(pattern, sheet_xml, re.S).group(0) for key, pattern in SHEET_TAGS.items()
        },
        "row_tags": re.findall(r"<row [^>]*>", sheet_xml),
        "styles": styles,
        "cells": rows,
        "labels": labels,
        "value_cells": sorted(value_cells),
        "logo": {
            "from": [anchor._from.col, anchor._from.colOff, anchor._from.row, anchor._from.rowOff],
            "to": [anchor.to.col, anchor.to.colOff, anchor.to.row, anchor.to.rowOff],
        },
    }


@cache
def _original_json() -> str:
    return FINGERPRINT_PATH.read_text(encoding="utf-8")


@cache
def _template_json() -> str:
    return json.dumps(fingerprint(template.template_bytes()))


def _original() -> dict:
    return json.loads(_original_json())


def _template() -> dict:
    return json.loads(_template_json())


def _sheet():
    wb = load_workbook(io.BytesIO(template.template_bytes()), rich_text=True)
    return wb, wb[cellmap.SHEET]


def _sheet_xml() -> str:
    with zipfile.ZipFile(io.BytesIO(template.template_bytes())) as zf:
        return zf.read("xl/worksheets/sheet1.xml").decode("utf-8")


# ── the template is the original ─────────────────────────────────────────
def test_unchanged_parts_are_the_originals_byte_for_byte():
    """Styles (fonts, fills, borders, alignments), theme, logo and its anchor."""
    assert _template()["parts_sha256"] == _original()["parts_sha256"]


def test_sheet_layout_xml_is_the_originals():
    """Column widths, every row's height and flags, merges, margins, view."""
    tpl, orig = _template(), _original()
    assert tpl["sheet_xml"] == orig["sheet_xml"]
    assert tpl["row_tags"] == orig["row_tags"]
    assert len(orig["row_tags"]) == 144
    assert orig["sheet_xml"]["mergeCells"].startswith('<mergeCells count="194">')
    assert 'left="0.39370078740157483"' in orig["sheet_xml"]["pageMargins"]


def test_every_cell_keeps_its_original_format():
    tpl, orig = _template(), _original()

    def resolved(fp):
        return {row: [fp["styles"][i] for i in ids] for row, ids in fp["cells"].items()}

    assert resolved(tpl) == resolved(orig)


def test_labels_are_the_originals_except_the_approved_changes():
    orig_labels = _original()["labels"]
    approved = dict(orig_labels)
    approved["F3"] = [["Ciclo Escolar", None]]  # the export writes «Ciclo Escolar <ciclo>»
    approved["A80"] = [["CURP MADRE", None]]  # the 2021 form said «CURP PADRE» twice
    ((text, font),) = orig_labels["A104"]
    approved["A104"] = [[text.replace(OLD_LINK, AVISO_URL), font]]
    assert _template()["labels"] == approved
    assert orig_labels["F3"] == [["Ciclo Escolar 2022-2023", None]]
    assert orig_labels["A80"] == orig_labels["A59"] == [["CURP PADRE", None]]
    assert OLD_LINK in text
    assert "CALLE DE LA BOLA 34, RESIDENCIAL EL DORADO, TLALNEPANTLA" in orig_labels["A99"][0][0]


def test_bullets_keep_the_symbol_font():
    tpl = _template()
    runs = tpl["labels"]["A100"]
    assert runs[0] == ["·", None]  # the bullet takes the cell's font…
    assert tpl["styles"][tpl["cells"]["100"][0]]["font"][0] == "Symbol"  # …which is Symbol
    assert runs[1][1][0] == "Times New Roman" and runs[2][1][0] == "Century Gothic"


def test_logo_anchor_is_the_originals():
    assert _template()["logo"] == _original()["logo"]
    _wb, ws = _sheet()
    assert len(ws._images) == 1
    assert jpeg_image(template.logo_jpeg()) is not None


# ── the value cells ──────────────────────────────────────────────────────
def test_the_original_value_cells_are_empty_and_mapped():
    _wb, ws = _sheet()
    cleared = set(_original()["value_cells"])
    assert len(cleared) == 64
    assert cleared <= cellmap.value_cells()
    for coord in cleared:
        assert ws[coord].value is None, coord


def test_every_cell_the_export_writes_is_a_styled_cell_of_the_form():
    """The export never adds a cell: each target exists, styled, in the sheet."""
    present = set(re.findall(r'<c r="([A-Z]+[0-9]+)" s="[0-9]+"', _sheet_xml()))
    assert cellmap.value_cells() <= present
    labels = _template()["labels"]
    for coord in cellmap.value_cells() - set(cellmap.LABEL_CELLS.values()) - {"F3"}:
        assert coord not in labels, coord


# ── print setup ──────────────────────────────────────────────────────────
def test_print_setup_prints_the_three_original_pages():
    _wb, ws = _sheet()
    assert ws.print_area == "'Hoja1'!$A$1:$AC$137"
    assert cellmap.PRINT_AREA == "A1:AC137"
    assert int(ws.page_setup.paperSize) == 1  # Letter, as the original's printer settings
    assert ws.page_setup.orientation == "portrait"
    assert ws.page_setup.scale is None  # 100 %
    pr = ws.sheet_properties.pageSetUpPr
    assert pr is None or not pr.fitToPage
    assert not ws.row_breaks.brk and not ws.col_breaks.brk  # Excel's own page breaks
    assert cellmap.PAGES == ((1, 45), (46, 91), (92, 137))
    assert '<pageSetup paperSize="1" orientation="portrait"/>' in _sheet_xml()


# ── no personal data ─────────────────────────────────────────────────────
def test_no_links_comments_or_author():
    wb, ws = _sheet()
    assert not ws._hyperlinks and "<hyperlinks>" not in _sheet_xml()
    assert not any(c.comment for row in ws.iter_rows() for c in row if hasattr(c, "comment"))
    props = wb.properties
    assert props.creator == "Colegio Interlaken"
    assert props.lastModifiedBy == "Colegio Interlaken"
    assert props.lastPrinted is None
    assert not props.description and not props.subject and not props.keywords


def test_package_parts_carry_no_personal_traces():
    with zipfile.ZipFile(io.BytesIO(template.template_bytes())) as zf:
        names = zf.namelist()
        assert not [
            n for n in names if "printerSettings" in n or "comments" in n or "customXml" in n
        ]
        assert [n for n in names if n.startswith("xl/media/")] == ["xl/media/image1.jpeg"]
        for name in names:
            if not name.endswith((".xml", ".rels")):
                continue
            body = zf.read(name)
            assert b"absPath" not in body, name
            assert b"mailto:" not in body, name
            assert b"@" not in body, name
            assert not CURP_PATTERN.search(body), name
            assert not PHONE_PATTERN.search(body), name
        assert b"<Company></Company>" in zf.read("docProps/app.xml")
        strings = zf.read("xl/sharedStrings.xml").decode("utf-8")
    # Every shared string left is a label's: no orphan value text.
    used = {int(v) for v in re.findall(r' t="s"><v>([0-9]+)</v>', _sheet_xml())}
    assert used == set(range(strings.count("<si>")))


def test_fingerprint_holds_no_personal_data():
    orig = _original()
    raw = json.dumps({k: v for k, v in orig.items() if k != "parts_sha256"}).encode()
    assert b"@" not in raw and not CURP_PATTERN.search(raw) and not PHONE_PATTERN.search(raw)
    assert not set(orig["labels"]) & set(orig["value_cells"])
