"""
accounts/people.py — pupils and staff cafetería accounts, one set of rules.

2026-11-18 (owner decisions A2-A9): school staff use the cafetería with the
same Loyverse card, wallet, card top-ups, statement and credential as pupils,
because the money flows are shared. A staff member is therefore a
``StudentProfile`` with ``tipo='personal'`` and a ``puesto`` instead of a
grade. Everything here answers "is this a pupil or a staff member?" so the
student-only rules (counts and KPIs, the Alumnos list, promotion, family
comunicados, admissions, leaver detection, guardian notices) can leave staff
out without each one re-inventing the test.

How a staff member signs in: their school Google address. A new staff login is
created with ``role='student'`` (the family-portal role: no console, no site
content editing, which ``role='staff'`` would grant). A staff member whose
address already has an account (a console user such as colegio@, or a parent)
keeps that account and its role; the cafetería profile is attached to it. A
cafetería account never grants console access: console rights come from
``User.role`` / ``User.staff_areas`` only, which nothing here changes.
"""
from __future__ import annotations

import re

from django.db.models import Q

from .models import StudentProfile, User

ALUMNO = StudentProfile.Tipo.ALUMNO
PERSONAL = StudentProfile.Tipo.PERSONAL

# Every staff card in Loyverse is named «ZP-Nombre Apellido» (no pupil's is).
_STAFF_PREFIX_RE = re.compile(r'^\s*ZP\s*-\s*', re.IGNORECASE)


def is_staff_customer(customer: dict) -> bool:
    """A Loyverse customer is a staff card iff its name starts with «ZP-»."""
    return bool(_STAFF_PREFIX_RE.match(str((customer or {}).get('name') or '')))


def strip_staff_prefix(name) -> str:
    """«ZP-Ana Pérez» → «Ana Pérez» (display names never carry the prefix)."""
    return _STAFF_PREFIX_RE.sub('', str(name or '')).strip()


def split_staff_name(name) -> tuple[str, str]:
    """(first_name, last_name) of a staff card, prefix removed.

    Staff cards are written «Nombre(s) Apellido Apellido» (pupils' are the
    other way round), so with three or more words the last two are the
    apellidos. A heuristic the office corrects in the form when it misses.
    """
    parts = strip_staff_prefix(name).split()
    if not parts:
        return 'Personal', ''
    if len(parts) <= 2:
        return parts[0], ' '.join(parts[1:])
    return ' '.join(parts[:-2]), ' '.join(parts[-2:])


def normalize_code(value, tipo=ALUMNO) -> str:
    """The matrícula or Loyverse code as stored in ``StudentProfile.student_id``.

    Pupils keep ``normalize_matricula`` (``ci09932`` → ``09932``). A staff code
    is stored as written (``jperez``, ``900001``): stripping a leading «ci»
    would mangle a surname code such as ``cisneros``.
    """
    from apps.core.matricula import normalize_matricula

    text = str(value or '').strip()
    return text if tipo == PERSONAL else normalize_matricula(text)


def code_key(value, tipo=ALUMNO) -> str:
    """Case-insensitive matching key of a code (A6): ``JPEREZ`` == ``jperez``."""
    return normalize_code(value, tipo).lower()


def pupils(qs=None):
    """``qs`` (default: every profile) without staff accounts."""
    return (StudentProfile.objects.all() if qs is None else qs).filter(tipo=ALUMNO)


def staff_accounts(qs=None):
    """``qs`` (default: every profile) limited to staff accounts."""
    return (StudentProfile.objects.all() if qs is None else qs).filter(tipo=PERSONAL)


def personal_user_ids():
    """Subquery: the users that hold a staff cafetería account."""
    return StudentProfile.objects.filter(tipo=PERSONAL).values('user_id')


def staff_only_login_q() -> Q:
    """Users whose only reason to be a family-portal login is a staff wallet:
    ``role='student'`` holding a ``tipo='personal'`` profile. They are left out
    of family audiences (Padres / Alumnos) and join «Personal»."""
    return Q(role=User.Role.STUDENT, pk__in=personal_user_ids())


def is_staff_only_login(user) -> bool:
    if getattr(user, 'role', None) != User.Role.STUDENT or not getattr(user, 'pk', None):
        return False
    return StudentProfile.objects.filter(user_id=user.pk, tipo=PERSONAL).exists()


def own_cafeteria_account(user) -> StudentProfile | None:
    """The staff cafetería account ``user`` holds itself, or None."""
    if user is None or not getattr(user, 'is_authenticated', False) or not getattr(user, 'pk', None):
        return None
    return (StudentProfile.objects.filter(user_id=user.pk, tipo=PERSONAL)
            .select_related('user').first())


def cafeteria_account_payload(user) -> dict | None:
    """What /accounts/me/ says about the caller's own staff wallet (the SPA shows
    «Mi cafetería» from it). None for everyone without one."""
    profile = own_cafeteria_account(user)
    if profile is None:
        return None
    return {
        'id': profile.pk,
        'tipo': profile.tipo,
        'puesto': profile.puesto,
        'puesto_label': profile.get_puesto_display() or 'Sin asignar',
        'is_active': profile.is_active,
        'linked': bool(profile.loyverse_id),
    }


def convert_to_personal(profile: StudentProfile, *, actor=None, puesto: str = '',
                        context: str = 'portal: convertir a personal') -> dict:
    """Turn a pupil record into a staff account, keeping wallet and history.

    The grade and group are cleared (a staff member is never promoted, counted
    or targeted by grade) and recorded in the audit row so the change can be
    undone by hand. Login, role, Loyverse link, balance and movements are left
    untouched. Returns the changes written ({} when already staff).
    """
    from apps.core.audit import record

    if profile.tipo == PERSONAL:
        return {}
    changes = {
        'tipo': [profile.tipo, PERSONAL],
        'puesto': [profile.puesto, puesto or StudentProfile.Puesto.SIN_ASIGNAR],
        'grade': [profile.grade, ''],
        'group': [profile.group, ''],
    }
    profile.tipo = PERSONAL
    profile.puesto = puesto or StudentProfile.Puesto.SIN_ASIGNAR
    profile.grade = ''
    profile.group = ''
    profile.save(update_fields=['tipo', 'puesto', 'grade', 'group'])
    record('update', profile, {'via': 'portal', **changes}, actor=actor, context=context)
    return changes
