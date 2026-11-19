"""
accounts/staff_import.py — «Importar personal desde Loyverse» (A3 + A5, 2026-11-18).

POST /api/v1/accounts/admin/import-staff-loyverse/  (admin only)
  body: ``commit`` 1|0 (default 0: the review), ``convert`` [profile ids],
  ``skip`` [Loyverse customer ids the office left out: a placeholder card, a
  person who no longer works there]

Every staff card in Loyverse is named «ZP-…» (no pupil's is). The roster import
skips them on purpose, so their purchases park as «sin alumno vinculado»
receipts. This screen lists those cards with what the office needs to decide
(code, email, balance, last visit, activity), flags what looks wrong, and on
commit creates or links one staff cafetería account per card
(``StudentProfile.tipo='personal'``, puesto «Sin asignar»), seeds its opening
balance once exactly like a pupil's, and replays the parked receipts so each
person sees their history.

Matching (staff link by EMAIL first: two codes in Loyverse are typos of the
email): the profile already linked to the card, else the profile whose login
has the card's email, else the profile holding the code (case-insensitive),
else a login with that email and no cafetería account yet (a console user such
as colegio@, or a parent: attached, role untouched), else a new login
(``role='student'``: portal only, never the console). A matching record that
is a PUPIL (created by hand as one) is offered «Convertir a Personal» and is
converted only when its id is in ``convert``. A person already linked to a
different card is never repointed. A row whose card is in ``skip`` is not
written at all; the result counts it under ``skipped`` with the conversions
left unticked.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q
from django.db.models.functions import Lower
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import error_body
from apps.core.flags import truthy
from apps.core.permissions import IsAdmin

from .models import StudentProfile, User
from .people import PERSONAL, is_staff_customer, split_staff_name, strip_staff_prefix

logger = logging.getLogger(__name__)

# Row actions (the review shows them in Spanish).
CREATE, ATTACH, LINK, UP_TO_DATE, CONVERT, CONFLICT, SKIP = (
    'crear', 'vincular_cuenta', 'vincular', 'al_dia', 'convertir', 'conflicto', 'omitir')


def _dec(value) -> Decimal:
    try:
        return Decimal(str(value if value is not None else 0))
    except Exception:  # noqa: BLE001
        return Decimal('0')


def _flags(code: str, email: str, visits: int) -> list[str]:
    flags = []
    if visits == 0:
        flags.append('sin_actividad')
    if not email:
        flags.append('sin_correo')
    local = email.split('@', 1)[0] if email else ''
    if code and local and not code.isdigit() and code.lower() != local.lower():
        flags.append('codigo_distinto')
    return flags


def _existing_row(profile) -> dict:
    u = profile.user
    return {'id': profile.pk, 'name': u.full_name, 'student_id': profile.student_id,
            'tipo': profile.tipo, 'grade': profile.grade, 'role': u.role,
            'linked_to': profile.loyverse_id or ''}


def plan_staff_import(customers) -> dict:
    """The review: one row per «ZP-» customer with the action a commit takes."""
    from apps.cafeteria.models import UnmatchedReceipt

    staff = [c for c in customers if is_staff_customer(c) and c.get('id')]
    uuids = [c['id'] for c in staff]
    emails = {(c.get('email') or '').strip().lower() for c in staff} - {''}
    codes = {(c.get('customer_code') or '').strip().lower() for c in staff} - {''}

    profiles = list(
        StudentProfile.objects.select_related('user')
        .annotate(_email=Lower('user__email'), _code=Lower('student_id'))
        .filter(Q(loyverse_id__in=uuids) | Q(_email__in=emails) | Q(_code__in=codes)))
    by_link = {p.loyverse_id: p for p in profiles if p.loyverse_id}
    by_email = {(p.user.email or '').lower(): p for p in profiles}
    by_code = {(p.student_id or '').lower(): p for p in profiles}
    logins = {u.email.lower(): u for u in
              User.objects.annotate(_email=Lower('email')).filter(_email__in=emails)}
    pending = dict(UnmatchedReceipt.objects
                   .filter(resolved_at__isnull=True, customer_id__in=uuids)
                   .values('customer_id').annotate(n=Count('id'))
                   .values_list('customer_id', 'n'))

    rows, seen_codes, seen_emails = [], set(), set()
    counts = dict.fromkeys((CREATE, ATTACH, LINK, UP_TO_DATE, CONVERT, CONFLICT, SKIP), 0)
    for c in sorted(staff, key=lambda c: strip_staff_prefix(c.get('name')).lower()):
        uuid = c['id']
        code = (c.get('customer_code') or '').strip()
        email = (c.get('email') or '').strip().lower()
        first, last = split_staff_name(c.get('name'))
        visits = int(c.get('total_visits') or 0)
        row = {
            'loyverse_id': uuid, 'loyverse_name': (c.get('name') or '').strip(),
            'name': f'{first} {last}'.strip(), 'first_name': first, 'last_name': last,
            'code': code, 'email': email, 'balance': f"{_dec(c.get('total_points')):.2f}",
            'total_visits': visits, 'last_visit': c.get('last_visit') or None,
            'pending_receipts': pending.get(uuid, 0),
            'flags': _flags(code, email, visits), 'existing': None, 'action': '', 'note': '',
        }
        profile = (by_link.get(uuid) or (by_email.get(email) if email else None)
                   or (by_code.get(code.lower()) if code else None))
        holder = by_link.get(uuid)
        if profile is not None:
            row['existing'] = _existing_row(profile)
            if holder is not None and holder.pk != profile.pk:
                row['action'], row['note'] = CONFLICT, (
                    f'Esta tarjeta ya está vinculada a {holder.user.full_name}.')
            elif profile.loyverse_id and profile.loyverse_id != uuid:
                row['action'], row['note'] = CONFLICT, (
                    'Ya está vinculado a otra tarjeta de Loyverse; no se cambia.')
            elif profile.tipo != PERSONAL:
                row['action'], row['note'] = CONVERT, (
                    f'Registrado como alumno ({profile.grade or "sin grado"}). «Convertir a '
                    f'Personal» conserva su saldo y su historial.')
            elif profile.loyverse_id == uuid:
                row['action'] = UP_TO_DATE
            else:
                row['action'] = LINK
        elif code.lower() in seen_codes or (email and email in seen_emails):
            row['action'], row['note'] = CONFLICT, 'Código o correo repetido en otra tarjeta de Loyverse.'
        elif not code and not email:
            row['action'], row['note'] = SKIP, 'La tarjeta no tiene código ni correo.'
        elif email and email in logins:
            login = logins[email]
            row['action'] = ATTACH
            row['existing'] = {'id': None, 'name': login.full_name, 'student_id': '',
                               'tipo': '', 'grade': '', 'role': login.role, 'linked_to': ''}
            if login.role in (User.Role.ADMIN, User.Role.STAFF):
                row['flags'].append('consola')
                row['note'] = ('Ya entra a la consola con este correo: la conserva y verá también '
                               '«Mi cafetería».')
            else:
                row['note'] = 'Ya tiene cuenta con este correo: se le agrega su cafetería.'
        else:
            row['action'] = CREATE
        if code:
            seen_codes.add(code.lower())
        if email:
            seen_emails.add(email)
        counts[row['action']] += 1
        rows.append(row)
    return {'total_customers': len(customers), 'staff_customers': len(staff),
            'counts': counts, 'rows': rows}


def _seed_once(profile, points: Decimal) -> Decimal:
    """The pupil import's seed-once rule: the opening balance is copied from
    Loyverse only while the wallet was never touched (and no paid card top-up
    waits to be applied: that one seeds the wallet itself)."""
    from apps.cafeteria.models import CafeteriaBalance
    from apps.cafeteria.services import paid_topups_pending

    if points <= 0 or paid_topups_pending().filter(student=profile).exists():
        return Decimal('0')
    with transaction.atomic():
        cb, _ = CafeteriaBalance.objects.select_for_update().get_or_create(student=profile)
        if cb.last_synced is not None:
            return Decimal('0')
        cb.balance = points
        cb.last_synced = cb.seeded_at = timezone.now()
        cb.save(update_fields=['balance', 'last_synced', 'seeded_at'])
    return points


def _customer_ids(values) -> set[str]:
    """The Loyverse customer ids in a request list (``skip``): text or whole
    numbers, trimmed, at most 100 characters (``LoyverseProfile.loyverse_id``);
    anything else is ignored, as ``convert`` ignores what is not an id."""
    ids = set()
    for value in values or ():
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            continue
        text = str(value).strip()
        if text and len(text) <= 100:
            ids.add(text)
    return ids


def import_staff_from_loyverse(customers, *, commit=False, convert_ids=(), skip_ids=(),
                               actor=None) -> dict:
    """The review (``commit=False``) or the import. Returns the plan plus, on
    commit, ``created``, ``attached``, ``linked``, ``converted``, ``skipped``
    (rows the office left out: a card in ``skip_ids``, or a «Convertir a
    Personal» left unticked; marked ``skipped`` and never written),
    ``balance_seeded``, ``errors`` and ``replay`` (A5: the parked purchases now
    in each person's history)."""
    from apps.cafeteria.loyverse_profile import upsert_loyverse_profile
    from apps.cafeteria.services import replay_unmatched_receipts
    from apps.core.audit import record

    from .people import convert_to_personal

    report = plan_staff_import(customers)
    report.update({'commit': commit, 'created': 0, 'attached': 0, 'linked': 0, 'converted': 0,
                   'skipped': 0, 'balance_seeded': '0.00', 'errors': [], 'replay': None,
                   'recovered_receipts': 0})
    if not commit:
        return report

    wanted = {int(i) for i in convert_ids or () if str(i).isdigit()}
    left_out = _customer_ids(skip_ids)
    by_id = {c['id']: c for c in customers if c.get('id')}
    seeded, linked_ids = Decimal('0'), []
    for row in report['rows']:
        action = row['action']
        if action in (UP_TO_DATE, CONFLICT, SKIP):
            continue
        if row['loyverse_id'] in left_out or (
                action == CONVERT and (row['existing'] or {}).get('id') not in wanted):
            row['done'], row['skipped'] = False, True
            report['skipped'] += 1
            continue
        cust = by_id[row['loyverse_id']]
        try:
            with transaction.atomic():
                profile = _apply_row(row, cust, actor=actor, convert=convert_to_personal)
            report[{CREATE: 'created', ATTACH: 'attached', LINK: 'linked',
                    CONVERT: 'converted'}[action]] += 1
            row['done'] = True
            row['profile_id'] = profile.pk
            linked_ids.append(row['loyverse_id'])
            try:
                upsert_loyverse_profile(profile, cust)
            except Exception:  # noqa: BLE001 - reference data, the link stands
                logger.exception('Staff import: snapshot failed for %s', profile.pk)
            seeded += _seed_once(profile, _dec(cust.get('total_points')))
        except Exception as exc:  # noqa: BLE001 - per-row isolation
            row['done'] = False
            report['errors'].append({'code': row['code'], 'name': row['name'],
                                     'error': str(exc)[:150]})
    report['balance_seeded'] = f'{seeded:.2f}'
    report['recovered_receipts'] = 0
    if linked_ids:
        # A5: their purchases parked as «sin alumno vinculado» become history:
        # debited when newer than the opening balance (replayed), recorded
        # without touching it when the seed already counted them (absorbed).
        replay = replay_unmatched_receipts(loyverse_ids=linked_ids)
        report['replay'] = replay
        report['recovered_receipts'] = replay.get('replayed', 0) + replay.get('absorbed', 0)
    summary = {k: report[k] for k in ('created', 'attached', 'linked', 'converted', 'skipped',
                                      'balance_seeded', 'recovered_receipts')}
    summary['errors'] = len(report['errors'])
    from apps.cafeteria.models import LoyverseSyncState
    record('update', LoyverseSyncState.load(), summary, actor=actor, context='import:personal')
    return report


def _apply_row(row, cust, *, actor, convert):
    """Write one row (inside the caller's transaction); returns the profile."""
    from apps.core.audit import record

    from .import_students import STUDENT_EMAIL_DOMAIN

    uuid = row['loyverse_id']
    action = row['action']
    if action in (LINK, CONVERT):
        profile = StudentProfile.objects.select_for_update().select_related('user').get(
            pk=row['existing']['id'])
        if profile.loyverse_id and profile.loyverse_id != uuid:
            raise ValueError('ya está vinculado a otra tarjeta')
        if action == CONVERT:
            convert(profile, actor=actor, context='import:personal (convertir a personal)')
        if profile.loyverse_id != uuid:
            profile.loyverse_id = uuid
            profile.loyverse_missing_since = None
            profile.save(update_fields=['loyverse_id', 'loyverse_missing_since'])
            record('update', profile, {'loyverse_id': ['', uuid], 'via': 'import:personal'},
                   actor=actor, context='import:personal')
        return profile

    email = row['email'] or f"{(row['code'] or uuid[:8]).lower()}@{STUDENT_EMAIL_DOMAIN}"
    if action == ATTACH:
        user = User.objects.get(email__iexact=email)
        if StudentProfile.objects.filter(user=user).exists():
            raise ValueError('esa cuenta ya tiene un expediente')
    else:
        if User.objects.filter(email__iexact=email).exists():
            raise ValueError('ese correo ya tiene cuenta')
        user = User.objects.create_user(email=email, password=None, first_name=row['first_name'],
                                        last_name=row['last_name'], role=User.Role.STUDENT)
        user.set_unusable_password()
        user.save(update_fields=['password'])
    code = row['code'] or email.split('@', 1)[0]
    if StudentProfile.objects.filter(student_id__iexact=code).exists():
        raise ValueError(f'el código {code} ya está en otro expediente')
    profile = StudentProfile.objects.create(
        user=user, student_id=code, grade='', group='', loyverse_id=uuid,
        tipo=PERSONAL, puesto=StudentProfile.Puesto.SIN_ASIGNAR)
    record('create', profile, {'via': 'import:personal', 'loyverse_id': uuid, 'code': code,
                               'attached_login': action == ATTACH},
           actor=actor, context='import:personal')
    return profile


class ImportStaffLoyverseView(APIView):
    """The review (``commit=0``) and the import (``commit=1``); admins only."""
    permission_classes = [IsAdmin]

    def post(self, request):
        from apps.cafeteria.services import LoyverseError, get_all_customers

        commit = truthy(request.data.get('commit', '0'))
        convert = request.data.get('convert') or []
        if not isinstance(convert, list):
            convert = [convert]
        skip = request.data.get('skip') or []
        if not isinstance(skip, list):
            skip = [skip]
        try:
            customers = get_all_customers()
        except LoyverseError as e:
            return Response(error_body(f'No se pudo conectar con Loyverse: {e}'),
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response(import_staff_from_loyverse(
            customers, commit=commit, convert_ids=convert, skip_ids=skip, actor=request.user))
