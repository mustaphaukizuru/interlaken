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

import os
import re
import unicodedata
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


def _char_width(ch: str, font: str) -> int:
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

    def text(self, x, y, s, *, font=REGULAR, size=10.0, rgb=INK, align='left', spacing=0.0):
        if not s:
            return
        w = text_width(s, font, size) + spacing * max(len(str(s)) - 1, 0)
        if align == 'right':
            x -= w
        elif align == 'center':
            x -= w / 2
        self.fill(rgb)
        head = f'BT /{font} {_f(size)} Tf {_f(spacing)} Tc 1 0 0 1 {_f(x)} {_f(y)} Tm ('.encode('latin-1')
        self.ops.append(head + _enc(s) + b') Tj ET')

    def image(self, name, x, y, w, h):
        self._op(f'q {_f(w)} 0 0 {_f(h)} {_f(x)} {_f(y)} cm /{name} Do Q')

    def stream(self) -> bytes:
        return b'\n'.join(self.ops)


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


def _assemble(pages: list[_Canvas], page_w: float, page_h: float, logo, title: str) -> bytes:
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    catalog = add(b'')                       # 1, filled below
    pages_id = add(b'')                      # 2, filled below
    font_ids = {name: add(f'<< /Type /Font /Subtype /Type1 /BaseFont /{base} /Encoding /WinAnsiEncoding >>'.encode())
                for name, base in FONTS.items()}
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
    info_id = add(b'<< /Title ' + _pdf_string(title) + b' /Author (Colegio Interlaken) /Creator (Portal Interlaken) >>')

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
