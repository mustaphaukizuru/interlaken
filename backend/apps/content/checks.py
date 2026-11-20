"""
Pre-publish checks for CMS pages (BACKLOG P3-12, docs/cms/safe-publish.md).

run_checks(page) -> list of {level: 'error'|'warning', code, message, block_id?}
Errors block publishing; warnings are shown but do not block.

Checks: required props empty, images that no longer exist, images without alt,
internal links to routes/pages that do not exist (and are not redirected),
rich text with no content, SEO description missing/too long, duplicate
consecutive block types (usually a paste mistake), a locked section (one that
carries a form or the booking widget) hidden, SEO still holding the old
seed_cms values. Hidden blocks are otherwise skipped: they never reach the
site. Built-in site photos (/assets/...) are valid images; only media-library
ids are looked up.

A designed page published straight from its design passes with no issue at
all: its SEO falls back to the template's (page_templates.template_seo), so a
blank SEO field is not «missing». Messages are plain Spanish and name the
section (its number and label in the editor's list) and the field.
"""
from __future__ import annotations

import re

from .media import MediaAsset
from .pages import Page, manifest, section_schema

HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)
ROUTE_PREFIXES = ('/niveles/', '/portal', '/admin', '/staff', '/login', '/p/')
SEO_TITLE_MAX = 60
SEO_DESCRIPTION_MAX = 160

# Field names as the editor shows them (generic blocks and the common section props).
FIELD_LABELS = {
    'title': 'Título', 'subtitle': 'Subtítulo', 'text': 'Texto', 'html': 'Texto', 'body': 'Texto',
    'label': 'Texto del botón', 'href': 'Enlace', 'to': 'Enlace', 'cta': 'Botón', 'primary': 'Botón principal',
    'secondary': 'Botón secundario', 'buttons': 'Botones', 'links': 'Enlaces', 'items': 'Elementos',
    'images': 'Fotos', 'photos': 'Fotos', 'image': 'Imagen', 'image1': 'Imagen 1', 'image2': 'Imagen 2',
    'image3': 'Imagen 3', 'poster': 'Imagen de portada', 'photo': 'Foto', 'url': 'Enlace del video',
    'form': 'Formulario', 'q': 'Pregunta', 'a': 'Respuesta',
}


def _field(path: list) -> str:
    """['items', 2, 'href'] → «Elementos › elemento 3 › Enlace»."""
    out: list[str] = []
    for part in path:
        if isinstance(part, int):
            out.append(f'elemento {part + 1}')
        else:
            out.append(FIELD_LABELS.get(part, part))
    return ' › '.join(out)


def _section(n: int, block: dict) -> str:
    label = manifest().get(block.get('type'), {}).get('label') or block.get('type') or 'bloque'
    return f'Sección {n} ({label})'


def _known_paths() -> set[str]:
    from .navigation import STATIC_ROUTES, Redirect, page_path
    paths = {p for p, _f, _p in STATIC_ROUTES}
    paths |= {'/pre-registro', '/inscripcion', '/inscripcion/documentos', '/puertas-abiertas', '/agendar-visita', '/whatsapp/'}
    paths |= {page_path(s) for s in Page.objects.filter(status=Page.Status.PUBLISHED).values_list('slug', flat=True)}
    paths |= set(Redirect.objects.values_list('from_path', flat=True))
    return paths


def _hrefs(value, path: list, out: list[tuple[list, str]]) -> None:
    """Every link in a block's props, with where it sits: {href} objects, href/to strings, <a href> inside text."""
    if isinstance(value, dict):
        for k, v in value.items():
            if k in ('href', 'to') and isinstance(v, str) and v.strip():
                out.append(([*path, k], v))
            elif isinstance(v, str) and '<a' in v:
                out.extend(([*path, k], h) for h in HREF_RE.findall(v))
            else:
                _hrefs(v, [*path, k], out)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _hrefs(v, [*path, i], out)


def _image_refs(block: dict) -> list[tuple[list, int]]:
    """Media-library ids a block uses, with their field (manifest image paths: "poster", "items[].image")."""
    paths = manifest().get(block.get('type'), {}).get('images') or ['image', 'images[].image']
    found: list[tuple[list, int]] = []

    def walk(value, parts, at):
        if not parts:
            if isinstance(value, int) and not isinstance(value, bool) and value > 0:
                found.append((at, value))
            return
        head, rest = parts[0], parts[1:]
        if head.endswith('[]'):
            items = value.get(head[:-2]) if isinstance(value, dict) else None
            for i, it in enumerate(items if isinstance(items, list) else []):
                walk(it, rest, [*at, head[:-2], i])
        elif isinstance(value, dict):
            walk(value.get(head), rest, [*at, head])

    for p in paths:
        walk(block.get('props') or {}, p.replace('[].', '[] ').replace('.', ' ').split(), [])
    return found


def run_checks(page: Page) -> list[dict]:
    from .legacy_seed import seed_seo_fields
    from .page_templates import template_seo

    all_blocks = page.draft_blocks or []
    issues: list[dict] = []
    err = lambda code, msg, bid=None: issues.append({'level': 'error', 'code': code, 'message': msg, 'block_id': bid})  # noqa: E731
    warn = lambda code, msg, bid=None: issues.append({'level': 'warning', 'code': code, 'message': msg, 'block_id': bid})  # noqa: E731

    # Numbered as in the editor's list (hidden ones count: they are still in the list).
    numbered = [(k + 1, b) for k, b in enumerate(all_blocks) if isinstance(b, dict)]
    visible = [(n, b) for n, b in numbered if not b.get('hidden')]

    if not visible:
        err('empty', 'La página no tiene secciones visibles: agregue una o muestre alguna de las ocultas.')
    for n, b in numbered:
        if b.get('hidden') and manifest().get(b.get('type'), {}).get('locked'):
            err('locked_hidden', f'{_section(n, b)}: lleva un formulario o la agenda y no se puede ocultar. Vuelva a mostrarla.', b.get('id'))

    prev, prev_n = None, 0
    for n, b in visible:
        props = b.get('props') or {}
        for name in section_schema(b.get('type')) or {}:
            if props.get(name) in (None, '', [], {}):
                err('required', f'{_section(n, b)}, campo «{_field([name])}»: está vacío y es obligatorio.', b.get('id'))
        if b.get('type') == 'rich_text' and not re.sub(r'<[^>]+>', '', str(props.get('html', ''))).strip():
            err('empty_text', f'{_section(n, b)}, campo «Texto»: no tiene contenido. Escriba el texto o elimine la sección.', b.get('id'))
        if b.get('type') == 'gallery' and not props.get('images'):
            err('empty_gallery', f'{_section(n, b)}, campo «Fotos»: la galería no tiene fotos.', b.get('id'))
        if prev == b.get('type') and b.get('type') in ('hero', 'cta_band', 'stats'):
            label = manifest().get(b.get('type'), {}).get('label') or b.get('type')
            warn('duplicate', f'Secciones {prev_n} y {n} ({label}): son del mismo tipo y van seguidas; ¿se duplicó por error?', b.get('id'))
        prev, prev_n = b.get('type'), n

    refs = [(n, b, at, i) for n, b in visible for at, i in _image_refs(b)]
    assets = {a.pk: a for a in MediaAsset.objects.filter(pk__in=[r[3] for r in refs])}
    for n, b, at, i in refs:
        a = assets.get(i)
        if a is None:
            err('missing_image', f'{_section(n, b)}, campo «{_field(at)}»: la imagen se borró de la biblioteca de medios. Elija otra.', b.get('id'))
        elif not a.alt:
            err('missing_alt', f'{_section(n, b)}, campo «{_field(at)}»: la foto "{a.filename}" no tiene texto alternativo. Agréguelo en Medios.', b.get('id'))

    known = _known_paths()
    for n, b in visible:
        found: list[tuple[list, str]] = []
        _hrefs(b.get('props') or {}, [], found)
        for at, href in found:
            h = href.strip()
            where = f'{_section(n, b)}, campo «{_field(at)}»'
            if not h or h.startswith(('http://', 'https://', 'mailto:', 'tel:', '#')):
                if h.startswith('http://'):
                    warn('insecure_link', f'{where}: el enlace {h} no es seguro (http). Use https:// si el sitio lo permite.', b.get('id'))
                continue
            if not h.startswith('/'):
                err('relative_link', f'{where}: el enlace "{h}" debe empezar con / (página del sitio) o con https://.', b.get('id'))
                continue
            path = h.split('?')[0].split('#')[0].rstrip('/') or '/'
            if path in known or path.startswith(ROUTE_PREFIXES):
                continue
            err('broken_link', f'Enlace roto. {where}: {h} no lleva a ninguna página ni redirección del sitio.', b.get('id'))

    # SEO: an empty field shows the design's own title and description, so only
    # what the school typed (or the old seed left behind) is checked.
    seo = page.seo or {}
    defaults = template_seo(page.slug)
    og = seo.get('og_image')
    if isinstance(og, int) and not isinstance(og, bool) and not MediaAsset.objects.filter(pk=og).exists():
        warn('missing_og_image', 'SEO, campo «Imagen al compartir»: la imagen se borró de la biblioteca; se usará la imagen general del sitio.')
    description = (seo.get('description') or '').strip()
    if not description and not defaults['description']:
        warn('seo_description', 'SEO, campo «Descripción SEO»: está vacío. Escriba una frase que resuma la página (aparece en Google).')
    elif len(description) > SEO_DESCRIPTION_MAX:
        warn('seo_long', f'SEO, campo «Descripción SEO»: tiene {len(description)} caracteres; Google la recorta a partir de {SEO_DESCRIPTION_MAX}.')
    title = (seo.get('title') or '').strip() or (page.title if not defaults['title'] else '')
    if len(title) > SEO_TITLE_MAX:
        warn('seo_title', f'SEO, campo «Título SEO»: tiene {len(title)} caracteres; Google lo recorta a partir de {SEO_TITLE_MAX}.')
    stale = seed_seo_fields(page.slug, seo)
    if stale:
        names = ' y '.join({'title': '«Título SEO»', 'description': '«Descripción SEO»'}[k] for k in ('title', 'description') if k in stale)
        current = f' («{defaults["title"]}»)' if defaults['title'] and 'title' in stale else ''
        warn('seed_seo', f'SEO, {names}: conservan el texto de la versión antigua del sitio y reemplazan el del diseño actual{current}. '
                         'Bórrelos en SEO o use «Diseño original» para recuperar el del diseño.')
    return issues
