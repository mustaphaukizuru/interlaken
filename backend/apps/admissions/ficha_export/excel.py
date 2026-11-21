"""
admissions/ficha_export/excel.py — the ficha as the school's own Excel file.

The template is the school's 2021 workbook itself with only the personal
values removed (``test_ficha_template.py``). The export never re-saves it
through a spreadsheet library: every part of the package is copied as it is
and only the form's own value cells are written (``sheet1.xml`` and
``sharedStrings.xml``), so column widths, row heights, margins, merges,
fonts (the Symbol bullets included), fills, borders, alignments, the logo
and the print setup stay exactly the original's. A value takes its cell's
original font and alignment: a text too long for its box shows the way it
would in the school's own file.

The electronic acceptance of the privacy notice is not drawn on the form:
it goes to the workbook's document properties (Description, which Excel
shows as «Comentarios», and Keywords), as it goes to the PDF's Info
dictionary.
"""

from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from xml.sax.saxutils import escape

from . import template
from .data import FichaSheet

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

SHEET_PART = "xl/worksheets/sheet1.xml"
STRINGS_PART = "xl/sharedStrings.xml"
CORE_PART = "docProps/core.xml"

# A cell element of the sheet: <c r="B10" s="96"/> or <c r="B9" s="93" t="s"><v>4</v></c>.
CELL_XML = re.compile(
    r'<c r="(?P<ref>[A-Z]+[0-9]+)"(?P<attrs>(?: [a-z]+="[^"]*")*)(?:/>|>(?P<body>.*?)</c>)',
    re.S,
)
# Characters XML 1.0 cannot carry (a pasted control character would break the file).
_NOT_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff￾￿]")
# Excel reads «_x0041_» in a string as «A»: a literal one is written «_x005F_x0041_».
_EXCEL_ESCAPE = re.compile(r"_(x[0-9A-Fa-f]{4}_)")


def _xml_text(value: str) -> str:
    text = _NOT_XML.sub("", str(value).replace("\r\n", "\n").replace("\r", "\n"))
    return escape(_EXCEL_ESCAPE.sub(r"_x005F_\1", text))


def _string_item(text: str) -> str:
    space = ' xml:space="preserve"' if text != text.strip() or "\n" in text else ""
    return f"<si><t{space}>{_xml_text(text)}</t></si>"


def fill_cells(sheet_xml: str, strings_xml: str, cells: dict[str, object]) -> tuple[str, str]:
    """Write ``cells`` ({"B10": "LÓPEZ", "G20": 16}) into the sheet: numbers as
    numbers, text as shared strings, each cell keeping its own style.

    Only cells the template already holds can be written (every box of the
    form is a styled cell): an unknown coordinate is an error, never a new cell.
    """
    first = strings_xml.find("<si>")
    end = strings_xml.rfind("</sst>")
    head, tail = strings_xml[:first], strings_xml[end:]
    items = re.findall(r"<si>.*?</si>", strings_xml[first:end], re.S)
    added: list[str] = []
    found: set[str] = set()

    def put(m: re.Match) -> str:
        ref = m.group("ref")
        if ref not in cells:
            return m.group(0)
        found.add(ref)
        value = cells[ref]
        style = re.search(r' s="[0-9]+"', m.group("attrs"))
        s = style.group(0) if style else ""
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f'<c r="{ref}"{s}><v>{value!r}</v></c>'
        added.append(_string_item(str(value)))
        return f'<c r="{ref}"{s} t="s"><v>{len(items) + len(added) - 1}</v></c>'

    sheet_xml = CELL_XML.sub(put, sheet_xml)
    missing = set(cells) - found
    if missing:
        raise KeyError(f"Not a cell of the form: {', '.join(sorted(missing))}")
    every = items + added
    refs = len(re.findall(r'<c r="[A-Z]+[0-9]+"(?: [a-z]+="[^"]*")* t="s"', sheet_xml))
    head = re.sub(r' count="[0-9]+"', f' count="{refs}"', head, count=1)
    head = re.sub(r' uniqueCount="[0-9]+"', f' uniqueCount="{len(every)}"', head, count=1)
    return sheet_xml, head + "".join(every) + tail


def _core_properties(core_xml: str, *, description: str, keywords: str) -> str:
    extra = ""
    if description:
        extra += f"<dc:description>{_xml_text(description)}</dc:description>"
    if keywords:
        extra += f"<cp:keywords>{_xml_text(keywords)}</cp:keywords>"
    return core_xml.replace("</dc:title>", "</dc:title>" + extra, 1)


def build_workbook(cells: dict[str, object], *, description: str = "", keywords: str = "") -> bytes:
    """The template package with ``cells`` written and the document properties set."""
    out = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(template.template_bytes())) as src,
        zipfile.ZipFile(out, "w") as dst,
    ):
        parts = {info.filename: src.read(info) for info in src.infolist()}
        sheet_xml, strings_xml = fill_cells(
            parts[SHEET_PART].decode("utf-8"), parts[STRINGS_PART].decode("utf-8"), cells
        )
        parts[SHEET_PART] = sheet_xml.encode("utf-8")
        parts[STRINGS_PART] = strings_xml.encode("utf-8")
        core = parts[CORE_PART].decode("utf-8")
        parts[CORE_PART] = _core_properties(
            core, description=description, keywords=keywords
        ).encode("utf-8")
        for info in src.infolist():
            item = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            item.compress_type = info.compress_type
            item.external_attr = info.external_attr
            dst.writestr(item, parts[info.filename])
    return out.getvalue()


def build_xlsx(sheet: FichaSheet) -> bytes:
    """The filled ficha as an .xlsx file (bytes)."""
    return build_workbook(sheet.cells(), description=sheet.description, keywords=sheet.keywords)


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
