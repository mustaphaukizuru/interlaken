"""
core/ordering.py — a whitelisted ``?ordering=`` for the admin data tables.

The console tables (pagos, movimientos de cafetería, auditoría) were fixed to
"newest first". Anyone asking "which was the largest top-up this month?" had to
export a CSV, because sorting server-side is the only sort that means anything
once a list is paginated: re-ordering the twenty rows of page 1 in the browser
answers a different question than the user asked.

Whitelisted per call site — never pass user input straight to ``order_by``,
which would expose relation traversal (``user__password``-style probing of the
schema through error messages) and unindexed sorts over the whole table.
"""
from __future__ import annotations

Fields = str | tuple[str, ...]


def _expand(fields: Fields, desc: bool) -> list[str]:
    """``'created_at'`` or ``('last_name', 'first_name')`` → ``order_by`` args.

    A leading ``-`` on a field flips its own direction (so a default of
    ``'-created_at'`` keeps working); ``desc`` flips the whole key.
    """
    names = (fields,) if isinstance(fields, str) else fields
    out = []
    for name in names:
        neg = name.startswith('-')
        bare = name[1:] if neg else name
        out.append(f'-{bare}' if neg != desc else bare)
    return out


def apply_ordering(qs, request, allowed: dict[str, Fields], default: Fields):
    """Order ``qs`` by ``?ordering=[-]<key>`` where ``key`` is in ``allowed``.

    ``allowed`` maps the public key (what the URL and the column header use) to
    the real ORM field, or to a tuple of fields for compound sorts such as
    ``('user__last_name', 'user__first_name')``. An unknown or absent key falls
    back to ``default`` silently: a bad sort should show the default list, not
    a 400 in the middle of an admin's workflow.

    A stable ``-pk`` tiebreak is always appended, so rows sharing a timestamp
    cannot swap places between page 1 and page 2 and hide a row entirely.
    """
    raw = (request.query_params.get('ordering') or '').strip()
    desc = raw.startswith('-')
    key = raw[1:] if desc else raw
    fields = allowed.get(key)
    if not fields:
        return qs.order_by(*_expand(default, False), '-pk')
    return qs.order_by(*_expand(fields, desc), '-pk')
