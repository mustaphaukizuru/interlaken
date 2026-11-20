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


def expand_tokens(text: str, today: date | None = None) -> str:
    """``{{ciclo}}`` → the school year (2026 and 2027 joined like CURRENT_CYCLE), ``{{anios}}`` → years since the school was founded."""
    if not text or '{{' not in text:
        return text or ''
    year = (today or date.today()).year
    values = {'ciclo': f'{year}\u2013{year + 1}', 'anios': str(year - FOUNDED_YEAR)}
    return _TOKEN_RE.sub(lambda m: values[m.group(1)], text)


def template_seo(slug: str, today: date | None = None) -> dict[str, str]:
    """{title, description} the site shows for a designed page without CMS SEO ('' when none)."""
    seo = (template_manifest().get(slug) or {}).get('seo') or {}
    return {k: expand_tokens(str(seo.get(k) or ''), today) for k in ('title', 'description')}


def full_title(title: str) -> str:
    """Browser/share title: the site name is appended once, never twice (Seo.tsx does the same)."""
    title = (title or '').strip()
    if not title:
        return SITE_NAME
    return title if SITE_NAME.lower() in title.lower() else f'{title} · {SITE_NAME}'
