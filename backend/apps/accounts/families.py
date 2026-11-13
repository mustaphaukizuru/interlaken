"""
Families (hermanos): the rules the admin console applies (2026-11-13).

A ``Family`` groups siblings so every login of the family sees all of them
(``accounts.family.family_students``). The office links them from the
student's file (Familia tab), from the Familias table, or by accepting a
suggestion. Every operation here:

* runs in one transaction and locks the students and families it touches;
* keeps the invariant "a family has two or more students" (removing the
  second-to-last student dissolves it);
* writes an audit row on the family and on every student whose family
  changed (the student's Historial shows it);
* after the commit, tells each login that can now see more children
  (``notify``), unless the office unticks «Avisar a la familia».

``plan_link`` is the dry run of ``link_students``: the console shows it before
anything changes (who joins, which families merge, which logins gain access).
"""
from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field

from django.db import transaction
from django.db.models import Prefetch

from apps.core.audit import record

from .family import family_students
from .models import Family, StudentProfile, User

logger = logging.getLogger(__name__)

# Generous for one school's siblings; stops a wrong merge from snowballing.
FAMILY_MAX_STUDENTS = 10
NAME_MAX = 150

STATUS_LABEL = dict(StudentProfile.Status.choices)


class FamilyError(ValueError):
    """A request the rules refuse; the message is shown to the office as is."""


# ── summaries (shared by every endpoint) ───────────────────
def student_summary(s: StudentProfile) -> dict:
    user = s.user
    return {
        'id': s.pk,
        'name': user.full_name,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'email': user.email,
        'student_id': s.student_id,
        'grade': s.grade,
        'group': s.group,
        'status': s.status,
        'status_label': STATUS_LABEL.get(s.status, s.status),
        'archived': bool(user.archived_at),
        'family': ({'id': s.family_id, 'name': s.family.name} if s.family_id else None),
    }


def _login_kind(user: User, own_ids: set[int]) -> tuple[str, str]:
    if user.pk in own_ids:
        return 'student', 'Cuenta del alumno'
    if user.role == User.Role.PARENT:
        return 'guardian', 'Tutor'
    return 'other', 'Cuenta vinculada'


def logins_of(students: list[StudentProfile]) -> list[dict]:
    """Every login that reaches one of ``students`` directly (own login or a
    guardian link): with a Family, each of them sees all the students.

    ``students`` must come with ``user`` and ``parents`` loaded
    (``with_people``) so this costs no query.
    """
    own_ids = {s.user_id for s in students}
    rows: dict[int, dict] = {}

    def add(user: User, student: StudentProfile):
        row = rows.get(user.pk)
        if row is None:
            kind, label = _login_kind(user, own_ids)
            row = rows[user.pk] = {
                'id': user.pk,
                'email': user.email,
                'full_name': user.full_name,
                'kind': kind,
                'kind_label': label,
                'is_active': user.is_active,
                'last_login': user.last_login.isoformat() if user.last_login else None,
                'linked_to': [],
            }
        if student.user.first_name not in row['linked_to']:
            row['linked_to'].append(student.user.first_name or student.user.full_name)

    for s in students:
        if s.user.role == User.Role.STUDENT:
            add(s.user, s)
        for guardian in s.parents.all():
            add(guardian, s)
    order = {'student': 0, 'guardian': 1, 'other': 2}
    return sorted(rows.values(), key=lambda r: (order[r['kind']], r['email'].lower()))


def with_people(qs):
    """Students with what the summaries and ``logins_of`` read."""
    return qs.select_related('user', 'family').prefetch_related('parents')


def family_detail(family: Family) -> dict:
    students = list(with_people(family.students.all()).order_by('user__first_name', 'pk'))
    return {
        'id': family.pk,
        'name': family.name,
        'notes': family.notes,
        'created_at': family.created_at.isoformat() if family.created_at else None,
        'created_by': family.created_by.full_name if family.created_by_id and family.created_by else '',
        'students': [student_summary(s) for s in students],
        'logins': logins_of(students),
    }


def default_family_name(students: list[StudentProfile]) -> str:
    """«Familia <apellidos>» from the surnames the students share the most."""
    names = [' '.join((s.user.last_name or '').split()) for s in students]
    names = [n for n in names if n]
    if not names:
        return 'Familia'
    common, _ = Counter(n.title() if n.islower() or n.isupper() else n for n in names).most_common(1)[0]
    return f'Familia {common}'[:NAME_MAX]


def clean_name(raw) -> str:
    name = ' '.join(str(raw or '').split())
    if len(name) > NAME_MAX:
        raise FamilyError(f'El nombre admite hasta {NAME_MAX} caracteres.')
    return name


# ── the plan (dry run) ─────────────────────────────────────
@dataclass
class LinkPlan:
    action: str                       # create | add | merge | none
    target: Family | None             # existing family that receives everyone
    name: str                         # the family's name after the change
    students_after: list[StudentProfile]
    adding: list[StudentProfile]      # students whose family changes
    merging: list[Family] = field(default_factory=list)  # families dissolved into target
    new_access: list[dict] = field(default_factory=list)
    # Captured at plan time: a merged family no longer exists after the commit.
    merging_info: list[dict] = field(default_factory=list)
    target_info: dict | None = None

    def as_dict(self) -> dict:
        return {
            'action': self.action,
            'family': self.target_info,
            'name': self.name,
            'students_after': [student_summary(s) for s in self.students_after],
            'adding': [student_summary(s) for s in self.adding],
            'merging': self.merging_info,
            'new_access': self.new_access,
        }


def _resolve_students(student_ids) -> list[StudentProfile]:
    try:
        ids = list(dict.fromkeys(int(i) for i in (student_ids or [])))
    except (TypeError, ValueError):
        raise FamilyError('Indique alumnos válidos.') from None
    if not ids:
        return []
    found = {s.pk: s for s in with_people(StudentProfile.objects.filter(pk__in=ids))}
    missing = [i for i in ids if i not in found]
    if missing:
        raise FamilyError('Alguno de los alumnos ya no existe. Actualice la página.')
    return [found[i] for i in ids]


def _family_pk(value) -> int | None:
    """``family`` from a request: absent, or the id of a family (never a 500)."""
    if value in (None, ''):
        return None
    try:
        pk = int(value)
    except (TypeError, ValueError):
        raise FamilyError('Esa familia no es válida. Actualice la página.') from None
    if pk < 1:
        raise FamilyError('Esa familia no es válida. Actualice la página.')
    return pk


def _pick_target(families: list[Family], explicit: Family | None) -> Family | None:
    if explicit is not None:
        return explicit
    if not families:
        return None
    # The biggest family keeps its name; ties go to the oldest.
    return sorted(families, key=lambda f: (-f.students.count(), f.pk))[0]


def _access_gains(students_after: list[StudentProfile]) -> list[dict]:
    """Logins of the resulting family and the students each one will newly see."""
    after_ids = {s.pk for s in students_after}
    by_pk = {s.pk: s for s in students_after}
    gains = []
    for login in logins_of(students_after):
        # The rule only needs the pk: what this login sees today.
        before = set(family_students(User(pk=login['id'])).values_list('pk', flat=True))
        new = sorted(after_ids - before)
        if new:
            gains.append({**login, 'gains': [by_pk[i].user.full_name for i in new]})
    return gains


def plan_link(student_ids, *, family_id=None, name='') -> LinkPlan:
    """What ``link_students`` would do, without changing anything.

    With ``family_id`` the students join that family; without it they need at
    least two, and the family is the one they already share (or the biggest of
    theirs, the others merging into it), or a new one.
    """
    explicit = None
    family_pk = _family_pk(family_id)
    if family_pk is not None:
        explicit = Family.objects.filter(pk=family_pk).first()
        if explicit is None:
            raise FamilyError('Esa familia ya no existe. Actualice la página.')
    students = _resolve_students(student_ids)
    if explicit is None and len(students) < 2:
        raise FamilyError('Elija al menos dos alumnos para formar una familia.')
    if explicit is not None and not students:
        raise FamilyError('Elija al menos un alumno para agregar.')
    archived = [s.user.full_name for s in students if s.user.archived_at]
    if archived:
        raise FamilyError(f'{", ".join(archived)} está archivado; restáurelo antes de vincularlo.')

    families = {s.family for s in students if s.family_id}
    target = _pick_target(sorted(families, key=lambda f: f.pk), explicit)
    merging = [f for f in families if target is None or f.pk != target.pk]

    after: dict[int, StudentProfile] = {}
    if target is not None:
        for s in with_people(target.students.all()):
            after[s.pk] = s
    for fam in merging:
        for s in with_people(fam.students.all()):
            after[s.pk] = s
    for s in students:
        after[s.pk] = s
    students_after = sorted(after.values(), key=lambda s: (s.user.first_name.lower(), s.pk))
    if len(students_after) > FAMILY_MAX_STUDENTS:
        raise FamilyError(f'Una familia admite hasta {FAMILY_MAX_STUDENTS} alumnos; '
                          f'quedaría con {len(students_after)}.')

    adding = [s for s in students_after if target is None or s.family_id != target.pk]
    if target is None:
        action = 'create'
    elif merging:
        action = 'merge'
    elif adding:
        action = 'add'
    else:
        action = 'none'
    final_name = clean_name(name) or (target.name if target else default_family_name(students_after))
    plan = LinkPlan(action=action, target=target, name=final_name, students_after=students_after,
                    adding=adding, merging=merging,
                    merging_info=[{'id': f.pk, 'name': f.name, 'students': f.students.count()}
                                  for f in sorted(merging, key=lambda f: f.pk)],
                    target_info=({'id': target.pk, 'name': target.name} if target else None))
    if action != 'none':
        plan.new_access = _access_gains(students_after)
    return plan


# ── writes ─────────────────────────────────────────────────
def _audit_student(student: StudentProfile, old: str | None, new: str | None, actor, context: str):
    record('update', student, {'family': [old, new]}, actor=actor, context=context)


def _notify_gains(gains: list[dict], names: list[str]):
    """One notice per login that can now see more children (after the commit).

    The family's name stays out of it: the console promises the office that
    only the school sees that label (it may read «Familia García (Kínder)»).
    """
    from apps.portal.models import Notification
    from apps.portal.services import notify

    if not gains:
        return
    users = {u.pk: u for u in User.objects.filter(pk__in=[g['id'] for g in gains], is_active=True)}
    everyone = _join_names(names)
    for g in gains:
        user = users.get(g['id'])
        if user is None:
            continue
        try:
            notify(
                user, Notification.NotifType.INFO,
                'Sus hijos, juntos en el portal',
                f'El Colegio Interlaken agrupó a {everyone} como hermanos. '
                f'Desde esta cuenta ya puede ver y recargar la cafetería de {_join_names(g["gains"])}, '
                f'además de lo que ya veía. Puede seguir entrando con cualquiera de sus cuentas.',
                fanout=False,
                url='/portal',
                cta_label='Abrir el portal',
            )
        except Exception:  # noqa: BLE001 - a notice never undoes the link
            logger.exception('family link notice failed for user %s', g['id'])


def _join_names(names: list[str]) -> str:
    names = [n for n in names if n]
    if len(names) <= 1:
        return ''.join(names)
    return f'{", ".join(names[:-1])} y {names[-1]}'


def link_students(student_ids, *, family_id=None, name='', actor=None, notify: bool = True,
                  context: str = 'familia: vincular') -> tuple[Family | None, LinkPlan]:
    """Apply ``plan_link``: create, add to, or merge into one family."""
    with transaction.atomic():
        # Lock first, plan second: two clicks on «Vincular» cannot race.
        ids = [int(i) for i in (student_ids or []) if str(i).strip().lstrip('-').isdigit()]
        locked = list(StudentProfile.objects.select_for_update().filter(pk__in=ids)
                      .values_list('family_id', flat=True))
        fam_ids = {f for f in locked if f}
        family_pk = _family_pk(family_id)
        if family_pk is not None:
            fam_ids.add(family_pk)
        list(Family.objects.select_for_update().filter(pk__in=fam_ids).values_list('pk', flat=True))

        plan = plan_link(student_ids, family_id=family_id, name=name)
        if plan.action == 'none':
            if plan.target is not None and name and plan.name != plan.target.name:
                rename_family(plan.target, plan.name, actor=actor)
            return plan.target, plan

        family = plan.target
        created = family is None
        if created:
            family = Family.objects.create(name=plan.name, created_by=actor if getattr(actor, 'pk', None) else None)
        elif family.name != plan.name:
            family.name = plan.name
            family.save(update_fields=['name', 'updated_at'])

        moved = []
        for s in plan.adding:
            old = s.family.name if s.family_id else None
            StudentProfile.objects.filter(pk=s.pk).update(family=family)
            _audit_student(s, old, family.name, actor, context)
            moved.append(s.user.full_name)
        merged = []
        for other in plan.merging:
            merged.append({'id': other.pk, 'name': other.name})
            record('delete', other, {'merged_into': [other.pk, family.pk], 'name': other.name},
                   actor=actor, context=context)
            other.delete()

        record('create' if created else 'update', family, {
            'name': family.name,
            'added': moved,
            'merged': merged,
            'students': [s.user.full_name for s in plan.students_after],
        }, actor=actor, context=context)

        if notify:
            gains = plan.new_access
            names = [s.user.first_name or s.user.full_name for s in plan.students_after]
            transaction.on_commit(lambda: _notify_gains(gains, names))
    family.refresh_from_db()
    return family, plan


def remove_student(family: Family, student: StudentProfile, *, actor=None,
                   context: str = 'familia: quitar') -> dict:
    """Take ``student`` out of ``family``; a family left with one student dissolves."""
    with transaction.atomic():
        family = Family.objects.select_for_update().get(pk=family.pk)
        student = StudentProfile.objects.select_for_update().select_related('user').get(pk=student.pk)
        if student.family_id != family.pk:
            raise FamilyError('Ese alumno ya no está en esta familia.')
        StudentProfile.objects.filter(pk=student.pk).update(family=None)
        _audit_student(student, family.name, None, actor, context)
        remaining = family.students.count()
        record('update', family, {'removed': student.user.full_name, 'remaining': remaining},
               actor=actor, context=context)
        dissolved = False
        if remaining < 2:
            _dissolve(family, actor, context='familia: disuelta (queda un alumno)')
            dissolved = True
    return {'dissolved': dissolved}


def _dissolve(family: Family, actor, context: str):
    names = []
    for s in family.students.select_related('user'):
        StudentProfile.objects.filter(pk=s.pk).update(family=None)
        _audit_student(s, family.name, None, actor, context)
        names.append(s.user.full_name)
    record('delete', family, {'name': family.name, 'students': names}, actor=actor, context=context)
    family.delete()


def dissolve_family(family: Family, *, actor=None, context: str = 'familia: disolver') -> None:
    """Ungroup every student of ``family`` (their files and logins stay)."""
    with transaction.atomic():
        family = Family.objects.select_for_update().get(pk=family.pk)
        _dissolve(family, actor, context)


def rename_family(family: Family, name, *, notes=None, actor=None) -> Family:
    name = clean_name(name)
    if not name:
        raise FamilyError('Escriba el nombre de la familia.')
    changes = {}
    if family.name != name:
        changes['name'] = [family.name, name]
        family.name = name
    if notes is not None:
        notes = ' '.join(str(notes).split())[:300]
        if family.notes != notes:
            changes['notes'] = [family.notes, notes]
            family.notes = notes
    if changes:
        family.save(update_fields=['name', 'notes', 'updated_at'])
        record('update', family, changes, actor=actor, context='familia: editar')
    return family


def prune_after_student_delete(family_id: int | None) -> None:
    """A deleted student may leave a family of one: dissolve it."""
    if not family_id:
        return
    family = Family.objects.filter(pk=family_id).first()
    if family is not None and family.students.count() < 2:
        _dissolve(family, None, context='familia: disuelta (alumno eliminado)')


def families_prefetch():
    """Families with their students, logins and summaries in a fixed number of queries."""
    return Prefetch(
        'students',
        queryset=with_people(StudentProfile.objects.all()).order_by('user__first_name', 'pk'),
        to_attr='members',
    )
