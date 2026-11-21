"""
admissions/cycles.py — the Mexican school year (August to July) for the ficha.

A school year starts in August: from August 2026 to July 2027 the *running*
cycle is «2026-2027» and the *next* one «2027-2028». The ficha's public start
asks the family to choose one of those two (``actual`` / ``proximo``).

``models.current_school_cycle()`` (calendar year to next, which matches the
frontend ``CURRENT_CYCLE``) is deliberately left alone in this phase.
"""

from __future__ import annotations

import re
from datetime import date

from django.utils import timezone

# A school year starts in this month.
CYCLE_START_MONTH = 8

CYCLE_RE = re.compile(r"^(\d{4})-(\d{4})$")

ACTUAL = "actual"
PROXIMO = "proximo"


def _today(today: date | None) -> date:
    return today or timezone.localdate()


def cycle_start_year(today: date | None = None) -> int:
    """First calendar year of the running cycle (Nov 2026 → 2026, Mar 2027 → 2026)."""
    d = _today(today)
    return d.year if d.month >= CYCLE_START_MONTH else d.year - 1


def format_cycle(start_year: int) -> str:
    return f"{start_year}-{start_year + 1}"


def running_cycle(today: date | None = None) -> str:
    """The school year in progress: Nov 2026 → '2026-2027'; Sep 2027 → '2027-2028'."""
    return format_cycle(cycle_start_year(today))


def next_cycle(today: date | None = None) -> str:
    """The school year after the running one: Nov 2026 → '2027-2028'."""
    return format_cycle(cycle_start_year(today) + 1)


def cycle_for_choice(choice: str, today: date | None = None) -> str | None:
    """``'actual'`` / ``'proximo'`` → the cycle string; anything else → None."""
    if choice == ACTUAL:
        return running_cycle(today)
    if choice == PROXIMO:
        return next_cycle(today)
    return None


def allowed_cycles(today: date | None = None) -> tuple[str, str]:
    """The two cycles a family may choose today: (running, next)."""
    return running_cycle(today), next_cycle(today)


def parse_cycle(value: str) -> int | None:
    """First year of a well-formed «AAAA-AAAA» cycle (second = first + 1), else None."""
    m = CYCLE_RE.match((value or "").strip())
    if not m:
        return None
    first, second = int(m.group(1)), int(m.group(2))
    return first if second == first + 1 else None


def cycle_choices(today: date | None = None) -> list[dict]:
    """The ``ciclo`` options of the ficha schema (value = the cycle string)."""
    running, upcoming = allowed_cycles(today)
    return [
        {"key": ACTUAL, "value": running, "label": f"{running} (ciclo en curso)"},
        {"key": PROXIMO, "value": upcoming, "label": f"{upcoming} (próximo ciclo)"},
    ]
