"""
core/pdf.py — a tiny, dependency-free PDF generator.

The cPanel host and CI don't ship a PDF library (no reportlab/weasyprint in
``requirements.txt``), so this emits a valid multi-page PDF by hand: a fixed
Helvetica font, one text column, automatic pagination. It's intentionally
minimal — enough for tabular statements (cafeteria account statements, spec §5
"Export monthly statement per student / whole school") — not a layout engine.

Public API:
    ``simple_document_pdf(title, lines, *, subtitle='') -> bytes``
"""
from __future__ import annotations


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
