"""
SPA catch-all with first-paint shells (mobile performance follow-up to P1-B12).

The built index.html carries `<!--SHELL-->` inside `<div id="root">`. For a few
public routes we replace it with static hero markup from static/shells.json
(shipped by the frontend build), so the phone paints the headline as soon as the
CSS arrives instead of waiting ~3 s of JS on slow 4G. React's createRoot
replaces the node on mount; the markup mirrors the real hero so CLS stays 0.
Every other route (portal, login, unknown) gets an empty root exactly as before.
"""
from __future__ import annotations

import json
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


def spa_index(request):
    html = _index_html()
    if not html:
        from django.views.generic import TemplateView
        return TemplateView.as_view(template_name='index.html')(request)
    html = html.replace(MARKER, shell_for(request.path), 1)
    resp = HttpResponse(html, content_type='text/html; charset=utf-8')
    resp['Cache-Control'] = 'no-cache'
    return resp
