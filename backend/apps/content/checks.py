"""
Pre-publish checks for CMS pages (BACKLOG P3-12).

run_checks(page) -> list of {level: 'error'|'warning', code, message, block_id?}
Errors block publishing; warnings are shown but do not block.

An issue about a section also says where, in the editor's words (contract
C3): block_index, block_label, field (a path such as `items.2.title`),
field_label («Tarjetas › 3 › Título») and field_message (the short text shown
next to the field). `message` names the section and the field with their
Spanish labels, never with prop keys.

Checks: required props empty, images that no longer exist, images without alt,
internal links to routes/pages that do not exist (and are not redirected),
rich text with no content, SEO description missing/too long, duplicate
consecutive block types (usually a paste mistake), a locked section (one that
carries a form or the booking widget) hidden. Hidden blocks are otherwise
skipped: they never reach the site. Built-in site photos (/assets/...) are
valid images; only media-library ids are looked up.
"""
from __future__ import annotations

import re

from .media import MediaAsset
from .pages import Page, field_path, image_ref_paths, located_error, manifest, section_schema, where

HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)
ROUTE_PREFIXES = ('/niveles/', '/portal', '/admin', '/staff', '/login', '/p/')


def _known_paths() -> set[str]:
    from .navigation import STATIC_ROUTES, Redirect, page_path
    paths = {p for p, _f, _p in STATIC_ROUTES}
    paths |= {'/pre-registro', '/inscripcion', '/inscripcion/documentos', '/puertas-abiertas', '/agendar-visita', '/whatsapp/'}
    paths |= {page_path(s) for s in Page.objects.filter(status=Page.Status.PUBLISHED).values_list('slug', flat=True)}
    paths |= set(Redirect.objects.values_list('from_path', flat=True))
    return paths


def _hrefs(value, out: list[tuple[str, str]], path: str = '') -> None:
    """Every link in a block's props, with where it is: {href} objects, href/to strings, <a href> inside text."""
    if isinstance(value, dict):
        for k, v in value.items():
            at = f'{path}.{k}' if path else str(k)
            if k in ('href', 'to') and isinstance(v, str) and v.strip():
                out.append((at, v))
            elif isinstance(v, str) and '<a' in v:
                out.extend((at, h) for h in HREF_RE.findall(v))
            else:
                _hrefs(v, out, at)
    elif isinstance(value, list):
        for n, v in enumerate(value):
            _hrefs(v, out, f'{path}.{n}')


def _links_in(blocks: list[tuple[int, dict]]) -> list[tuple[int, str, str]]:
    """(block index, field path, href) of every link of the given (index, block) pairs."""
    out = []
    for i, b in blocks:
        found: list[tuple[str, str]] = []
        _hrefs(b.get('props', {}), found)
        out += [(i, path, h) for path, h in found]
    return out


def issue_error(issue: dict) -> dict:
    """An issue as a structured error for the editor (publish 400 `errors`)."""
    return {
        'block_index': issue.get('block_index'),
        'block_id': issue.get('block_id'),
        'block_label': issue.get('block_label', ''),
        'field': issue.get('field', ''),
        'field_label': issue.get('field_label', ''),
        'message': issue.get('field_message') or issue.get('message', ''),
    }


def run_checks(page: Page) -> list[dict]:
    all_blocks = page.draft_blocks or []
    blocks = [b for b in all_blocks if not b.get('hidden')]
    visible = [(i, b) for i, b in enumerate(all_blocks) if not b.get('hidden')]
    issues: list[dict] = []
    err = lambda code, msg, bid=None: issues.append({'level': 'error', 'code': code, 'message': msg, 'block_id': bid})  # noqa: E731
    warn = lambda code, msg, bid=None: issues.append({'level': 'warning', 'code': code, 'message': msg, 'block_id': bid})  # noqa: E731

    def at(level: str, code: str, index: int, field: str, short: str, full: str = '') -> None:
        """An issue located in a section and field, with labelled messages (see module docstring)."""
        loc = located_error(all_blocks, index, field, short)
        t = all_blocks[index].get('type')
        issues.append({'level': level, 'code': code, 'block_id': loc['block_id'],
                       'message': full or f'{where(t, index, loc["field"])}: {short[0].lower()}{short[1:]}',
                       'block_index': index, 'block_label': loc['block_label'], 'field': loc['field'],
                       'field_label': loc['field_label'], 'field_message': short})

    if not blocks:
        err('empty', 'La página no tiene bloques visibles.')
    for i, b in enumerate(all_blocks):
        info = manifest().get(b.get('type'), {})
        if b.get('hidden') and info.get('locked'):
            at('error', 'locked_hidden', i, '', 'Esta sección no se puede ocultar: lleva un formulario o datos del sistema.')
    prev, prev_i = None, 0
    for i, b in visible:
        req = section_schema(b.get('type')) or {}
        for name in req:
            v = b.get('props', {}).get(name)
            if v in (None, '', [], {}):
                at('error', 'required', i, name, 'Este dato es obligatorio.')
        if b.get('type') == 'rich_text' and not re.sub(r'<[^>]+>', '', str(b.get('props', {}).get('html', ''))).strip():
            at('error', 'empty_text', i, 'html', 'El texto está vacío.')
        if b.get('type') == 'gallery' and not b.get('props', {}).get('images'):
            at('error', 'empty_gallery', i, 'images', 'La galería no tiene imágenes.')
        if prev == b.get('type') and b.get('type') in ('hero', 'cta_band', 'stats'):
            at('warning', 'duplicate', i, '', 'Esta sección es igual a la anterior; ¿se duplicó por error?',
               f'Las secciones {prev_i + 1} y {i + 1} son del mismo tipo («{manifest().get(b.get("type"), {}).get("label") or "Sección"}»); ¿se duplicó por error?')
        prev, prev_i = b.get('type'), i

    refs = [(i, path, mid) for i, b in visible for path, mid in image_ref_paths(b)]
    assets = {a.pk: a for a in MediaAsset.objects.filter(pk__in=[mid for _i, _p, mid in refs])}
    for i, path, mid in refs:
        a = assets.get(mid)
        if a is None:
            at('error', 'missing_image', i, path, 'Esta imagen ya no existe en la biblioteca. Elija otra.')
        elif not a.alt:
            at('error', 'missing_alt', i, path, f'La imagen «{a.filename}» no tiene descripción (texto alternativo). Escríbala junto a la imagen.')

    known = _known_paths()
    for i, path, href in _links_in(visible):
        h = href.strip()
        t = all_blocks[i].get('type')
        if not h or h.startswith(('http://', 'https://', 'mailto:', 'tel:', '#')):
            if h.startswith('http://'):
                at('warning', 'insecure_link', i, path, f'Este enlace no usa conexión segura (https): {h}')
            continue
        if not h.startswith('/'):
            at('error', 'relative_link', i, path, f'El enlace «{h}» debe ser una página del sitio o una dirección que empiece con https://.')
            continue
        target = h.split('?')[0].split('#')[0].rstrip('/') or '/'
        if target in known or target.startswith(ROUTE_PREFIXES):
            continue
        short = f'Enlace roto: {h} no lleva a ninguna página ni redirección. Elija otro destino.'
        at('error', 'broken_link', i, path, short, f'Enlace roto en {where(t, i, field_path(t, path))}: {h} no lleva a ninguna página ni redirección.')

    seo = page.seo or {}
    og = seo.get('og_image')
    if isinstance(og, int) and not isinstance(og, bool) and not MediaAsset.objects.filter(pk=og).exists():
        warn('missing_og_image', 'La imagen para compartir ya no existe en la biblioteca; se usará la imagen general del sitio.')
    if not (seo.get('description') or '').strip():
        warn('seo_description', 'Falta la descripción SEO (aparece en Google).')
    elif len(seo['description']) > 160:
        warn('seo_long', f'La descripción SEO tiene {len(seo["description"])} caracteres; se recorta en Google a partir de 160.')
    if (seo.get('title') or page.title or '') and len(seo.get('title') or page.title) > 60:
        warn('seo_title', 'El título SEO supera 60 caracteres.')
    return issues
