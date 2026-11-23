"""
SPA catch-all: the one view that answers every page URL with the built index.html.

It does four things a static catch-all cannot, because crawlers and link
previews (Googlebot's first pass, Bing, WhatsApp, Facebook, AI crawlers) read
the RAW HTML and the HTTP status, not what the app paints later:

1. Per-URL head. For every route in frontend/src/lib/siteMeta.ts ROUTE_META the
   build writes static/seo-routes.json; the title, description, canonical,
   og:*/twitter:* values and the page JSON-LD from it are written into the
   HTML here. A published CMS version of the page refines title, description
   and share image. Before this, every URL declared the home page as canonical.
2. Honest status codes. Unknown paths answer 404 (410 for spam paths a previous
   owner of the domain left in Google's index) with noindex, while the SPA
   still renders its 404 page. They used to answer 200 (soft 404s).
3. Server-side redirects. Trailing slashes, the CMS Redirect table and the
   App.tsx aliases answer real 301/302s instead of a client-side jump.
4. First-paint shells (P1-B12 follow-up). For a few public routes the
   `<!--SHELL-->` marker inside #root becomes static hero markup from
   static/shells.json, so a phone paints the headline before ~3 s of JS on 4G.
   React's createRoot replaces it on mount; the markup mirrors the real hero so
   CLS stays 0. A published CMS version skips the shell (it would flash the
   built-in headline).
"""
from __future__ import annotations

import html as html_lib
import json
import re
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse, HttpResponsePermanentRedirect, HttpResponseRedirect
from django.template import TemplateDoesNotExist
from django.template.loader import get_template

MARKER = '<!--SHELL-->'
HEAD_MARKER = '<!--HEAD-->'
SITE = 'https://interlaken.edu.mx'
SUFFIX = ' · Colegio Interlaken'

# Real SPA screens that are not public pages (login, portal, consoles, checkout
# returns). They answer 200 + noindex; robots.txt also keeps most of them out.
APP_PREFIXES = ('/portal', '/staff', '/admin', '/alumno', '/login', '/pago/')

# Aliases App.tsx used to resolve with <Navigate>; a 301 passes their ranking on.
CODE_REDIRECTS = {
    '/puertas-abiertas': '/agendar-visita',
    # The ficha de inscripción replaced the old wizard (Fase 2); staff links
    # sent before it carry /inscripcion?rid=&token= (the query is kept).
    '/inscripcion': '/pre-registro',
    '/comunidad/plataformas': '/pagos',
    '/calendario': '/',
}

# Paths a previous owner of interlaken.edu.mx left in Google's index (a blog
# under /testmama/ and forum spam). 410 Gone drops them faster than a 404.
GONE_PREFIXES = ('/testmama', '/forum', '/wp-content', '/wp-includes', '/tag/', '/category/')

NOT_FOUND_HEAD = {
    'title': 'Página no encontrada' + SUFFIX,
    'description': 'La página que busca no existe o fue movida.',
    'robots': 'noindex',
    'jsonLd': [],
}


@lru_cache(maxsize=4)
def _static_json(name: str) -> dict:
    for base in (*getattr(settings, 'STATICFILES_DIRS', []), getattr(settings, 'STATIC_ROOT', None)):
        if not base:
            continue
        p = Path(base) / name
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                return {}
            return {k: v for k, v in data.items() if isinstance(k, str) and k.startswith('/')}
    return {}


def _shells() -> dict[str, str]:
    return {k: v for k, v in _static_json('shells.json').items() if isinstance(v, str)}


def _seo_routes() -> dict[str, dict]:
    return {k: v for k, v in _static_json('seo-routes.json').items() if isinstance(v, dict)}


@lru_cache(maxsize=1)
def _index_html() -> str:
    try:
        return get_template('index.html').template.source  # type: ignore[attr-defined]
    except (TemplateDoesNotExist, AttributeError):
        return ''


def clear_caches() -> None:
    """Forget the cached index.html and JSON files (tests; a deploy restarts the process anyway)."""
    _static_json.cache_clear()
    _index_html.cache_clear()


def normalize(path: str) -> str:
    return '/' + path.strip('/') if path.strip('/') else '/'


def shell_for(path: str) -> str:
    return _shells().get(normalize(path), '')


# ── CMS lookups (cached; the page must render even if the DB is down) ─────────
def _redirects() -> dict:
    try:
        from apps.content.navigation import REDIRECTS_CACHE_KEY, Redirect
        data = cache.get(REDIRECTS_CACHE_KEY)
        if data is None:
            data = {r.from_path: {'to': r.to_path, 'permanent': r.permanent} for r in Redirect.objects.all()}
            cache.set(REDIRECTS_CACHE_KEY, data, 3600)
        return data
    except Exception:  # noqa: BLE001
        return {}


def _cms_head(path: str) -> dict | None:
    """Published CMS SEO for a path (apps.content.pages.published_head, cached 5 min)."""
    try:
        from apps.content.pages import published_head
        if path.startswith('/p/'):
            path = '/' + path[3:]   # /p/verano is the same page as /verano
        return published_head(path)
    except Exception:  # noqa: BLE001  (the page must render even if the DB is down)
        return None


# ── Head rewriting ─────────────────────────────────────────────────────────
def _attr(value: str) -> str:
    return html_lib.escape(value, quote=True)


def _set_meta(doc: str, attr: str, name: str, value: str) -> str:
    """Replace the content of the one <meta {attr}="{name}" content="…"> tag (no-op if absent)."""
    pattern = re.compile(rf'(<meta\s+{attr}="{re.escape(name)}"\s+content=")[^"]*(")')
    return pattern.sub(lambda m: m.group(1) + _attr(value) + m.group(2), doc, count=1)


def _ld(block: dict) -> str:
    # Same serialisation as JSON.stringify, and "<" escaped so no value can close the tag.
    text = json.dumps(block, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    return f'<script type="application/ld+json" data-page-ld>{text}</script>'


def apply_head(doc: str, head: dict, path: str | None = None) -> str:
    """Write a head into the page. Titles go through full_title (the site name once,
    never twice); `noindex` (CMS) and `robots` (route table) both mark the page;
    canonical/og:url are rewritten when the head or the path gives one."""
    from apps.content.page_templates import full_title

    title = head.get('title')
    desc = head.get('description')
    image = head.get('image')
    canonical = head.get('canonical') or (SITE + path if path else None)
    robots = head.get('robots') or ('noindex' if head.get('noindex') else None)
    if title:
        title = full_title(title)
        doc = re.sub(r'<title>[^<]*</title>', lambda _m: f'<title>{html_lib.escape(title)}</title>', doc, count=1)
        doc = _set_meta(doc, 'property', 'og:title', title)
        doc = _set_meta(doc, 'name', 'twitter:title', title)
    if desc:
        for attr, name in (('name', 'description'), ('property', 'og:description'), ('name', 'twitter:description')):
            doc = _set_meta(doc, attr, name, desc)
    if image:
        doc = _set_meta(doc, 'property', 'og:image', image)
        doc = _set_meta(doc, 'name', 'twitter:image', image)
    if canonical:
        doc = re.sub(r'(<link rel="canonical" href=")[^"]*(")', lambda m: m.group(1) + _attr(canonical) + m.group(2), doc, count=1)
        doc = _set_meta(doc, 'property', 'og:url', canonical)
    extra = []
    if robots:
        extra.append(f'<meta name="robots" content="{_attr(robots)}" />')
    extra.extend(_ld(b) for b in head.get('jsonLd') or [] if isinstance(b, dict))
    if extra:
        joined = '\n    '.join(extra)
        doc = doc.replace(HEAD_MARKER, joined, 1) if HEAD_MARKER in doc else doc.replace('</head>', joined + '\n</head>', 1)
    return doc.replace(HEAD_MARKER, '', 1)


def _cms_refine(head: dict, seo: dict) -> dict:
    out = dict(head)
    if seo.get('title'):
        out['title'] = seo['title']   # apply_head adds the site name once
    if seo.get('description'):
        out['description'] = seo['description']
    if seo.get('image'):
        out['image'] = seo['image']
    if seo.get('noindex'):
        out['robots'] = 'noindex'
    return out


def _with_years(head: dict, path: str) -> dict:
    """Title and description with today's school cycle and years ({{ciclo}}, {{anios}}).

    The build writes the route table with the tokens, not the values, so a
    deploy made in December still says the right cycle in January.
    """
    from apps.content.site_years import expand_tokens
    out = dict(head)
    for k in ('title', 'description'):
        if isinstance(out.get(k), str):
            out[k] = expand_tokens(out[k], costos=path == '/admisiones/costos')
    return out


def _redirect(to: str, permanent: bool, query: str):
    if query and not to.startswith('http') and '?' not in to:
        to = f'{to}?{query}'
    return HttpResponsePermanentRedirect(to) if permanent else HttpResponseRedirect(to)


def _render(doc: str, status: int = 200, path: str = '/') -> HttpResponse:
    resp = HttpResponse(doc, content_type='text/html; charset=utf-8', status=status)
    resp['Cache-Control'] = 'no-cache'
    if path == '/confirmar-correo':
        # The e-mail token rides in this URL's query: never leak it in a Referer.
        resp['Referrer-Policy'] = 'no-referrer'
    return resp


def spa_index(request):
    doc = _index_html()
    if not doc:
        from django.views.generic import TemplateView
        return TemplateView.as_view(template_name='index.html')(request)

    raw = request.path
    query = request.META.get('QUERY_STRING', '')
    path = normalize(raw)
    # 0. The service worker precaches /index.html and Workbox serves it for "/"
    #    (directoryIndex). It must answer 200 with the home page: a 404 here fails
    #    every service-worker install, so returning visitors keep the previous
    #    release's cached home page and code (prod, 2026-11-20). Same page as "/",
    #    whose canonical it carries.
    if path == '/index.html':
        path = '/'
    is_app = any(path == p.rstrip('/') or path.startswith(p if p.endswith('/') else p + '/') for p in APP_PREFIXES)
    gone = any(path == g.rstrip('/') or path.startswith(g.rstrip('/') + '/') for g in GONE_PREFIXES)

    # 0. Spam a previous owner left indexed: 410 straight away, slash or not (a
    #    301 to the slash-less form first only cost Google one more fetch).
    if gone:
        return _render(apply_head(doc.replace(MARKER, '', 1), NOT_FOUND_HEAD, path), 410, path)

    # 1. One URL per public page: /contacto/ → /contacto (the SPA serves both, Google
    #    saw two). Consoles and the portal are left alone: bookmarks like /admin/ work as before.
    if not is_app and raw != path and raw.rstrip('/') == path.rstrip('/') and request.method in ('GET', 'HEAD'):
        return _redirect(path, True, query)

    # 2. Redirects: retired CMS paths, then the code aliases.
    target = _redirects().get(path)
    if target and target.get('to') and target['to'] != path:
        try:
            from django.db.models import F

            from apps.content.navigation import Redirect
            Redirect.objects.filter(from_path=path).update(hits=F('hits') + 1)
        except Exception:  # noqa: BLE001
            pass
        return _redirect(target['to'], bool(target.get('permanent', True)), query)
    if path in CODE_REDIRECTS:
        return _redirect(CODE_REDIRECTS[path], True, query)

    # 3. Public pages from ROUTE_META (optionally refined by a published CMS version).
    head = _seo_routes().get(path)
    cms = _cms_head(path)
    if head is not None:
        if cms:
            head = _cms_refine(head, cms)
        head = _with_years(head, path)
        doc = doc.replace(MARKER, '' if cms else shell_for(path), 1)
        return _render(apply_head(doc, head, path), 200, path)

    doc = doc.replace(MARKER, '', 1)

    # 4. App screens (login, portal, consoles): real routes, never indexed.
    if is_app:
        return _render(apply_head(doc, {'robots': 'noindex'}, path), 200, path)

    # 5. CMS landing pages (/verano; /p/verano is the same page, so it points its canonical there).
    if cms:
        canonical = SITE + ('/' + path[3:] if path.startswith('/p/') else path)
        head = _with_years(_cms_refine({'jsonLd': [], 'canonical': canonical}, cms), path)
        return _render(apply_head(doc, head, path), 200, path)

    # 6. Nothing here.
    return _render(apply_head(doc, NOT_FOUND_HEAD, path), 404, path)
