"""
Who are probably siblings: suggestions for the Familias table (2026-11-13).

Signals, from strongest to weakest:

* **Mismo tutor**: both students are linked to the same Padre/Tutor account.
* **Mismo correo personal**: their logins confirmed the same personal address
  for notices (``User.notify_email``, confirmed by link).
* **Mismo teléfono**: the same 10-digit number as emergency phone, WhatsApp
  of the login, or phone of the Loyverse customer.
* **Mismos apellidos**: both surnames identical (a single surname is too
  common to mean anything alone).

A value shared by more than ``MAX_SHARED`` students is ignored (the school's
own phone, a placeholder). Students linked by any signal form a group; the
group is **alta** when the strong signals alone connect it, **media** when it
needs the surnames. Groups whose students already share one family, groups
bigger than a family may be, and pairs the office dismissed are left out.

Only active, non-archived students are considered. 386 students take a few
milliseconds: the whole roster is read once, nothing is cached.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from itertools import combinations

from django.db.models import Prefetch

from .families import FAMILY_MAX_STUDENTS, student_summary
from .models import FamilySuggestionDismissal, StudentProfile, User

MAX_SHARED = 6

STRONG_KINDS = ('guardian', 'email', 'phone')
KIND_LABEL = {
    'guardian': 'Mismo tutor',
    'email': 'Mismo correo personal',
    'phone': 'Mismo teléfono',
    'surname': 'Mismos apellidos',
}


def _fold(text: str) -> str:
    text = unicodedata.normalize('NFKD', text or '')
    text = ''.join(c for c in text if not unicodedata.combining(c))
    return ' '.join(text.lower().split())


def _phone(raw: str) -> str:
    digits = re.sub(r'\D', '', raw or '')
    if len(digits) < 10:
        return ''
    tail = digits[-10:]
    return '' if len(set(tail)) <= 2 else tail      # 0000000000, 5555555555…


def _pretty_phone(tail: str) -> str:
    return f'{tail[:2]} {tail[2:6]} {tail[6:]}'


def _keys(s: StudentProfile) -> list[tuple[str, str, str]]:
    """``(kind, key, shown value)`` signals of one student."""
    out: list[tuple[str, str, str]] = []
    for g in s.parents.all():
        if g.pk != s.user_id and g.role == User.Role.PARENT:
            out.append(('guardian', str(g.pk), g.email))
    user = s.user
    if user.notify_email and user.notify_email_verified_at:
        email = user.notify_email.strip().lower()
        out.append(('email', email, email))
    phones = {_phone(s.emergency_phone), _phone(user.whatsapp)}
    loyverse = getattr(s, 'loyverse_profile', None)
    if loyverse is not None:
        phones.add(_phone(loyverse.phone_number))
    for p in sorted(p for p in phones if p):
        out.append(('phone', p, _pretty_phone(p)))
    surname = _fold(user.last_name)
    if len(surname.split()) >= 2:
        out.append(('surname', surname, ' '.join(user.last_name.split())))
    return out


class _UnionFind:
    def __init__(self):
        self.parent: dict[int, int] = {}

    def find(self, x: int) -> int:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def suggestion_key(ids) -> str:
    return '-'.join(str(i) for i in sorted(int(i) for i in ids))


def parse_key(key) -> list[int]:
    parts = str(key or '').split('-')
    if len(parts) < 2 or not all(p.isdigit() for p in parts):
        raise ValueError('Sugerencia no válida.')
    return sorted({int(p) for p in parts})


def candidates_qs():
    return (StudentProfile.objects
            .filter(status=StudentProfile.Status.ACTIVE, user__archived_at__isnull=True)
            .select_related('user', 'family', 'loyverse_profile')
            .prefetch_related(Prefetch('parents', queryset=User.objects.only('id', 'email', 'role'))))


def build_suggestions(*, student_id: int | None = None) -> list[dict]:
    """Every current suggestion (or only the ones that include ``student_id``)."""
    students = {s.pk: s for s in candidates_qs()}
    by_value: dict[tuple[str, str], list[int]] = defaultdict(list)
    shown: dict[tuple[str, str], str] = {}
    for s in students.values():
        for kind, key, value in _keys(s):
            by_value[(kind, key)].append(s.pk)
            shown[(kind, key)] = value

    dismissed = set(FamilySuggestionDismissal.objects.values_list('student_a_id', 'student_b_id'))
    strong, every = _UnionFind(), _UnionFind()
    edges: dict[tuple[int, int], set[tuple[str, str]]] = defaultdict(set)
    for (kind, key), ids in by_value.items():
        ids = sorted(set(ids))
        if len(ids) < 2 or len(ids) > MAX_SHARED:
            continue
        for a, b in combinations(ids, 2):
            if (a, b) in dismissed:
                continue
            edges[(a, b)].add((kind, key))
            every.union(a, b)
            if kind in STRONG_KINDS:
                strong.union(a, b)

    groups: dict[int, list[int]] = defaultdict(list)
    for pk in {pk for pair in edges for pk in pair}:
        groups[every.find(pk)].append(pk)

    out = []
    for ids in groups.values():
        ids.sort()
        if len(ids) < 2 or len(ids) > FAMILY_MAX_STUDENTS:
            continue
        if student_id is not None and student_id not in ids:
            continue
        members = [students[i] for i in ids]
        fams = {m.family_id for m in members}
        if len(fams) == 1 and None not in fams:
            continue  # already one family
        reasons: dict[tuple[str, str], dict] = {}
        for (a, _b), signals in edges.items():
            if a in ids:
                for kind, key in signals:
                    reasons.setdefault((kind, key), {
                        'kind': kind, 'label': KIND_LABEL[kind], 'value': shown[(kind, key)]})
        confidence = 'alta' if len({strong.find(i) for i in ids}) == 1 else 'media'
        families = {}
        for m in members:
            if m.family_id:
                families[m.family_id] = {'id': m.family_id, 'name': m.family.name}
        order = {k: n for n, k in enumerate(('guardian', 'email', 'phone', 'surname'))}
        out.append({
            'key': suggestion_key(ids),
            'confidence': confidence,
            'students': [student_summary(m) for m in sorted(members, key=lambda m: (m.user.first_name, m.pk))],
            'reasons': sorted(reasons.values(), key=lambda r: (order[r['kind']], r['value'])),
            'families': list(families.values()),
        })
    out.sort(key=lambda g: (g['confidence'] != 'alta', _fold(g['students'][0]['last_name']), g['key']))
    return out


def dismiss(student_ids, actor=None) -> int:
    """Never suggest these students together again; returns new pairs stored."""
    ids = sorted({int(i) for i in student_ids})
    existing = set(StudentProfile.objects.filter(pk__in=ids).values_list('pk', flat=True))
    rows = [FamilySuggestionDismissal(student_a_id=a, student_b_id=b,
                                      dismissed_by=actor if getattr(actor, 'pk', None) else None)
            for a, b in combinations(sorted(existing), 2)]
    before = FamilySuggestionDismissal.objects.count()
    FamilySuggestionDismissal.objects.bulk_create(rows, ignore_conflicts=True)
    return FamilySuggestionDismissal.objects.count() - before
