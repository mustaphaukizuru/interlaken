"""
core/pdf.py — a tiny, dependency-free PDF generator.

The image and CI don't ship a PDF library (no reportlab/weasyprint in
``requirements.txt``), so this emits a valid multi-page PDF by hand: a fixed
Helvetica font, one text column, automatic pagination. It's intentionally
minimal — enough for tabular statements (cafeteria account statements, spec §5
"Export monthly statement per student / whole school") — not a layout engine.

Public API:
    ``simple_document_pdf(title, lines, *, subtitle='') -> bytes``
    ``table_pdf(title, headers, rows, *, subtitle='', landscape=True, widths=None) -> bytes``
"""
from __future__ import annotations

import re

from django.utils import timezone


def _escape(text: str) -> str:
    """Escape the characters that are special inside a PDF text string literal."""
    return (
        str(text)
        .replace('\\', r'\\')
        .replace('(', r'\(')
        .replace(')', r'\)')
    )


def _sanitize(text: str) -> str:
    """Fold text to Latin-1, the encoding of the PDF standard Helvetica font.

    Characters outside Latin-1 (which the standard 14 fonts can't render) are
    dropped so the output stays a valid single-byte string; common Spanish
    accents and ``$`` all survive.
    """
    return str(text).encode('latin-1', 'replace').decode('latin-1')


def simple_document_pdf(title: str, lines, *, subtitle: str = '') -> bytes:
    """Render ``title`` + optional ``subtitle`` + a list of text ``lines`` to PDF bytes.

    Lines are laid out top-to-bottom in a monospaced-looking single column and
    paginated automatically. Returns the complete PDF file as ``bytes``.
    """
    # Page geometry (US Letter, points).
    page_w, page_h = 612, 792
    left, top = 54, 750
    body_size, line_height = 10, 14
    bottom_margin = 54
    max_lines = int((top - bottom_margin) / line_height)

    # Build the display lines: title, subtitle, blank, then the body.
    header: list[tuple[str, int]] = [(_sanitize(title), 16)]
    if subtitle:
        header.append((_sanitize(subtitle), 11))
    header.append(('', body_size))
    body = [(_sanitize(str(ln)), body_size) for ln in lines]
    all_lines = header + body

    # Paginate.
    pages: list[list[tuple[str, int]]] = []
    for i in range(0, len(all_lines), max_lines):
        pages.append(all_lines[i:i + max_lines])
    if not pages:
        pages = [[]]

    # ── Assemble PDF objects ────────────────────────────────────────────
    # 1 = Catalog, 2 = Pages, 3 = Font, then per page: content stream + page obj.
    objects: list[str] = []

    font_obj = 3
    # Content streams start at object 4; page objects follow all streams.
    first_content = 4
    first_page = first_content + len(pages)

    kids = ' '.join(f'{first_page + i} 0 R' for i in range(len(pages)))

    objects.append('<< /Type /Catalog /Pages 2 0 R >>')                       # obj 1
    objects.append(f'<< /Type /Pages /Count {len(pages)} /Kids [{kids}] >>')  # obj 2
    objects.append('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')  # obj 3

    # Content streams (obj 4 .. first_page-1).
    for page_lines in pages:
        parts = ['BT']
        y = top
        for text, size in page_lines:
            parts.append(f'/F1 {size} Tf')
            parts.append(f'1 0 0 1 {left} {y} Tm')
            parts.append(f'({_escape(text)}) Tj')
            y -= line_height
        parts.append('ET')
        stream = '\n'.join(parts)
        objects.append(
            f'<< /Length {len(stream.encode("latin-1"))} >>\nstream\n{stream}\nendstream'
        )

    # Page objects (first_page ..).
    for i in range(len(pages)):
        content_ref = first_content + i
        objects.append(
            f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_w} {page_h}] '
            f'/Resources << /Font << /F1 {font_obj} 0 R >> >> '
            f'/Contents {content_ref} 0 R >>'
        )

    # ── Serialize with a cross-reference table ──────────────────────────
    out = bytearray()
    out += b'%PDF-1.4\n'
    offsets = [0]
    for idx, body_str in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f'{idx} 0 obj\n{body_str}\nendobj\n'.encode('latin-1')

    xref_pos = len(out)
    count = len(objects) + 1
    out += f'xref\n0 {count}\n'.encode('latin-1')
    out += b'0000000000 65535 f \n'
    for off in offsets[1:]:
        out += f'{off:010d} 00000 n \n'.encode('latin-1')
    out += (
        f'trailer\n<< /Size {count} /Root 1 0 R >>\n'
        f'startxref\n{xref_pos}\n%%EOF'
    ).encode('latin-1')

    return bytes(out)


# ── tabular PDF (Data Ops C3) ────────────────────────────────────────
_NUMERIC = re.compile(r'^-?\$?[\d,]+(\.\d+)?%?$')


def _fit(text: str, width: int) -> str:
    """Pad or cut ``text`` to exactly ``width`` chars; numbers right-align."""
    text = _sanitize(text)
    if len(text) > width:
        text = text[:width]
    return text.rjust(width) if _NUMERIC.match(text.strip() or 'x') else text.ljust(width)


def _column_widths(headers, rows, usable: int, widths=None) -> list[int]:
    """Characters per column: explicit ``widths`` or content-derived, shrunk to fit."""
    n = len(headers)
    given = list(widths or [])[:n] + [None] * (n - len(widths or []))
    out = []
    for i, header in enumerate(headers):
        if given[i]:
            out.append(max(3, int(given[i])))
            continue
        longest = max([len(str(header))] + [len(str(r[i])) for r in rows if i < len(r)])
        out.append(max(3, min(longest, 40)))
    # One space between columns; shrink the widest columns until the row fits.
    while sum(out) + (n - 1) > usable and max(out) > 3:
        out[out.index(max(out))] -= 1
    return out


def table_pdf(title: str, headers, rows, *, subtitle: str = '', landscape: bool = True,
              widths=None) -> bytes:
    """Render a fixed-width (Courier) table with a bold header, page numbers and
    a "Generado DD/MM/YYYY HH:MM" stamp. ``widths`` are characters per column
    (``Col.width`` in ``apps.core.exporting``); missing widths are derived from
    the content and every row is cut to the page width, never wrapped.
    """
    page_w, page_h = (792, 612) if landscape else (612, 792)
    margin = 36
    body_size, line_h = 8, 11
    char_w = body_size * 0.6                       # Courier advance width
    usable_chars = int((page_w - 2 * margin) / char_w)

    headers = [str(h) for h in headers]
    rows = [[('' if c is None else str(c)) for c in r] for r in rows]
    cols = _column_widths(headers, rows, usable_chars, widths)

    def line_of(cells):
        return ' '.join(_fit(cells[i] if i < len(cells) else '', w) for i, w in enumerate(cols))

    header_line = line_of(headers)
    rule = '-' * min(len(header_line), usable_chars)
    body_lines = [line_of(r) for r in rows]

    generated = timezone.localtime(timezone.now()).strftime('%d/%m/%Y %H:%M')
    top = page_h - margin
    # Title block: title (14), subtitle (9), gap, header + rule.
    title_block_h = 14 + 6 + (12 if subtitle else 0) + 8
    header_y = top - title_block_h
    first_body_y = header_y - 2 * line_h
    footer_y = margin
    per_page = max(1, int((first_body_y - (footer_y + line_h)) / line_h))
    pages = [body_lines[i:i + per_page] for i in range(0, len(body_lines), per_page)] or [[]]
    total = len(pages)

    streams = []
    for number, page_rows in enumerate(pages, start=1):
        parts = ['BT']
        parts.append(f'/F3 14 Tf 1 0 0 1 {margin} {top - 14} Tm ({_escape(_sanitize(title))}) Tj')
        y = top - 14 - 6
        if subtitle:
            parts.append(f'/F4 9 Tf 1 0 0 1 {margin} {y - 9} Tm ({_escape(_sanitize(subtitle))}) Tj')
            y -= 12
        parts.append(f'/F2 {body_size} Tf 1 0 0 1 {margin} {header_y} Tm ({_escape(header_line)}) Tj')
        parts.append(f'/F1 {body_size} Tf 1 0 0 1 {margin} {header_y - line_h} Tm ({_escape(rule)}) Tj')
        y = first_body_y
        for text in page_rows:
            parts.append(f'1 0 0 1 {margin} {y} Tm ({_escape(text)}) Tj')
            y -= line_h
        footer = f'Generado {generated}  -  Pagina {number} de {total}'
        parts.append(f'/F4 8 Tf 1 0 0 1 {margin} {footer_y} Tm ({_escape(_sanitize(footer))}) Tj')
        parts.append('ET')
        streams.append('\n'.join(parts))

    fonts = {'F1': 'Courier', 'F2': 'Courier-Bold', 'F3': 'Helvetica-Bold', 'F4': 'Helvetica'}
    return _assemble(streams, fonts, page_w, page_h)


def _assemble(streams, fonts: dict[str, str], page_w: int, page_h: int) -> bytes:
    """Objects: 1 Catalog, 2 Pages, then one Font per entry, then streams, then pages."""
    objects: list[str] = []
    font_ids = {}
    next_id = 3
    for name in fonts:
        font_ids[name] = next_id
        next_id += 1
    first_content = next_id
    first_page = first_content + len(streams)
    kids = ' '.join(f'{first_page + i} 0 R' for i in range(len(streams)))

    objects.append('<< /Type /Catalog /Pages 2 0 R >>')
    objects.append(f'<< /Type /Pages /Count {len(streams)} /Kids [{kids}] >>')
    for base in fonts.values():
        objects.append(
            f'<< /Type /Font /Subtype /Type1 /BaseFont /{base} /Encoding /WinAnsiEncoding >>'
        )
    for stream in streams:
        objects.append(
            f'<< /Length {len(stream.encode("latin-1"))} >>\nstream\n{stream}\nendstream'
        )
    font_res = ' '.join(f'/{name} {oid} 0 R' for name, oid in font_ids.items())
    for i in range(len(streams)):
        objects.append(
            f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_w} {page_h}] '
            f'/Resources << /Font << {font_res} >> >> '
            f'/Contents {first_content + i} 0 R >>'
        )

    out = bytearray()
    out += b'%PDF-1.4\n'
    offsets = [0]
    for idx, body_str in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f'{idx} 0 obj\n{body_str}\nendobj\n'.encode('latin-1')
    xref_pos = len(out)
    count = len(objects) + 1
    out += f'xref\n0 {count}\n'.encode('latin-1')
    out += b'0000000000 65535 f \n'
    for off in offsets[1:]:
        out += f'{off:010d} 00000 n \n'.encode('latin-1')
    out += (
        f'trailer\n<< /Size {count} /Root 1 0 R >>\n'
        f'startxref\n{xref_pos}\n%%EOF'
    ).encode('latin-1')
    return bytes(out)
