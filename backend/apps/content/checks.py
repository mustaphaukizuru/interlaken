"""
Pre-publish checks for CMS pages (BACKLOG P3-12).

run_checks(page) -> list of {level: 'error'|'warning', code, message, block_id?}
Errors block publishing; warnings are shown but do not block.

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
from .pages import Page, image_refs, manifest, section_schema

HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)
ROUTE_PREFIXES = ('/niveles/', '/portal', '/admin', '/staff', '/login', '/p/')


def _known_paths() -> set[str]:
    from .navigation import STATIC_ROUTES, Redirect, page_path
    paths = {p for p, _f, _p in STATIC_ROUTES}
    paths |= {'/pre-registro', '/inscripcion', '/inscripcion/documentos', '/puertas-abiertas', '/agendar-visita', '/whatsapp/'}
    paths |= {page_path(s) for s in Page.objects.filter(status=Page.Status.PUBLISHED).values_list('slug', flat=True)}
    paths |= set(Redirect.objects.values_list('from_path', flat=True))
    return paths


def _hrefs(value, out: list[str]) -> None:
    """Every link in a block's props: {href} objects, href/to strings, <a href> inside text."""
    if isinstance(value, dict):
        for k, v in value.items():
            if k in ('href', 'to') and isinstance(v, str) and v.strip():
                out.append(v)
            elif isinstance(v, str) and '<a' in v:
                out.extend(HREF_RE.findall(v))
            else:
                _hrefs(v, out)
    elif isinstance(value, list):
        for v in value:
            _hrefs(v, out)


def _links_in(blocks: list[dict]) -> list[tuple[str, str]]:
    out = []
    for b in blocks:
        found: list[str] = []
        _hrefs(b.get('props', {}), found)
        out += [(b.get('id'), h) for h in found]
    return out


def _image_ids(blocks: list[dict]) -> list[tuple[str, int]]:
    return [(b.get('id'), i) for b in blocks for i in image_refs(b)]


def run_checks(page: Page) -> list[dict]:
    all_blocks = page.draft_blocks or []
    blocks = [b for b in all_blocks if not b.get('hidden')]
    issues: list[dict] = []
    err = lambda code, msg, bid=None: issues.append({'level': 'error', 'code': code, 'message': msg, 'block_id': bid})  # noqa: E731
    warn = lambda code, msg, bid=None: issues.append({'level': 'warning', 'code': code, 'message': msg, 'block_id': bid})  # noqa: E731

    if not blocks:
        err('empty', 'La página no tiene bloques visibles.')
    for i, b in enumerate(all_blocks):
        info = manifest().get(b.get('type'), {})
        if b.get('hidden') and info.get('locked'):
            err('locked_hidden', f'Bloque #{i + 1} ({info.get("label") or b.get("type")}): esta sección no se puede ocultar.', b.get('id'))
    prev, prev_n = None, 0
    for n, b in ((k + 1, x) for k, x in enumerate(all_blocks) if not x.get('hidden')):
        req = section_schema(b.get('type')) or {}
        for name in req:
            v = b.get('props', {}).get(name)
            if v in (None, '', [], {}):
                err('required', f'Bloque #{n} ({manifest().get(b.get("type"), {}).get("label") or b.get("type")}): falta "{name}".', b.get('id'))
        if b.get('type') == 'rich_text' and not re.sub(r'<[^>]+>', '', str(b.get('props', {}).get('html', ''))).strip():
            err('empty_text', f'Bloque #{n}: el texto está vacío.', b.get('id'))
        if b.get('type') == 'gallery' and not b.get('props', {}).get('images'):
            err('empty_gallery', f'Bloque #{n}: la galería no tiene imágenes.', b.get('id'))
        if prev == b.get('type') and b.get('type') in ('hero', 'cta_band', 'stats'):
            warn('duplicate', f'Bloques #{prev_n} y #{n} son del mismo tipo ({b.get("type")}); ¿se duplicó por error?', b.get('id'))
        prev, prev_n = b.get('type'), n

    ids = _image_ids(blocks)
    assets = {a.pk: a for a in MediaAsset.objects.filter(pk__in=[i for _b, i in ids])}
    for bid, i in ids:
        a = assets.get(i)
        if a is None:
            err('missing_image', f'Una imagen ya no existe en la biblioteca (id {i}).', bid)
        elif not a.alt:
            err('missing_alt', f'"{a.filename}" no tiene texto alternativo.', bid)

    known = _known_paths()
    for bid, href in _links_in(blocks):
        h = href.strip()
        if not h or h.startswith(('http://', 'https://', 'mailto:', 'tel:', '#')):
            if h.startswith('http://'):
                warn('insecure_link', f'Enlace sin https: {h}', bid)
            continue
        if not h.startswith('/'):
            err('relative_link', f'Enlace "{h}" debe empezar con / o https://.', bid)
            continue
        path = h.split('?')[0].split('#')[0].rstrip('/') or '/'
        if path in known or path.startswith(ROUTE_PREFIXES):
            continue
        err('broken_link', f'Enlace roto: {h} (no existe ninguna página ni redirección).', bid)

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
