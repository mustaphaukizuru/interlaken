"""
core/pdf_document.py — branded, dependency-free PDF documents (receipts, statements).

``core/pdf.py`` writes plain text lines; this module lays out a designed page
with the same hand-rolled approach (no PDF library ships in the image or CI):

* a brand band and the official logo (a baseline JPEG embedded with
  DCTDecode; text fallback when the file is missing),
* the document title, its reference (folio) and a status pill,
* a summary of the key amounts, an info block of label/value pairs,
* a table with right-aligned amounts, alternating rows and a header row
  repeated on every page, a totals box, notes,
* a footer with the school name, the generation time and «Página X de Y».

Text is set in the standard Helvetica family with WinAnsiEncoding (cp1252),
so Spanish accents, «», ° and the peso sign render; anything outside cp1252
becomes «?». Widths come from the Helvetica metrics below, which is what
right alignment, wrapping and ellipsis rely on.

Public API::

    doc = Document(title='Comprobante de pago', reference='Folio 812', ...)
    pdf_bytes = render_document_pdf(doc)
    doc.text_lines()   # the document's facts as plain «Etiqueta: valor» lines
"""
from __future__ import annotations

import functools
import os
import re
import struct
import unicodedata
import zlib
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from django.utils import timezone

# ── Dates on documents ───────────────────────────────────────────────────────
SCHOOL_TZ = ZoneInfo('America/Mexico_City')
_MONTHS_SHORT = ('ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic')


def short_datetime(dt) -> str:
    """«18 nov 2026, 13:47»: the console tables' short form (es-MX month,
    24-hour clock), always in Mexico City time whatever the server's zone.
    '' for None, so a missing date never prints «None»."""
    if not dt:
        return ''
    local = timezone.localtime(dt, SCHOOL_TZ) if timezone.is_aware(dt) else dt
    return f'{local.day} {_MONTHS_SHORT[local.month - 1]} {local.year}, {local:%H:%M}'


# ── Page sizes (points) ──────────────────────────────────────────────────────
PAGE_SIZES = {'letter': (612.0, 792.0), 'a4': (595.28, 841.89)}

# ── Brand palette (RGB 0-1) — mirrors frontend/tailwind.config.js ────────────
def _hex(h: str) -> tuple[float, float, float]:
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


PURPLE = _hex('#401a8e')
PURPLE_LIGHT = _hex('#ede8f7')
PINK = _hex('#e01a4e')
GREEN = _hex('#47a028')
INK = _hex('#1A1130')
MUTED = _hex('#6E6885')
LINE = _hex('#ECEAF3')
CREAM = _hex('#F5F4FA')
CREAM_2 = _hex('#FAF9FD')
WHITE = (1.0, 1.0, 1.0)

TONES = {
    # tone: (background, text)
    'success': (_hex('#eef7e9'), _hex('#316f1c')),
    'warning': (_hex('#fdf1e4'), _hex('#b45309')),
    'error': (_hex('#fdecec'), _hex('#a11816')),
    'neutral': (CREAM, MUTED),
    'info': (PURPLE_LIGHT, PURPLE),
}

LOGO_PATH = os.path.join(os.path.dirname(__file__), 'pdf_assets', 'logo-horizontal.jpg')

# ── Helvetica metrics (AFM widths, 1/1000 em) ───────────────────────────────
_ASCII = ''.join(chr(c) for c in range(32, 127))
_HELV = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
_HELV_BOLD = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]
_WIDTHS = {
    'F1': dict(zip(_ASCII, _HELV, strict=True)),
    'F2': dict(zip(_ASCII, _HELV_BOLD, strict=True)),
    'F3': dict(zip(_ASCII, _HELV, strict=True)),          # Helvetica-Oblique shares Helvetica's widths
}
_SYMBOLS = {
    '°': 400, '·': 278, '«': 556, '»': 556, '¿': 611, '¡': 333, '–': 556, '—': 1000,
    '•': 350, '‘': 222, '’': 222, '“': 333, '”': 333, '€': 556, '×': 584, '…': 1000,
    'º': 365, 'ª': 370, '±': 584, '©': 737, '®': 737, ' ': 278,
}
FONTS = {'F1': 'Helvetica', 'F2': 'Helvetica-Bold', 'F3': 'Helvetica-Oblique'}
REGULAR, BOLD, ITALIC = 'F1', 'F2', 'F3'

# ── More fonts (the ficha de inscripción) ───────────────────────────────────
# The ficha draws the school's Excel form with stand-ins for the fonts it was
# made with, each with the same metrics: Times New Roman → the standard
# Times-Roman; Century Gothic → TeX Gyre Adventor and Calibri → Carlito, both
# free fonts embedded from ``core/fonts`` (see its README.txt for the
# licences); Symbol → the standard Symbol (the bullets). Documents that do
# not ask for them (receipts, statements) keep the Helvetica family only.
TIMES, SYMBOL = 'F4', 'F5'
ADVENTOR, ADVENTOR_BOLD, CARLITO = 'F6', 'F7', 'F8'
FONTS_DIR = os.path.join(os.path.dirname(__file__), 'fonts')
STANDARD_FONTS = {**FONTS, TIMES: 'Times-Roman', SYMBOL: 'Symbol'}


@dataclass(frozen=True)
class FontFile:
    filename: str
    postscript_name: str
    stem_v: int                     # FontDescriptor /StemV (no table holds it)


EMBEDDED_FONTS = {
    ADVENTOR: FontFile('texgyreadventor-regular.otf', 'TeXGyreAdventor-Regular', 84),
    ADVENTOR_BOLD: FontFile('texgyreadventor-bold.otf', 'TeXGyreAdventor-Bold', 140),
    CARLITO: FontFile('Carlito-Regular.ttf', 'Carlito', 80),
}

# Times-Roman (Adobe AFM) widths of the WinAnsi codes 32-255 (0 = no character).
_TIMES_WINANSI = (
    250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
    921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
    556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
    333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500,
    500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541, 0,
    500, 0, 333, 500, 444, 1000, 500, 500, 333, 1000, 556, 333, 889, 0, 611, 0,
    0, 333, 333, 444, 444, 350, 500, 1000, 333, 980, 389, 333, 722, 0, 444, 722,
    250, 333, 500, 500, 500, 500, 200, 500, 333, 760, 276, 500, 564, 333, 760, 500,
    400, 564, 300, 300, 333, 500, 453, 250, 333, 300, 310, 500, 750, 750, 750, 444,
    722, 722, 722, 722, 722, 722, 889, 667, 611, 611, 611, 611, 333, 333, 333, 333,
    722, 722, 722, 722, 722, 722, 722, 564, 722, 722, 722, 722, 722, 722, 556, 500,
    444, 444, 444, 444, 444, 444, 667, 444, 444, 444, 444, 444, 278, 278, 278, 278,
    500, 500, 500, 500, 500, 500, 500, 564, 500, 500, 500, 500, 500, 500, 500, 500,
)
# Symbol (built-in encoding): code 0xB7 is its bullet.
_SYMBOL_WIDTHS = {' ': 250, '·': 460}
_WINANSI = tuple(bytes([c]).decode('cp1252', 'ignore') for c in range(32, 256))


def _winansi_code(ch: str) -> int:
    """The byte a character becomes in a content stream (``_enc``: «?» if none)."""
    return ch.encode('cp1252', 'replace')[0]


def _extra_width(ch: str, font: str) -> int:
    if font == SYMBOL:
        return _SYMBOL_WIDTHS.get(ch, 500)
    code = _winansi_code(ch)
    if code < 32:
        return 0
    widths = _TIMES_WINANSI if font == TIMES else embedded_font(font).widths
    return widths[code - 32]


def _char_width(ch: str, font: str) -> int:
    if font not in _WIDTHS:
        return _extra_width(ch, font)
    table = _WIDTHS[font]
    if ch in table:
        return table[ch]
    if ch in _SYMBOLS:
        return _SYMBOLS[ch]
    base = unicodedata.normalize('NFD', ch)[:1]   # «á» measures as «a»
    return table.get(base, 556)


def text_width(text: str, font: str = REGULAR, size: float = 10) -> float:
    return sum(_char_width(c, font) for c in str(text)) * size / 1000


def ellipsize(text: str, font: str, size: float, max_width: float) -> str:
    text = str(text)
    if text_width(text, font, size) <= max_width:
        return text
    while text and text_width(text + '…', font, size) > max_width:
        text = text[:-1]
    return text.rstrip() + '…'


def wrap(text: str, font: str, size: float, max_width: float) -> list[str]:
    """Greedy word wrap; a word longer than the line is cut to fit."""
    out: list[str] = []
    for para in str(text).split('\n'):
        line = ''
        for word in para.split():
            candidate = f'{line} {word}'.strip()
            if text_width(candidate, font, size) <= max_width:
                line = candidate
                continue
            if line:
                out.append(line)
            while text_width(word, font, size) > max_width:
                cut = len(word)
                while cut > 1 and text_width(word[:cut], font, size) > max_width:
                    cut -= 1
                out.append(word[:cut])
                word = word[cut:]
            line = word
        out.append(line)
    return out


def fit_text(text: str, font: str, width: float, height: float, *, max_size: float,
             min_size: float = 5.0, leading: float = 1.2, step: float = 0.5) -> tuple[float, list[str]]:
    """Shrink-to-fit word wrap inside a ``width`` × ``height`` box.

    Tries ``max_size`` down to ``min_size`` (by ``step``) and returns
    ``(size, lines)`` for the first size whose wrapped lines fit; at
    ``min_size`` the lines that do not fit are dropped and the last kept line
    ends in «…». Line pitch is ``size * leading``.
    """
    text = str(text or '').strip()
    if not text:
        return max_size, []
    size = max_size
    while True:
        lines = [ln for ln in wrap(text, font, size, width) if ln] or ['']
        if len(lines) * size * leading <= height or size - step < min_size:
            break
        size -= step
    room = max(int(height // (size * leading)), 1)
    if len(lines) > room:
        lines = lines[:room]
        lines[-1] = ellipsize(lines[-1] + '…', font, size, width) if lines[-1] else '…'
    return size, lines


# ── Document model ──────────────────────────────────────────────────────────
@dataclass
class Column:
    header: str
    width: float = 0              # points; 0 = share the remaining width
    align: str = 'left'           # 'left' | 'right'
    strong: bool = False          # bold cells (the amount column)


@dataclass
class Row:
    cells: list[str]
    muted: bool = False           # history-only rows: listed, never counted


@dataclass
class Table:
    columns: list[Column]
    rows: list[Row]
    empty_text: str = 'Sin movimientos en el periodo.'


@dataclass
class Document:
    title: str
    reference: str = ''                                   # «Folio 812»
    subtitle: str = ''                                    # «Portal de Familias»
    status: tuple[str, str] | None = None                 # («Pagado», 'success')
    summary: list[tuple[str, str]] = field(default_factory=list)   # big amounts
    summary_note: str = ''                                # small line under the summary
    info: list[tuple[str, str]] = field(default_factory=list)      # label/value pairs
    table: Table | None = None
    totals: list[tuple[str, str]] = field(default_factory=list)    # last row is emphasised
    notes: list[str] = field(default_factory=list)
    footer: str = 'Colegio Interlaken'
    page_size: str = 'letter'
    generated_at: object = None                           # aware datetime; default now

    def text_lines(self) -> list[str]:
        """Every fact on the page as plain text, top to bottom (tests, logs, accessibility)."""
        lines = [self.title]
        lines += [x for x in (self.reference, self.subtitle) if x]
        if self.status:
            lines.append(f'Estado del documento: {self.status[0]}')
        lines += [f'{k}: {v}' for k, v in self.summary]
        if self.summary_note:
            lines.append(self.summary_note)
        lines += [f'{k}: {v}' for k, v in self.info]
        if self.table is not None:
            lines.append('  '.join(c.header for c in self.table.columns))
            lines += ['  '.join(r.cells) for r in self.table.rows] or [self.table.empty_text]
        lines += [f'{k}: {v}' for k, v in self.totals]
        lines += list(self.notes)
        return lines


# ── PDF primitives ──────────────────────────────────────────────────────────
def _enc(text: str) -> bytes:
    """A PDF string literal body in WinAnsi (cp1252); only \\ ( ) and line breaks escaped."""
    raw = str(text).encode('cp1252', 'replace')
    out = bytearray()
    for b in raw:
        if b in (0x5C, 0x28, 0x29):
            out += b'\\' + bytes([b])
        elif b in (0x0A, 0x0D):
            out += b' '
        else:
            out.append(b)
    return bytes(out)


def _f(v: float) -> str:
    return f'{v:.2f}'.rstrip('0').rstrip('.') if v != int(v) else str(int(v))


class _Canvas:
    """Content-stream builder for one page (origin bottom-left, points)."""

    def __init__(self):
        self.ops: list[bytes] = []
        self.fonts_used: set[str] = set()

    def _op(self, s: str):
        self.ops.append(s.encode('latin-1'))

    def fill(self, rgb):
        self._op('{} {} {} rg'.format(*(_f(c) for c in rgb)))

    def stroke(self, rgb):
        self._op('{} {} {} RG'.format(*(_f(c) for c in rgb)))

    def rect(self, x, y, w, h, *, fill=None, stroke=None, width=0.6, radius=0.0):
        if fill is not None:
            self.fill(fill)
        if stroke is not None:
            self.stroke(stroke)
            self._op(f'{_f(width)} w')
        if radius:
            r = min(radius, w / 2, h / 2)
            k = 0.5523 * r
            self._op(
                f'{_f(x + r)} {_f(y)} m {_f(x + w - r)} {_f(y)} l '
                f'{_f(x + w - r + k)} {_f(y)} {_f(x + w)} {_f(y + r - k)} {_f(x + w)} {_f(y + r)} c '
                f'{_f(x + w)} {_f(y + h - r)} l '
                f'{_f(x + w)} {_f(y + h - r + k)} {_f(x + w - r + k)} {_f(y + h)} {_f(x + w - r)} {_f(y + h)} c '
                f'{_f(x + r)} {_f(y + h)} l '
                f'{_f(x + r - k)} {_f(y + h)} {_f(x)} {_f(y + h - r + k)} {_f(x)} {_f(y + h - r)} c '
                f'{_f(x)} {_f(y + r)} l '
                f'{_f(x)} {_f(y + r - k)} {_f(x + r - k)} {_f(y)} {_f(x + r)} {_f(y)} c h'
            )
        else:
            self._op(f'{_f(x)} {_f(y)} {_f(w)} {_f(h)} re')
        self._op('B' if fill is not None and stroke is not None else 'f' if fill is not None else 'S')

    def line(self, x1, y1, x2, y2, rgb=LINE, width=0.6):
        self.stroke(rgb)
        self._op(f'{_f(width)} w {_f(x1)} {_f(y1)} m {_f(x2)} {_f(y2)} l S')

    def text(self, x, y, s, *, font=REGULAR, size=10.0, rgb=INK, align='left', spacing=0.0,
             word_spacing=0.0):
        if not s:
            return
        w = text_width(s, font, size) + spacing * max(len(str(s)) - 1, 0)
        w += word_spacing * str(s).count(' ')
        if align == 'right':
            x -= w
        elif align == 'center':
            x -= w / 2
        self.fill(rgb)
        self.fonts_used.add(font)
        tw = f'{_f(word_spacing)} Tw ' if word_spacing else ''
        head = f'BT /{font} {_f(size)} Tf {_f(spacing)} Tc {tw}1 0 0 1 {_f(x)} {_f(y)} Tm ('.encode('latin-1')
        self.ops.append(head + _enc(s) + b') Tj ET')

    def clip(self, x, y, w, h):
        """Start drawing inside the ``x, y, w, h`` rectangle only (until ``unclip``)."""
        self._op(f'q {_f(x)} {_f(y)} {_f(w)} {_f(h)} re W n')

    def unclip(self):
        self._op('Q')

    def image(self, name, x, y, w, h):
        self._op(f'q {_f(w)} 0 0 {_f(h)} {_f(x)} {_f(y)} cm /{name} Do Q')

    def runs(self, x, y, parts, *, align='left'):
        """One line of mixed runs ``[(text, font, size, rgb), ...]`` on one
        baseline («Celular» bold 9 pt + «(10 dígitos)» bold 7 pt)."""
        total = sum(text_width(t, f, s) for t, f, s, _ in parts)
        if align == 'right':
            x -= total
        elif align == 'center':
            x -= total / 2
        for t, f, s, rgb in parts:
            self.text(x, y, t, font=f, size=s, rgb=rgb)
            x += text_width(t, f, s)

    def stream(self) -> bytes:
        return b'\n'.join(self.ops)


# Public name for documents laid out outside this module (the ficha de
# inscripción draws the school's Excel grid with it).
Canvas = _Canvas


def jpeg_image(data: bytes):
    """``(data, (width, height, components))`` for an embeddable JPEG, else None."""
    size = _jpeg_size(data or b'')
    if not size or size[2] not in (1, 3):
        return None
    return data, size


def _jpeg_size(data: bytes) -> tuple[int, int, int] | None:
    """(width, height, components) from a baseline/progressive JPEG's SOF marker."""
    if data[:2] != b'\xff\xd8':
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h = int.from_bytes(data[i + 5:i + 7], 'big')
            w = int.from_bytes(data[i + 7:i + 9], 'big')
            return w, h, data[i + 9]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        i += 2 + int.from_bytes(data[i + 2:i + 4], 'big')
    return None


def _load_logo():
    try:
        with open(LOGO_PATH, 'rb') as fh:
            data = fh.read()
    except OSError:
        return None
    size = _jpeg_size(data)
    if not size or size[2] not in (1, 3):
        return None
    return data, size


# ── Embedded font files (sfnt: TrueType or OpenType-CFF) ────────────────────
# A small reader for what a PDF simple font needs: the advance widths of the
# WinAnsi characters (cmap + hmtx), the descriptor metrics (head, hhea, OS/2,
# post) and the font program. A CFF font goes in as its bare 'CFF ' table
# (FontFile3 /Type1C, glyphs found by name); a TrueType font as a subset that
# keeps only the WinAnsi glyphs (FontFile2, glyph ids unchanged), so a PDF
# carries a few dozen KB per font instead of the whole file.
@dataclass(frozen=True)
class EmbeddedFont:
    postscript_name: str
    cff: bool
    program: bytes                       # the font program, uncompressed
    widths: tuple[int, ...]              # WinAnsi codes 32-255, 1/1000 em
    bbox: tuple[int, int, int, int]
    ascent: int
    descent: int
    cap_height: int
    italic_angle: float
    stem_v: int


def _sfnt_tables(data: bytes) -> tuple[bool, dict[str, bytes]]:
    version, count = data[:4], struct.unpack('>H', data[4:6])[0]
    tables = {}
    for i in range(count):
        tag, _checksum, offset, length = struct.unpack('>4sIII', data[12 + 16 * i:28 + 16 * i])
        tables[tag.decode('latin-1')] = data[offset:offset + length]
    return version == b'OTTO', tables


def _cmap_lookup(cmap: bytes, codepoints) -> dict[int, int]:
    """Unicode → glyph id from the Windows Unicode BMP (format 4) subtable."""
    count = struct.unpack('>H', cmap[2:4])[0]
    sub = None
    for i in range(count):
        platform, encoding, offset = struct.unpack('>HHI', cmap[4 + 8 * i:12 + 8 * i])
        if (platform, encoding) in ((3, 1), (0, 3)) and struct.unpack('>H', cmap[offset:offset + 2])[0] == 4:
            sub = offset
            break
    if sub is None:
        raise ValueError('The font has no Unicode BMP (format 4) cmap.')
    seg = struct.unpack('>H', cmap[sub + 6:sub + 8])[0] // 2
    ends_at = sub + 14
    starts_at = ends_at + 2 * seg + 2
    deltas_at = starts_at + 2 * seg
    ranges_at = deltas_at + 2 * seg

    def u16(pos):
        return struct.unpack('>H', cmap[pos:pos + 2])[0]

    out = {}
    for cp in codepoints:
        for i in range(seg):
            end = u16(ends_at + 2 * i)
            if cp > end:
                continue
            start = u16(starts_at + 2 * i)
            if cp < start:
                break
            delta, offset = u16(deltas_at + 2 * i), u16(ranges_at + 2 * i)
            if offset == 0:
                gid = (cp + delta) & 0xFFFF
            else:
                gid = u16(ranges_at + 2 * i + offset + 2 * (cp - start))
                gid = (gid + delta) & 0xFFFF if gid else 0
            if gid:
                out[cp] = gid
            break
    return out


def _composite_parts(glyph: bytes) -> list[int]:
    """Glyph ids a composite TrueType glyph is built from."""
    if len(glyph) < 10 or struct.unpack('>h', glyph[:2])[0] >= 0:
        return []
    parts, pos = [], 10
    while True:
        flags, gid = struct.unpack('>HH', glyph[pos:pos + 4])
        parts.append(gid)
        pos += 4 + (4 if flags & 0x0001 else 2)
        pos += 2 if flags & 0x0008 else 4 if flags & 0x0040 else 8 if flags & 0x0080 else 0
        if not flags & 0x0020:
            return parts


def _checksum(data: bytes) -> int:
    data += b'\0' * (-len(data) % 4)
    return sum(struct.unpack(f'>{len(data) // 4}I', data)) & 0xFFFFFFFF


def _build_sfnt(tables: dict[str, bytes]) -> bytes:
    tags = sorted(tables)
    count = len(tags)
    power = 1 << (count.bit_length() - 1)
    header = struct.pack('>IHHHH', 0x00010000, count, power * 16, power.bit_length() - 1,
                         count * 16 - power * 16)
    offset = 12 + 16 * count
    records, body = b'', b''
    for tag in tags:
        data = tables[tag]
        records += struct.pack('>4sIII', tag.encode('latin-1'), _checksum(data), offset + len(body), len(data))
        body += data + b'\0' * (-len(data) % 4)
    font = bytearray(header + records + body)
    head_at = 12 + 16 * count + sum(len(tables[t]) + (-len(tables[t]) % 4) for t in tags[:tags.index('head')])
    struct.pack_into('>I', font, head_at + 8, (0xB1B0AFBA - _checksum(bytes(font))) & 0xFFFFFFFF)
    return bytes(font)


# The tables a PDF viewer needs from an embedded TrueType font.
_TRUETYPE_TABLES = ('OS/2', 'cmap', 'cvt ', 'fpgm', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'prep')


def _truetype_subset(tables: dict[str, bytes], keep: set[int]) -> bytes:
    """The font with only the ``keep`` glyphs' outlines (ids unchanged)."""
    head, glyf = tables['head'], tables['glyf']
    count = struct.unpack('>H', tables['maxp'][4:6])[0]
    if struct.unpack('>h', head[50:52])[0]:
        offsets = struct.unpack(f'>{count + 1}I', tables['loca'][:4 * (count + 1)])
    else:
        offsets = tuple(2 * o for o in struct.unpack(f'>{count + 1}H', tables['loca'][:2 * (count + 1)]))
    keep = set(keep) | {0}
    todo = list(keep)
    while todo:
        gid = todo.pop()
        for part in _composite_parts(glyf[offsets[gid]:offsets[gid + 1]]):
            if part not in keep:
                keep.add(part)
                todo.append(part)
    outlines, loca = bytearray(), []
    for gid in range(count):
        loca.append(len(outlines))
        if gid in keep:
            outlines += glyf[offsets[gid]:offsets[gid + 1]]
            outlines += b'\0' * (-len(outlines) % 4)
    loca.append(len(outlines))
    new = {tag: tables[tag] for tag in _TRUETYPE_TABLES if tag in tables}
    new['glyf'] = bytes(outlines)
    new['loca'] = struct.pack(f'>{count + 1}I', *loca)
    new['head'] = head[:8] + b'\0\0\0\0' + head[12:50] + struct.pack('>h', 1) + head[52:]
    return _build_sfnt(new)


@functools.cache
def embedded_font(key: str) -> EmbeddedFont:
    """The ``EMBEDDED_FONTS`` font ``key``, read once: WinAnsi widths and program."""
    spec = EMBEDDED_FONTS[key]
    with open(os.path.join(FONTS_DIR, spec.filename), 'rb') as fh:
        cff, tables = _sfnt_tables(fh.read())
    head, hhea = tables['head'], tables['hhea']
    upm = struct.unpack('>H', head[18:20])[0]
    metrics = struct.unpack('>H', hhea[34:36])[0]
    advances = struct.unpack('>' + 'Hh' * metrics, tables['hmtx'][:4 * metrics])[0::2]
    glyphs = _cmap_lookup(tables['cmap'], {ord(ch) for ch in _WINANSI if ch})

    def scale(v):
        return round(v * 1000 / upm)

    widths = tuple(
        scale(advances[min(glyphs[ord(ch)], metrics - 1)]) if ch and ord(ch) in glyphs else 0
        for ch in _WINANSI
    )
    ascent, descent = struct.unpack('>hh', hhea[4:8])
    os2 = tables['OS/2']
    cap = struct.unpack('>h', os2[88:90])[0] if struct.unpack('>H', os2[:2])[0] >= 2 else ascent
    italic = struct.unpack('>i', tables['post'][4:8])[0] / 65536
    program = tables['CFF '] if cff else _truetype_subset(tables, set(glyphs.values()))
    return EmbeddedFont(
        postscript_name=spec.postscript_name,
        cff=cff,
        program=program,
        widths=widths,
        bbox=tuple(scale(v) for v in struct.unpack('>4h', head[36:44])),
        ascent=scale(ascent),
        descent=scale(descent),
        cap_height=scale(cap),
        italic_angle=italic,
        stem_v=spec.stem_v,
    )


# ── Layout ──────────────────────────────────────────────────────────────────
MARGIN = 48.0
FOOTER_H = 34.0


class _Layout:
    def __init__(self, doc: Document):
        self.doc = doc
        self.pw, self.ph = PAGE_SIZES.get(doc.page_size, PAGE_SIZES['letter'])
        self.left, self.right = MARGIN, self.pw - MARGIN
        self.width = self.right - self.left
        self.bottom = MARGIN + FOOTER_H
        self.logo = _load_logo()
        self.pages: list[_Canvas] = []
        self.y = 0.0
        self.new_page()

    # Pages
    def new_page(self):
        c = _Canvas()
        self.pages.append(c)
        self.c = c
        first = len(self.pages) == 1
        self._band(c)
        if first:
            self.y = self._header(c)
        else:
            self.y = self._continuation_header(c)

    def ensure(self, height: float):
        if self.y - height < self.bottom:
            self.new_page()

    def _band(self, c: _Canvas):
        # Brand triad along the top edge: purple, then pink and green accents.
        h = 7.0
        c.rect(0, self.ph - h, self.pw * 0.70, h, fill=PURPLE)
        c.rect(self.pw * 0.70, self.ph - h, self.pw * 0.17, h, fill=PINK)
        c.rect(self.pw * 0.87, self.ph - h, self.pw * 0.13, h, fill=GREEN)

    def _logo(self, c: _Canvas, x: float, top: float, width: float) -> float:
        if self.logo:
            data, (w, h, _) = self.logo
            height = width * h / w
            c.image('Logo', x, top - height, width, height)
            return height
        c.text(x, top - 16, 'COLEGIO', font=REGULAR, size=11, rgb=GREEN, spacing=2.2)
        c.text(x, top - 32, 'INTERLAKEN', font=BOLD, size=16, rgb=GREEN, spacing=1.6)
        return 36.0

    def _header(self, c: _Canvas) -> float:
        d = self.doc
        top = self.ph - 30
        logo_h = self._logo(c, self.left - 4, top, 156)
        # Title block, right-aligned.
        room = self.width - 176                     # never over the logo
        c.text(self.right, top - 18, ellipsize(d.title, BOLD, 19, room), font=BOLD, size=19, rgb=INK, align='right')
        y = top - 34
        if d.reference:
            c.text(self.right, y, ellipsize(d.reference, BOLD, 10.5, room), font=BOLD, size=10.5, rgb=PURPLE, align='right')
            y -= 14
        if d.subtitle:
            c.text(self.right, y, ellipsize(d.subtitle, REGULAR, 9.5, room), font=REGULAR, size=9.5, rgb=MUTED, align='right')
            y -= 14
        bottom = min(top - logo_h, y) - 12
        c.line(self.left, bottom, self.right, bottom, LINE, 0.8)
        return bottom - 20

    def _continuation_header(self, c: _Canvas) -> float:
        d = self.doc
        top = self.ph - 28
        c.text(self.left, top - 10, 'Colegio Interlaken', font=BOLD, size=10, rgb=PURPLE)
        label = ' · '.join(x for x in (d.title, d.reference or d.subtitle) if x)
        c.text(self.right, top - 10, label, font=REGULAR, size=9, rgb=MUTED, align='right')
        c.line(self.left, top - 20, self.right, top - 20, LINE, 0.8)
        return top - 40

    # Blocks
    def summary(self):
        d = self.doc
        if not d.summary and not d.status:
            return
        height = 66.0 if not d.summary_note else 80.0
        self.ensure(height + 16)
        top = self.y
        c = self.c
        c.rect(self.left, top - height, self.width, height, fill=CREAM, radius=10)
        c.rect(self.left, top - height, 4, height, fill=PURPLE)
        n = max(len(d.summary), 1)
        status_w = 150.0 if d.status else 0.0
        col_w = (self.width - 24 - status_w) / n
        for i, (label, value) in enumerate(d.summary):
            x = self.left + 20 + i * col_w
            c.text(x, top - 22, label.upper(), font=BOLD, size=7.5, rgb=MUTED, spacing=0.6)
            size = 21.0 if i == n - 1 else 17.0
            value = ellipsize(value, BOLD, size, col_w - 12)
            c.text(x, top - 47, value, font=BOLD, size=size, rgb=INK if i == n - 1 else MUTED)
        if d.summary_note:
            c.text(self.left + 20, top - height + 12, d.summary_note, font=REGULAR, size=8.5, rgb=MUTED)
        if d.status:
            text, tone = d.status
            bg, fg = TONES.get(tone, TONES['neutral'])
            label = text.upper()
            pill_w = text_width(label, BOLD, 9.5) + 0.8 * (len(label) - 1) + 28
            px = self.right - 18 - pill_w
            py = top - height / 2 - 11
            c.rect(px, py, pill_w, 22, fill=bg, radius=11)
            c.rect(px + 11, py + 8, 6, 6, fill=fg, radius=3)
            c.text(px + 21, py + 7.5, label, font=BOLD, size=9.5, rgb=fg, spacing=0.8)
        self.y = top - height - 22

    def info(self):
        rows = self.doc.info
        if not rows:
            return
        gap = 24.0
        col_w = (self.width - gap) / 2
        self.ensure(26 + 34)                      # the heading never sits alone at a page end
        self.heading('Datos')
        pairs = [rows[i:i + 2] for i in range(0, len(rows), 2)]
        for pair in pairs:
            wrapped = [wrap(v or '-', REGULAR, 10, col_w) for _, v in pair]
            lines = max(len(w) for w in wrapped)
            h = 13 + 13 * lines + 8
            self.ensure(h)
            for j, ((label, _), vlines) in enumerate(zip(pair, wrapped, strict=True)):
                x = self.left + j * (col_w + gap)
                self.c.text(x, self.y - 8, label.upper(), font=BOLD, size=7.2, rgb=MUTED, spacing=0.5)
                for k, line in enumerate(vlines):
                    self.c.text(x, self.y - 22 - 13 * k, line, font=REGULAR, size=10, rgb=INK)
            self.y -= h
        self.y -= 10

    def heading(self, text: str):
        self.ensure(26)
        self.c.text(self.left, self.y - 9, text.upper(), font=BOLD, size=8, rgb=PURPLE, spacing=1.0)
        self.c.line(self.left, self.y - 15, self.right, self.y - 15, LINE, 0.6)
        self.y -= 26

    def _table_header(self, cols, xs, widths):
        h = 22.0
        top = self.y
        self.c.rect(self.left, top - h, self.width, h, fill=PURPLE_LIGHT, radius=4)
        for col, x, w in zip(cols, xs, widths, strict=True):
            tx = x + w - 8 if col.align == 'right' else x + 8
            self.c.text(tx, top - 14.5, col.header.upper(), font=BOLD, size=7.5, rgb=PURPLE,
                        align='right' if col.align == 'right' else 'left', spacing=0.5)
        self.y = top - h

    def table(self, heading: str = 'Movimientos'):
        t = self.doc.table
        if t is None:
            return
        cols = t.columns
        fixed = sum(c.width for c in cols if c.width)
        flex = [c for c in cols if not c.width]
        share = max((self.width - fixed) / len(flex), 40) if flex else 0
        widths = [c.width or share for c in cols]
        xs, x = [], self.left
        for w in widths:
            xs.append(x)
            x += w
        row_h, size = 18.0, 8.6
        self.ensure(26 + 22 + row_h)              # heading + header row + one row stay together
        self.heading(heading)
        self._table_header(cols, xs, widths)
        if not t.rows:
            self.c.text(self.left + 8, self.y - 13, t.empty_text, font=ITALIC, size=9, rgb=MUTED)
            self.y -= row_h + 6
        for i, row in enumerate(t.rows):
            if self.y - row_h < self.bottom:
                self.new_page()
                self._table_header(cols, xs, widths)
            top = self.y
            if i % 2 == 1:
                self.c.rect(self.left, top - row_h, self.width, row_h, fill=CREAM_2)
            font = ITALIC if row.muted else REGULAR
            rgb = MUTED if row.muted else INK
            for j, (col, cx, w) in enumerate(zip(cols, xs, widths, strict=True)):
                cell = row.cells[j] if j < len(row.cells) else ''
                cell_font = BOLD if (col.strong and not row.muted) else font
                text = ellipsize(cell, cell_font, size, w - 16)
                tx = cx + w - 8 if col.align == 'right' else cx + 8
                self.c.text(tx, top - 12.2, text, font=cell_font, size=size, rgb=rgb,
                            align='right' if col.align == 'right' else 'left')
            self.y = top - row_h
        self.c.line(self.left, self.y, self.right, self.y, LINE, 0.8)
        self.y -= 18

    def totals(self):
        rows = self.doc.totals
        if not rows:
            return
        row_h = 17.0
        box_w = 250.0
        h = 14 + row_h * len(rows) + (13 if len(rows) > 1 else 4)
        self.ensure(h)
        x = self.right - box_w
        top = self.y
        self.c.rect(x, top - h, box_w, h, fill=CREAM, radius=8)
        y = top - 12
        for i, (label, value) in enumerate(rows):
            last = i == len(rows) - 1
            if last and len(rows) > 1:
                self.c.line(x + 14, y - 3, x + box_w - 14, y - 3, _hex('#d9d4e8'), 0.8)
                y -= 5
            font, size = (BOLD, 11.0) if last else (REGULAR, 9.5)
            self.c.text(x + 14, y - 11, label, font=font, size=size, rgb=INK if last else MUTED)
            self.c.text(x + box_w - 14, y - 11, value, font=BOLD if last else REGULAR, size=size,
                        rgb=PURPLE if last else INK, align='right')
            y -= row_h
        self.y = top - h - 20

    def notes(self):
        for note in self.doc.notes:
            lines = wrap(note, REGULAR, 8.8, self.width - 32)
            h = 14 + 12 * len(lines)
            self.ensure(h + 8)
            top = self.y
            self.c.rect(self.left, top - h, self.width, h, fill=CREAM_2, stroke=LINE, width=0.6, radius=6)
            self.c.rect(self.left, top - h, 3, h, fill=PINK)
            for k, line in enumerate(lines):
                self.c.text(self.left + 16, top - 15 - 12 * k, line, font=REGULAR, size=8.8, rgb=MUTED)
            self.y = top - h - 10

    def footers(self, generated: str):
        total = len(self.pages)
        for n, c in enumerate(self.pages, start=1):
            y = MARGIN
            c.line(self.left, y + 16, self.right, y + 16, LINE, 0.8)
            c.text(self.left, y + 3, self.doc.footer, font=BOLD, size=7.8, rgb=PURPLE)
            c.text(self.right, y + 3, f'Generado el {generated}  ·  Página {n} de {total}',
                   font=REGULAR, size=7.8, rgb=MUTED, align='right')


def _pdf_string(text: str) -> bytes:
    return b'(' + _enc(text) + b')'


def _info_string(text: str) -> bytes:
    """Any text as a PDF text string (UTF-16BE with its byte order mark)."""
    return b'<' + (b'\xfe\xff' + str(text).encode('utf-16-be')).hex().upper().encode() + b'>'


@functools.cache
def _compressed_program(key: str) -> bytes:
    return zlib.compress(embedded_font(key).program, 9)


def _embedded_font_objects(key: str, add) -> int:
    font = embedded_font(key)
    data = _compressed_program(key)
    if font.cff:
        file_key, extra, subtype = 'FontFile3', '/Subtype /Type1C', 'Type1'
        name = font.postscript_name
    else:
        file_key, extra, subtype = 'FontFile2', f'/Length1 {len(font.program)}', 'TrueType'
        name = f'IKFICH+{font.postscript_name}'    # a subset carries a tag
    program = add(f'<< /Length {len(data)} /Filter /FlateDecode {extra} >>\nstream\n'.encode()
                  + data + b'\nendstream')
    bbox = ' '.join(str(v) for v in font.bbox)
    descriptor = add(
        f'<< /Type /FontDescriptor /FontName /{name} /Flags 32 /FontBBox [{bbox}] '
        f'/ItalicAngle {_f(font.italic_angle)} /Ascent {font.ascent} /Descent {font.descent} '
        f'/CapHeight {font.cap_height} /StemV {font.stem_v} /{file_key} {program} 0 R >>'.encode()
    )
    widths = ' '.join(str(w) for w in font.widths)
    return add(
        f'<< /Type /Font /Subtype /{subtype} /BaseFont /{name} /FirstChar 32 /LastChar 255 '
        f'/Widths [{widths}] /Encoding /WinAnsiEncoding /FontDescriptor {descriptor} 0 R >>'.encode()
    )


def _font_object(key: str, add) -> int:
    if key in EMBEDDED_FONTS:
        return _embedded_font_objects(key, add)
    encoding = '' if key == SYMBOL else ' /Encoding /WinAnsiEncoding'
    return add(f'<< /Type /Font /Subtype /Type1 /BaseFont /{STANDARD_FONTS[key]}{encoding} >>'.encode())


def _assemble(pages: list[_Canvas], page_w: float, page_h: float, logo, title: str,
              fonts=None, subject: str = '', keywords: str = '') -> bytes:
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    catalog = add(b'')                       # 1, filled below
    pages_id = add(b'')                      # 2, filled below
    if fonts is None:
        font_ids = {name: add(f'<< /Type /Font /Subtype /Type1 /BaseFont /{base} /Encoding /WinAnsiEncoding >>'.encode())
                    for name, base in FONTS.items()}
    else:
        font_ids = {name: _font_object(name, add) for name in fonts}
    image_id = None
    if logo:
        data, (w, h, comps) = logo
        space = '/DeviceRGB' if comps == 3 else '/DeviceGray'
        image_id = add(
            f'<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace {space} '
            f'/BitsPerComponent 8 /Filter /DCTDecode /Length {len(data)} >>\nstream\n'.encode()
            + data + b'\nendstream'
        )
    fonts = ' '.join(f'/{n} {i} 0 R' for n, i in font_ids.items())
    xobj = f' /XObject << /Logo {image_id} 0 R >>' if image_id else ''
    page_ids = []
    for c in pages:
        stream = c.stream()
        content = add(f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'\nendstream')
        page_ids.append(add(
            f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {_f(page_w)} {_f(page_h)}] '
            f'/Resources << /Font << {fonts} >>{xobj} >> /Contents {content} 0 R >>'.encode()
        ))
    objects[catalog - 1] = f'<< /Type /Catalog /Pages {pages_id} 0 R >>'.encode()
    kids = ' '.join(f'{i} 0 R' for i in page_ids)
    objects[pages_id - 1] = f'<< /Type /Pages /Count {len(page_ids)} /Kids [{kids}] >>'.encode()
    described = b''
    if subject:
        described += b' /Subject ' + _info_string(subject)
    if keywords:
        described += b' /Keywords ' + _info_string(keywords)
    info_id = add(b'<< /Title ' + _pdf_string(title) + described
                  + b' /Author (Colegio Interlaken) /Creator (Portal Interlaken) >>')

    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for idx, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f'{idx} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    for off in offsets:
        out += f'{off:010d} 00000 n \n'.encode()
    out += (f'trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R /Info {info_id} 0 R >>\n'
            f'startxref\n{xref}\n%%EOF\n').encode()
    return bytes(out)


def assemble_pdf(pages: list[_Canvas], page_size: tuple[float, float], *, logo=None, title: str = '',
                 fonts=None, subject: str = '', keywords: str = '') -> bytes:
    """Pages drawn on ``Canvas`` objects → PDF bytes; the ``logo`` from
    ``jpeg_image`` is the ``/Logo`` image of every page.

    ``fonts``: the font keys the pages use (``REGULAR``… ``CARLITO``); None
    means the Helvetica family. ``subject`` / ``keywords`` go to the Info
    dictionary (any text: UTF-16)."""
    return _assemble(pages, page_size[0], page_size[1], logo, title, fonts, subject, keywords)


def render_document_pdf(doc: Document, *, table_heading: str = 'Movimientos') -> bytes:
    """Lay ``doc`` out on as many pages as it needs and return the PDF bytes."""
    layout = _Layout(doc)
    layout.summary()
    layout.info()
    layout.table(table_heading)
    layout.totals()
    layout.notes()
    generated = timezone.localtime(doc.generated_at or timezone.now()).strftime('%d/%m/%Y %H:%M')
    layout.footers(generated)
    title = ' '.join(x for x in (doc.title, doc.reference) if x)
    return _assemble(layout.pages, layout.pw, layout.ph, layout.logo, title)


# ── Receipts from «Etiqueta: valor» lines ───────────────────────────────────
_PAIR = re.compile(r'^([^:]{1,40}): (.*)$')


def receipt_pdf(title: str, lines, *, subtitle: str = '', status: tuple[str, str] | None = None) -> bytes:
    """A payment receipt laid out from the same ``Etiqueta: valor`` lines the
    view composes (so the facts stay in one place, the view):

    * ``Folio`` becomes the reference under the title,
    * ``Monto`` the large amount (and the total),
    * ``Concepto`` and ``Alumno`` the concept table row,
    * every other pair the info block, in order,
    * lines that are not pairs (the legal note) one note, joined.
    """
    pairs: list[tuple[str, str]] = []
    note: list[str] = []
    for raw in lines:
        line = str(raw).strip()
        if not line:
            continue
        m = _PAIR.match(line)
        if m and not note:
            pairs.append((m.group(1).strip(), m.group(2).strip()))
        else:
            note.append(line)
    found = dict(pairs)
    amount = found.get('Monto', '')
    info = [(k, v) for k, v in pairs if k not in ('Folio', 'Monto', 'Concepto', 'Alumno')]
    table = None
    if 'Concepto' in found or 'Alumno' in found:
        table = Table(
            columns=[Column('Concepto'), Column('Alumno', width=170), Column('Importe', width=120, align='right', strong=True)],
            rows=[Row([found.get('Concepto', '-'), found.get('Alumno', '-'), amount])],
        )
    doc = Document(
        title=title,
        reference=f"Folio {found['Folio']}" if found.get('Folio') else '',
        subtitle=subtitle,
        status=status,
        summary=[('Monto', amount)] if amount else [],
        info=info,
        table=table,
        totals=[('Total', amount)] if amount else [],
        notes=[' '.join(note)] if note else [],
        footer='Colegio Interlaken · Portal de Familias',
    )
    return render_document_pdf(doc, table_heading='Detalle del pago')
