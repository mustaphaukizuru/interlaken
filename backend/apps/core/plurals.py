"""
core/plurals.py — counts that agree in number («1 reserva», «3 reservas»).

The console used to write «6 persona(s) activa(s)»: Spanish has no neutral
form, and the «(s)» reads as a form letter. ``count(n, one, many)`` picks the
singular or the plural phrase for ``n``.
"""
from __future__ import annotations


def count(n: int, one: str, many: str) -> str:
    """``f'{n} {one}'`` when ``n == 1``, else ``f'{n} {many}'``.

    >>> count(1, 'reserva asociada', 'reservas asociadas')
    '1 reserva asociada'
    >>> count(3, 'reserva asociada', 'reservas asociadas')
    '3 reservas asociadas'
    """
    return f'{n} {one if n == 1 else many}'
