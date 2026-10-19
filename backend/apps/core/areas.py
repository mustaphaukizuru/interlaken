"""
core/areas.py — which parts of the admin console a staff account may use.

The console used to be all-or-nothing: ``role=admin`` saw everything (money,
users, settings) and ``role=staff`` (teachers, content editors) saw none of it.
A school also has people who need ONE part of it: the secretary (students,
admissions, families' passwords), reception (visits, the contact inbox), the
cafeteria cashier (balances, deposits, POS). Those are ``role=staff`` accounts
with ``User.staff_areas``, a list of the keys below.

How it is enforced (server side; the console only hides what the API refuses):

- an admin-console endpoint names the area it belongs to with ``admin_area``
  (a key or a tuple of keys); ``core.permissions.IsAdmin`` lets an admin in
  and, for that endpoint only, a staff account holding one of those areas;
- ``admin_area_read`` grants the same for safe (GET/HEAD/OPTIONS) requests only;
- an endpoint that names no area stays admin-only. ``ADMIN_ONLY`` below is the
  deliberate list (users, settings, site content, privacy, audit, new school
  year, account merges, emergency broadcast); ``core/test_areas.py`` fails the
  build when an admin endpoint is in neither, so every new one is a decision.

Medical data stays admin/family only whatever the areas (``accounts.medical``).
"""
from __future__ import annotations

from collections.abc import Iterable

# key → (label, what it opens). Order is the console's.
AREAS: dict[str, tuple[str, str]] = {
    'alumnos': ('Alumnos y familias',
                'Expedientes, tutores, altas e importaciones, vínculo con Loyverse.'),
    'accesos': ('Accesos de familias',
                'Solicitudes de contraseña y contraseñas temporales de padres y alumnos.'),
    'admisiones': ('Admisiones',
                   'Pre-registros, inscripciones, documentos y embudo.'),
    'visitas': ('Visitas y agenda',
                'Citas, horarios disponibles y agenda semanal.'),
    'mensajes': ('Mensajes y formularios',
                 'Bandeja de contacto y respuestas de formularios del sitio.'),
    'comunicados': ('Comunicados y calendario',
                    'Comunicados a familias y calendario escolar.'),
    'cafeteria': ('Cafetería y pagos',
                  'Saldos, depósitos, carga en POS, reconciliación y pagos con tarjeta.'),
}

# Puestos: ready-made area sets for the staff form ("Personalizado" = any mix).
PUESTOS: dict[str, tuple[str, tuple[str, ...]]] = {
    'secretaria': ('Secretaría', ('alumnos', 'accesos', 'admisiones', 'visitas',
                                  'mensajes', 'comunicados')),
    'recepcion': ('Recepción', ('visitas', 'mensajes')),
    'cafeteria': ('Cafetería', ('cafeteria',)),
}

ALL_AREAS = frozenset(AREAS)


def clean_areas(values: Iterable) -> list[str]:
    """Known area keys from ``values``, deduplicated, in console order.

    Raises ``ValueError`` naming the first unknown key.
    """
    wanted = []
    for v in values or ():
        key = str(v).strip().lower()
        if key not in AREAS:
            raise ValueError(f'Área desconocida: {v!r}.')
        wanted.append(key)
    return [k for k in AREAS if k in wanted]


def user_areas(user) -> frozenset[str]:
    """The areas ``user`` may use right now (every area for an admin)."""
    if not (user and getattr(user, 'is_authenticated', False) and getattr(user, 'is_active', False)):
        return frozenset()
    role = getattr(user, 'role', None)
    if role == 'admin':
        return ALL_AREAS
    if role != 'staff':
        return frozenset()
    return frozenset(a for a in (getattr(user, 'staff_areas', None) or ()) if a in AREAS)


def has_area(user, *areas: str) -> bool:
    """True when ``user`` may use at least one of ``areas`` (admins always)."""
    granted = user_areas(user)
    return any(a in granted for a in areas)


def as_tuple(value) -> tuple[str, ...]:
    if not value:
        return ()
    return (value,) if isinstance(value, str) else tuple(value)
