"""
content/page_templates.py: the public pages that render a designed template.

Every public page is a template of designed sections in the frontend
(cms/sections, docs/CMS-COMPLETION-PLAN.md). The backend never sees the
section defaults, only this generated summary (template_manifest.json, written
by frontend/src/cms/manifest.test.ts):

    {slug: {path, title, seo: {title, description}}}

``seo`` is what the site shows when the CMS page sets no SEO of its own: the
template's values, else the route defaults of RouteSeo. Years that roll over
on 1 January are tokens (``{{ciclo}}``, ``{{anios}}``) expanded here, so the
manifest never goes stale with the calendar.
"""
from __future__ import annotations

import json
import re
from datetime import date
from functools import lru_cache
from pathlib import Path

TEMPLATE_MANIFEST_PATH = Path(__file__).with_name('template_manifest.json')
# frontend/src/lib/siteMeta.ts FOUNDED_YEAR / SITE_NAME
FOUNDED_YEAR = 1981
SITE_NAME = 'Colegio Interlaken'
_TOKEN_RE = re.compile(r'\{\{\s*(ciclo|anios)\s*\}\}')


@lru_cache(maxsize=1)
def template_manifest() -> dict[str, dict]:
    try:
        return json.loads(TEMPLATE_MANIFEST_PATH.read_text(encoding='utf-8'))['templates']
    except (OSError, ValueError, KeyError):
        return {}


def has_template(slug: str) -> bool:
    """True when the page at this slug is one of the designed public pages."""
    return slug in template_manifest()


def expand_tokens(text: str, today: date | None = None, *, costos: bool = False) -> str:
    """``{{ciclo}}``: the school cycle the site announces (Costos: the cycle of its
    published prices); ``{{anios}}``: years since the school was founded (site_years)."""
    from .site_years import expand_tokens as expand
    return expand(text, today, costos=costos)


def template_seo(slug: str, today: date | None = None, *, expand: bool = True) -> dict[str, str]:
    """{title, description} the site shows for a designed page without CMS SEO ('' when none).

    ``expand=False`` keeps the tokens (the server head expands them on every request)."""
    seo = (template_manifest().get(slug) or {}).get('seo') or {}
    raw = {k: str(seo.get(k) or '') for k in ('title', 'description')}
    return {k: expand_tokens(v, today, costos=slug == 'costos') for k, v in raw.items()} if expand else raw


def full_title(title: str) -> str:
    """Browser/share title: the site name is appended once, never twice (Seo.tsx does the same)."""
    title = (title or '').strip()
    if not title:
        return SITE_NAME
    return title if SITE_NAME.lower() in title.lower() else f'{title} · {SITE_NAME}'
