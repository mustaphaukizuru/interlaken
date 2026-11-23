"""Years the public site writes by itself (mirror of frontend/src/lib/siteMeta.ts
announcedCycleStart and lib/priceYears.ts).

* The announced school cycle ({{ciclo}}): the cycle that starts in August of the
  current year, until the month chosen in Ajustes (SiteSettings.
  admissions_next_from_month); from that month on, the next one. January = the
  plain calendar rule.
* Costos is the exception: its cycle is the one the school published prices
  for (SiteSettings.pricing_years), or the announced one when that is newer
  (the page then says «Precios AAAA: pendientes»). It never moves with the
  calendar alone.
* {{anios}}: years since the school was founded.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

FOUNDED_YEAR = 1981
_TOKEN_RE = re.compile(r'\{\{\s*(ciclo|anios)\s*\}\}')
_YEARS_CACHE_KEY = 'content.site-years.v1'


def announced_cycle_start(today: date | None = None, from_month: int = 1) -> int:
    today = today or date.today()
    return today.year + 1 if from_month > 1 and today.month >= from_month else today.year


def price_cycle_start(years: dict | None, today: date | None = None, from_month: int = 1) -> int:
    published = [y for y in (years or {}).values() if isinstance(y, int) and not isinstance(y, bool)]
    return max([announced_cycle_start(today, from_month), *published])


def cycle_label(start: int) -> str:
    return f'{start}–{start + 1}'


def year_settings() -> tuple[int, dict]:
    """(admissions_next_from_month, pricing_years) from the site settings, cached; (1, {}) if the DB is down."""
    try:
        from django.core.cache import cache

        from .models import SiteSettings
        data = cache.get(_YEARS_CACHE_KEY)
        if data is None:
            s = SiteSettings.load()
            data = (int(s.admissions_next_from_month or 1), dict(s.pricing_years or {}))
            cache.set(_YEARS_CACHE_KEY, data, 300)
        return data
    except Exception:  # noqa: BLE001  (pages must render even without the database)
        return (1, {})


def forget_year_settings() -> None:
    from django.core.cache import cache
    cache.delete(_YEARS_CACHE_KEY)


def expand_tokens(text: str, today: date | None = None, *, costos: bool = False) -> str:
    """``{{ciclo}}`` and ``{{anios}}`` with today's values (``costos``: the cycle of the published prices)."""
    if not text or '{{' not in text:
        return text or ''
    today = today or date.today()
    from_month, years = year_settings()
    start = price_cycle_start(years, today, from_month) if costos else announced_cycle_start(today, from_month)
    values = {'ciclo': cycle_label(start), 'anios': str(today.year - FOUNDED_YEAR)}
    return _TOKEN_RE.sub(lambda m: values[m.group(1)], text)


PRICE_GROUPS = ('fees', 'tuition', 'insurance', 'extras', 'daycare')


def reminder_year(years: dict | None, today: date | None = None, from_month: int = 1) -> int:
    """The year the console asks to publish: from a month before the site moves to the next cycle."""
    today = today or date.today()
    next_month = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    return max(price_cycle_start(years, today, from_month), announced_cycle_start(next_month, from_month))


def missing_price_groups(today: date | None = None) -> tuple[int, list[str]]:
    """(year to publish, groups still on an older year) for the «Pendientes» list and the reminder."""
    from_month, years = year_settings()
    clean = {k: v for k, v in (years or {}).items() if k in PRICE_GROUPS and isinstance(v, int) and not isinstance(v, bool)}
    year = reminder_year(clean, today, from_month)
    return year, [g for g in PRICE_GROUPS if clean.get(g, 0) < year]
