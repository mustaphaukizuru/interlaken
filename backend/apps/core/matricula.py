"""
core/matricula.py — the one place that knows how a matrícula is spelled.

Loyverse writes the student code as ``ci09932`` (the office added the ``ci``
prefix after Loyverse's bulk import dropped leading zeros and the barcode
stopped matching at the register). The app stores the canonical digits
``09932`` in ``StudentProfile.student_id`` and shows the Loyverse spelling
under "Código Loyverse". Every search and every importer must treat the two as
one key, so they all normalise through here instead of each keeping its own
regex (the cafetería import, the CSV import and the roster search each had a
different rule before 2026-09-24).
"""
import re

_CI_PREFIX_RE = re.compile(r'^ci', re.IGNORECASE)
_CI_CODE_RE = re.compile(r'^ci\d+$', re.IGNORECASE)


def normalize_matricula(code) -> str:
    """``ci09932`` → ``09932``; ``09932`` and ``''`` are returned unchanged
    (stripped). This is the key ``student_id`` is compared and stored by."""
    return _CI_PREFIX_RE.sub('', (code or '').strip())


def is_ci_code(term) -> bool:
    """True when ``term`` is the Loyverse spelling of a matrícula (``ci`` +
    digits), i.e. a search term that should also match the bare digits."""
    return bool(_CI_CODE_RE.match((term or '').strip()))


def search_key(term) -> str:
    """The term to look ``student_id`` up by: the bare digits when the person
    typed the Loyverse spelling, the term itself otherwise."""
    term = (term or '').strip()
    return normalize_matricula(term) if is_ci_code(term) else term
