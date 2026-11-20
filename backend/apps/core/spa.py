"""
SPA catch-all with first-paint shells (mobile performance follow-up to P1-B12).

The built index.html carries `<!--SHELL-->` inside `<div id="root">`. For a few
public routes we replace it with static hero markup from static/shells.json
(shipped by the frontend build), so the phone paints the headline as soon as the
CSS arrives instead of waiting ~3 s of JS on slow 4G. React's createRoot
replaces the node on mount; the markup mirrors the real hero so CLS stays 0.
Every other route (portal, login, unknown) gets an empty root exactly as before.

When the school has published a CMS version of the route, the shell is skipped
(it mirrors the built-in copy and would flash the old headline) and the page's
SEO title, description and share image are written into <head>, because social
crawlers (WhatsApp, Facebook) read the raw HTML and never run the app.
"""
from __future__ import annotations

import html as html_lib
import json
import re
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.template import TemplateDoesNotExist
from django.template.loader import get_template

MARKER = '<!--SHELL-->'


@lru_cache(maxsize=1)
def _shells() -> dict[str, str]:
    for base in (*getattr(settings, 'STATICFILES_DIRS', []), getattr(settings, 'STATIC_ROOT', None)):
        if not base:
            continue
        p = Path(base) / 'shells.json'
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding='utf-8'))
                return {k: v for k, v in data.items() if k.startswith('/') and isinstance(v, str)}
            except (OSError, ValueError):
                return {}
    return {}


@lru_cache(maxsize=1)
def _index_html() -> str:
    try:
        return get_template('index.html').template.source  # type: ignore[attr-defined]
    except (TemplateDoesNotExist, AttributeError):
        return ''


def shell_for(path: str) -> str:
    path = '/' + path.strip('/') if path.strip('/') else '/'
    return _shells().get(path, '')


def _cms_head(path: str) -> dict | None:
    try:
        from apps.content.pages import published_head
        return published_head(path)
    except Exception:  # noqa: BLE001  (the shell must render even if the DB is down)
        return None


def _set_meta(html: str, attr: str, name: str, value: str) -> str:
    """Replace the content of <meta {attr}="{name}" content="…">; leaves the page untouched if absent."""
    pattern = re.compile(rf'(<meta\s+{attr}="{re.escape(name)}"\s+content=")[^"]*(")')
    return pattern.sub(lambda m: m.group(1) + html_lib.escape(value, quote=True) + m.group(2), html, count=1)


def apply_head(html: str, head: dict) -> str:
    title = head.get('title')
    desc = head.get('description')
    image = head.get('image')
    if title:
        full = html_lib.escape(f'{title} · Colegio Interlaken')
        html = re.sub(r'<title>[^<]*</title>', f'<title>{full}</title>', html, count=1)
        html = _set_meta(html, 'property', 'og:title', f'{title} · Colegio Interlaken')
        html = _set_meta(html, 'name', 'twitter:title', f'{title} · Colegio Interlaken')
    if desc:
        for attr, name in (('name', 'description'), ('property', 'og:description'), ('name', 'twitter:description')):
            html = _set_meta(html, attr, name, desc)
    if image:
        html = _set_meta(html, 'property', 'og:image', image)
        html = _set_meta(html, 'name', 'twitter:image', image)
    if head.get('noindex'):
        html = html.replace('</head>', '<meta name="robots" content="noindex" />\n</head>', 1)
    return html


def spa_index(request):
    html = _index_html()
    if not html:
        from django.views.generic import TemplateView
        return TemplateView.as_view(template_name='index.html')(request)
    head = _cms_head(request.path)
    html = html.replace(MARKER, '' if head else shell_for(request.path), 1)
    if head:
        html = apply_head(html, head)
    resp = HttpResponse(html, content_type='text/html; charset=utf-8')
    resp['Cache-Control'] = 'no-cache'
    return resp
