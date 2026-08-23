"""
admissions/eligibility.py — age rule for pre-registration (BACKLOG P1-G1).

School rule (WhatsApp, 2026-08-21): the child must have the required age on
**31 December of the current year**:

    Maternal      2 years
    1° Preescolar 3
    2° Preescolar 4
    3° Preescolar 5
    1° Primaria   6

Higher grades follow the same +1 per grade progression (2° Primaria 7 … 3°
Secundaria 14). The check is strict on the public form; admins can still log
exceptions from the console.
"""
from __future__ import annotations

import re
from datetime import date

from django.utils import timezone

_BASE = {'maternal': 2, 'preescolar': 2, 'primaria': 5, 'secundaria': 11}


def required_age(grade: str) -> int | None:
    """Required age for a grade label like 'Preescolar 1°', '1° Primaria', 'Maternal'."""
    g = (grade or '').lower()
    if 'maternal' in g:
        return _BASE['maternal']
    m = re.search(r'(\d)', g)
    n = int(m.group(1)) if m else None
    for level in ('preescolar', 'primaria', 'secundaria'):
        if level in g:
            return _BASE[level] + (n or 1)
    return None


def age_on_dec31(dob: date, year: int | None = None) -> int:
    year = year or timezone.localdate().year
    ref = date(year, 12, 31)
    return ref.year - dob.year - ((ref.month, ref.day) < (dob.month, dob.day))


def eligibility_error(dob: date, grade: str) -> str | None:
    """None when eligible; otherwise a Spanish message for the form."""
    need = required_age(grade)
    if need is None or dob is None:
        return None
    have = age_on_dec31(dob)
    if have == need:
        return None
    year = timezone.localdate().year
    return (f'Para {grade} el alumno debe tener {need} años cumplidos al 31 de diciembre de {year} '
            f'(tendrá {have}). Elija el grado que corresponde a su edad o contacte a admisiones.')
