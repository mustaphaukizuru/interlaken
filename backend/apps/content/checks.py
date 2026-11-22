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

An issue about a section also says where, in the editor's words (contract
C3): block_index, block_label, field (a path such as `items.2.title`, the
editor field it belongs to), field_label («Tarjetas › elemento 3 › Título»)
and field_message (the short text shown next to the field). Labels come from
block_manifest.json (pages.field_label), never from prop keys.
These are the structural checks. publish_checks.py («Revisión antes de
publicar») runs them and adds the content rules (links to private pages,
tokens, retired defaults, large changes) with their quick fixes: whatever
decides if a page may go live calls publish_checks.review(), not this.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .media import MediaAsset
from .pages import Page, image_ref_paths, located_error, manifest, section_schema, where

HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)
ROUTE_PREFIXES = ('/niveles/', '/portal', '/admin', '/staff', '/login', '/p/')
SEO_TITLE_MAX = 60
SEO_DESCRIPTION_MAX = 160


def _known_paths(published_slugs=None) -> set[str]:
    from .navigation import STATIC_ROUTES, Redirect, page_path
    paths = {p for p, _f, _p in STATIC_ROUTES}
    # Private routes exist, so a link to them is not «broken»: publish_checks flags them on public pages.
    paths |= {'/pre-registro', '/inscripcion', '/inscripcion/documentos', '/confirmar-correo', '/puertas-abiertas',
              '/agendar-visita', '/whatsapp/'}
    if published_slugs is None:
        published_slugs = Page.objects.filter(status=Page.Status.PUBLISHED).values_list('slug', flat=True)
    paths |= {page_path(s) for s in published_slugs}
    paths |= set(Redirect.objects.values_list('from_path', flat=True))
    return paths


def media_ids(blocks, seo) -> set[int]:
    """Media-library ids used by these blocks and SEO image."""
    ids = {mid for b in blocks or [] if isinstance(b, dict) for _p, mid in image_ref_paths(b)}
    og = (seo or {}).get('og_image')
    if isinstance(og, int) and not isinstance(og, bool):
        ids.add(og)
    return ids


@dataclass
class CheckContext:
    """Lookups shared by the checks of many pages (the «Contenido» chips, the audit
    of live pages): a constant number of queries however many pages are checked.

    ``assets`` holds every media-library image of the checked drafts; an id
    missing from it is an image that was deleted. ``tokens`` are today's token
    values (publish_checks.token_values), read once.
    """
    known: set[str]
    assets: dict
    tokens: dict | None = None

    @classmethod
    def build(cls, drafts, published_slugs=None) -> CheckContext:
        """``drafts``: (blocks, seo) of everything that will be checked; ``published_slugs`` saves a query."""
        ids: set[int] = set()
        for blocks, seo in drafts:
            ids |= media_ids(blocks, seo)
        assets = {a.pk: a for a in MediaAsset.objects.filter(pk__in=ids)} if ids else {}
        return cls(known=_known_paths(published_slugs), assets=assets)


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
    """(block index, path, href) of every link of the given (index, block) pairs."""
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


def run_checks(page: Page, ctx: CheckContext | None = None) -> list[dict]:
    """Structural issues of ``page.draft_blocks`` and ``page.seo`` (``ctx``: shared lookups, else queried here)."""
    from .legacy_seed import seed_seo_fields
    from .page_templates import template_seo

    all_blocks = page.draft_blocks or []
    issues: list[dict] = []
    err = lambda code, msg, bid=None: issues.append({'level': 'error', 'code': code, 'message': msg, 'block_id': bid})  # noqa: E731
    warn = lambda code, msg, bid=None: issues.append({'level': 'warning', 'code': code, 'message': msg, 'block_id': bid})  # noqa: E731

    def at(level: str, code: str, index: int, path: str, short: str, full: str = '') -> None:
        """An issue located in a section and field: «Sección N (label), campo «…»: …» plus the structured fields."""
        loc = located_error(all_blocks, index, path, short)
        t = all_blocks[index].get('type')
        issues.append({'level': level, 'code': code, 'block_id': loc['block_id'],
                       'message': full or f'{where(t, index, path)}: {short[0].lower()}{short[1:]}',
                       'block_index': index, 'block_label': loc['block_label'], 'field': loc['field'],
                       'field_label': loc['field_label'], 'field_message': short})

    # Numbered as in the editor's list (hidden ones count: they are still in the list).
    numbered = [(i, b) for i, b in enumerate(all_blocks) if isinstance(b, dict)]
    visible = [(i, b) for i, b in numbered if not b.get('hidden')]

    if not visible:
        err('empty', 'La página no tiene secciones visibles: agregue una o muestre alguna de las ocultas.')
    for i, b in numbered:
        if b.get('hidden') and manifest().get(b.get('type'), {}).get('locked'):
            at('error', 'locked_hidden', i, '', 'Lleva un formulario o la agenda y no se puede ocultar. Vuelva a mostrarla.')

    prev, prev_i = None, 0
    for i, b in visible:
        props = b.get('props') or {}
        for name in section_schema(b.get('type')) or {}:
            if props.get(name) in (None, '', [], {}):
                at('error', 'required', i, name, 'Está vacío y es obligatorio.')
        if b.get('type') == 'rich_text' and not re.sub(r'<[^>]+>', '', str(props.get('html', ''))).strip():
            at('error', 'empty_text', i, 'html', 'No tiene contenido. Escriba el texto o elimine la sección.')
        if b.get('type') == 'gallery' and not props.get('images'):
            at('error', 'empty_gallery', i, 'images', 'La galería no tiene fotos.')
        if prev == b.get('type') and b.get('type') in ('hero', 'cta_band', 'stats'):
            label = manifest().get(b.get('type'), {}).get('label') or 'Sección'
            at('warning', 'duplicate', i, '', 'Es del mismo tipo que la sección anterior; ¿se duplicó por error?',
               f'Secciones {prev_i + 1} y {i + 1} ({label}): son del mismo tipo y van seguidas; ¿se duplicó por error?')
        prev, prev_i = b.get('type'), i

    refs = [(i, path, mid) for i, b in visible for path, mid in image_ref_paths(b)]
    if ctx is not None:
        assets = ctx.assets
    else:
        assets = {a.pk: a for a in MediaAsset.objects.filter(pk__in=[mid for _i, _p, mid in refs])} if refs else {}
    for i, path, mid in refs:
        a = assets.get(mid)
        if a is None:
            at('error', 'missing_image', i, path, 'La imagen se borró de la biblioteca de medios. Elija otra.')
        elif not a.alt:
            at('error', 'missing_alt', i, path, f'La foto «{a.filename}» no tiene descripción (texto alternativo). Escríbala junto a la imagen.')

    known = ctx.known if ctx is not None else _known_paths()
    for i, path, href in _links_in(visible):
        h = href.strip()
        t = all_blocks[i].get('type')
        if not h or h.startswith(('http://', 'https://', 'mailto:', 'tel:', '#')):
            if h.startswith('http://'):
                at('warning', 'insecure_link', i, path, f'El enlace {h} no es seguro (http). Use https:// si el sitio lo permite.')
            continue
        if not h.startswith('/'):
            at('error', 'relative_link', i, path, f'El enlace «{h}» debe empezar con / (página del sitio) o con https://.')
            continue
        target = h.split('?')[0].split('#')[0].rstrip('/') or '/'
        if target in known or target.startswith(ROUTE_PREFIXES):
            continue
        at('error', 'broken_link', i, path, f'Enlace roto: {h} no lleva a ninguna página ni redirección. Elija otro destino.',
           f'Enlace roto. {where(t, i, path)}: {h} no lleva a ninguna página ni redirección del sitio.')

    # SEO: an empty field shows the design's own title and description, so only
    # what the school typed (or the old seed left behind) is checked.
    seo = page.seo or {}
    defaults = template_seo(page.slug)
    og = seo.get('og_image')
    is_id = isinstance(og, int) and not isinstance(og, bool)
    if is_id and ((og not in ctx.assets) if ctx is not None else not MediaAsset.objects.filter(pk=og).exists()):
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
