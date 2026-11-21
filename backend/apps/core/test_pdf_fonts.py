"""
apps.core.pdf_document — the fonts beyond Helvetica (for the ficha de inscripción):
Times-Roman and Symbol (standard), TeX Gyre Adventor (embedded CFF) and
Carlito (embedded TrueType subset), each with the metrics of the font it
stands in for; and the Info dictionary's Subject / Keywords.

Documents that ask for nothing (receipts, statements) keep the Helvetica
family only, byte for byte as before.
"""

import os
import re
import struct
import zlib

from apps.core import pdf_document
from apps.core.pdf_document import (
    ADVENTOR,
    ADVENTOR_BOLD,
    CARLITO,
    REGULAR,
    SYMBOL,
    TIMES,
    Canvas,
    assemble_pdf,
    embedded_font,
    text_width,
)
from apps.core.test_pdf_document import assert_well_formed, has_text


def _widths(key, chars):
    return [round(text_width(ch, key, 1000)) for ch in chars]


def test_adventor_has_avant_gardes_widths_which_century_gothic_shares():
    # Adobe's ITC Avant Garde Gothic Book / Demi AFM widths (Century Gothic
    # was drawn to the same metrics).
    assert _widths(ADVENTOR, ' !"#$aAoW') == [277, 295, 309, 554, 554, 683, 740, 655, 960]
    assert _widths(ADVENTOR_BOLD, ' !"#$') == [280, 280, 360, 560, 560]


def test_carlito_has_calibris_widths():
    # Calibri's advances (1/2048 em) in 1/1000 em.
    assert _widths(CARLITO, "a ") == [round(981 * 1000 / 2048), round(463 * 1000 / 2048)]


def test_times_and_symbol_metrics():
    assert _widths(TIMES, " aAMW·±") == [250, 444, 722, 889, 944, 250, 564]
    assert _widths(SYMBOL, "·") == [460]  # Symbol's bullet (code 0xB7)
    # Outside WinAnsi a character prints as «?» and measures as one.
    assert text_width("ő", TIMES, 10) == text_width("?", TIMES, 10)


def test_truetype_subset_keeps_only_the_winansi_glyphs_and_is_consistent():
    font = embedded_font(CARLITO)
    assert not font.cff
    cff, tables = pdf_document._sfnt_tables(font.program)
    assert not cff
    assert set(tables) == set(pdf_document._TRUETYPE_TABLES)
    head = tables["head"]
    assert struct.unpack(">h", head[50:52])[0] == 1  # long loca
    count = struct.unpack(">H", tables["maxp"][4:6])[0]
    loca = struct.unpack(f">{count + 1}I", tables["loca"])
    glyphs = pdf_document._cmap_lookup(tables["cmap"], [ord("A"), ord("ñ"), 0x0416])
    a = glyphs[ord("A")]
    assert loca[a + 1] > loca[a]  # «A» keeps its outline
    zhe = glyphs[0x0416]  # Cyrillic Ж: not WinAnsi, dropped
    assert loca[zhe + 1] == loca[zhe]
    assert (
        len(font.program)
        < os.path.getsize(os.path.join(pdf_document.FONTS_DIR, "Carlito-Regular.ttf")) / 5
    )
    # The whole file sums to the sfnt magic number.
    assert pdf_document._checksum(font.program) == 0xB1B0AFBA


def test_cff_fonts_embed_their_cff_table():
    for key in (ADVENTOR, ADVENTOR_BOLD):
        font = embedded_font(key)
        assert font.cff and font.program[:1] == b"\x01"  # CFF header, major version 1
        assert font.ascent > 0 > font.descent and font.cap_height > 0


def test_fonts_ship_with_their_licences():
    names = set(os.listdir(pdf_document.FONTS_DIR))
    assert {"GUST-FONT-LICENSE.txt", "OFL-Carlito.txt", "README.txt"} <= names
    for spec in pdf_document.EMBEDDED_FONTS.values():
        assert spec.filename in names


def _font_dicts(content: bytes) -> list[bytes]:
    return re.findall(rb"<< /Type /Font .*?>>", content)


def test_assemble_embeds_the_fonts_the_pages_use():
    c = Canvas()
    c.text(40, 700, "Ficha de inscripción", font=ADVENTOR_BOLD, size=12)
    c.text(40, 680, "Asalariado", font=CARLITO, size=11)
    c.text(40, 660, "LÓPEZ", font=TIMES, size=10)
    c.text(40, 640, "·", font=SYMBOL, size=6)
    c.text(60, 640, "Llevar a cabo", font=ADVENTOR, size=6, word_spacing=1.5)
    assert c.fonts_used == {ADVENTOR, ADVENTOR_BOLD, CARLITO, TIMES, SYMBOL}
    content = assemble_pdf([c], (612, 792), title="Prueba", fonts=sorted(c.fonts_used))
    assert assert_well_formed(content) == 1
    fonts = _font_dicts(content)
    assert len(fonts) == 5
    assert b"/BaseFont /Times-Roman /Encoding /WinAnsiEncoding" in content
    assert b"/BaseFont /Symbol >>" in content
    assert b"/Subtype /TrueType /BaseFont /IKFICH+Carlito" in content
    assert content.count(b"/Subtype /Type1C") == 2
    assert b"/FontFile2" in content and b"/Length1 " in content
    assert b" Tw " in content  # justified word spacing
    assert has_text(content, "Ficha de inscripción") and has_text(content, "LÓPEZ")
    # Every embedded program inflates to what was measured.
    for m in re.finditer(rb"/Length (\d+) /Filter /FlateDecode[^>]*>>\nstream\n", content):
        data = content[m.end() : m.end() + int(m.group(1))]
        assert zlib.decompress(data)


def test_documents_that_ask_for_nothing_keep_helvetica_only():
    c = Canvas()
    c.text(40, 700, "Comprobante", font=REGULAR, size=10)
    content = assemble_pdf([c], (612, 792), title="Recibo")
    fonts = _font_dicts(content)
    assert [re.search(rb"/BaseFont /([\w-]+)", f).group(1) for f in fonts] == [
        b"Helvetica",
        b"Helvetica-Bold",
        b"Helvetica-Oblique",
    ]
    assert b"FontFile" not in content and b" Tw " not in content
    assert b"/Subject" not in content and b"/Keywords" not in content


def test_info_subject_and_keywords_take_any_text():
    content = assemble_pdf(
        [Canvas()], (612, 792), title="Ficha", subject="Aceptado por Zoë · ő", keywords="a; b"
    )
    m = re.search(rb"/Subject <FEFF([0-9A-F]+)>", content)
    assert bytes.fromhex(m.group(1).decode()).decode("utf-16-be") == "Aceptado por Zoë · ő"
    assert b"/Keywords <FEFF" in content
