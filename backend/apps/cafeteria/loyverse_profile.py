"""
cafeteria/loyverse_profile.py — parse + persist the full Loyverse customer
snapshot for EVERY customer in the store (IK-CAFE: full information from
Loyverse; 2026-09-23: staff and other cards too, not only students).

Kept out of services.py so the parsing is a small, pure, unit-testable unit
with no API calls or ORM coupling. `parse_customer_snapshot` maps a raw
Loyverse customer dict to the LoyverseProfile column values,
`classify_customer` decides what kind of card it is, and `refresh_all_profiles`
writes the whole store in one pass.
"""
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.utils.dateparse import parse_datetime

# The school's pupils in Loyverse: code ``ci<digits>`` (bare digits tolerated)
# and the student mailbox ``ci<digits>@interlaken.com.mx``.
_STUDENT_CODE_RE = re.compile(r'^(?:ci)?\d{3,10}$', re.IGNORECASE)
_TEST_RE = re.compile(r'prueba|probando|\btest\b|demo', re.IGNORECASE)


def _dt(value):
    """Loyverse timestamps are ISO-8601 with a trailing 'Z'; return an aware
    datetime or None."""
    if not value:
        return None
    dt = parse_datetime(value)
    if dt is None:
        try:
            dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        except (ValueError, TypeError):
            return None
    return dt


def _dec(value) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, TypeError):
        return Decimal('0')


def _int(value) -> int:
    """Loyverse counters are ints, but a malformed/absent value must never
    crash the balance cron that folds this sync in — fall back to 0."""
    try:
        return int(value or 0)
    except (ValueError, TypeError):
        return 0


def classify_customer(customer: dict) -> str:
    """What kind of card is this? ``student`` / ``staff`` / ``test`` / ``other``.

    Pupils carry the ``ci<digits>`` code and mailbox. Staff cards at Interlaken
    are named ``ZP-…`` and use a person's or office's mailbox on the school
    domain (``direccion@``, ``colegio@``, ``jsoto@``). Anything that calls
    itself a prueba/test is a test record. The rest is ``other`` and is still
    stored, so nothing in the store is invisible to the console.
    """
    code = (customer.get('customer_code') or '').strip()
    email = (customer.get('email') or '').strip().lower()
    name = (customer.get('name') or '').strip()
    if _TEST_RE.search(name) or _TEST_RE.search(email):
        return 'test'
    if (_STUDENT_CODE_RE.match(code) and email.startswith('ci')
            and email.endswith('@interlaken.com.mx')):
        return 'student'
    if name.upper().startswith('ZP-') or (
            email.endswith('@interlaken.com.mx') and not email.startswith('ci')):
        return 'staff'
    return 'other'


def parse_customer_snapshot(customer: dict) -> dict:
    """Map a raw Loyverse customer object to LoyverseProfile field values.

    Pure: no I/O. Unknown/missing fields fall back to empty/zero so a sparse
    customer (phone/note/address unset, as in the sample) still yields a valid
    snapshot. The complete object is preserved under ``raw``.
    """
    return {
        'loyverse_id': customer.get('id') or '',
        'customer_code': (customer.get('customer_code') or '').strip(),
        'name': (customer.get('name') or '').strip(),
        'email': (customer.get('email') or '').strip(),
        'phone_number': (customer.get('phone_number') or '').strip(),
        'address_code': (customer.get('address') or '').strip(),
        'note': (customer.get('note') or '').strip(),
        'first_visit': _dt(customer.get('first_visit')),
        'last_visit': _dt(customer.get('last_visit')),
        'total_visits': _int(customer.get('total_visits')),
        'total_spent': _dec(customer.get('total_spent')),
        'total_points': _dec(customer.get('total_points')),
        'loyverse_created_at': _dt(customer.get('created_at')),
        'loyverse_updated_at': _dt(customer.get('updated_at')),
        'raw': customer,
    }


def upsert_loyverse_profile(student, customer: dict):
    """Create or refresh the profile for ``customer``, bound to ``student``
    (which may be ``None`` for a staff/test/other card).

    Keyed by the Loyverse id. If the student was previously bound to a
    different customer (a relink), that older row is unbound first so the
    one-to-one holds. Returns (profile, created). Idempotent.
    """
    from django.utils import timezone

    from .models import LoyverseProfile

    values = parse_customer_snapshot(customer)
    values['synced_at'] = timezone.now()
    values['student'] = student
    values['kind'] = (LoyverseProfile.Kind.STUDENT if student is not None
                      else classify_customer(customer))
    values['missing_since'] = None
    uuid = values.pop('loyverse_id')
    if not uuid:
        raise ValueError('customer without id')
    if student is not None:
        (LoyverseProfile.objects.filter(student=student).exclude(loyverse_id=uuid)
                                .update(student=None))
    profile, created = LoyverseProfile.objects.update_or_create(
        loyverse_id=uuid, defaults=values)
    return profile, created


def refresh_all_profiles(customers, *, mark_missing=True):
    """Upsert a LoyverseProfile for EVERY customer in ``customers``.

    Pure over ``customers`` (no API call), so it's cheap to unit-test. Students
    are matched by Loyverse id first, then matrícula (customer_code ==
    student_id); everyone else is stored unbound with a ``kind``. Rows whose
    id is absent from a full list are stamped ``missing_since`` (never
    deleted); pass ``mark_missing=False`` for a partial list such as a webhook
    payload. Unchanged customers only get ``synced_at`` refreshed, in one
    query, so the 5-minute cron can afford this on the whole store.

    Returns ``{matched, created, updated, unmatched, errors, total, staff,
    test, other, missing}``. ``unmatched`` keeps its historical meaning:
    customers stored without a student.

    Each student is bound to at most one customer (LoyverseProfile is a
    OneToOne), so once a student matches we skip further customers claiming the
    same student — otherwise a duplicate customer_code would overwrite the
    snapshot and inflate the counters. A single malformed customer is counted
    under ``errors`` and skipped, never allowed to abort the batch.
    """
    from django.utils import timezone

    from apps.accounts.models import StudentProfile

    from .models import LoyverseProfile

    by_id, by_code = {}, {}
    for s in StudentProfile.objects.select_related('user').all():
        if s.loyverse_id:
            by_id[s.loyverse_id] = s
        # An empty matrícula must not match a customer with a blank
        # customer_code (''.strip() == '') — that would bind an unrelated
        # customer to the student.
        code = (s.student_id or '').strip()
        if code:
            by_code.setdefault(code, s)

    # Fingerprint of what we already hold, to skip rows that did not change.
    existing = {
        p['loyverse_id']: p for p in LoyverseProfile.objects.values(
            'loyverse_id', 'loyverse_updated_at', 'total_points', 'total_visits',
            'student_id', 'missing_since', 'kind')
    }

    report = {'matched': 0, 'created': 0, 'updated': 0, 'unmatched': 0, 'errors': 0,
              'total': 0, 'staff': 0, 'test': 0, 'other': 0, 'missing': 0}
    seen_students, seen_ids, unchanged = set(), set(), []
    now = timezone.now()
    for c in customers:
        uuid = c.get('id')
        if not uuid or uuid in seen_ids:
            continue
        seen_ids.add(uuid)
        report['total'] += 1
        code = (c.get('customer_code') or '').strip()
        student = by_id.get(uuid) or (by_code.get(code) if code else None)
        if student is not None and student.pk in seen_students:
            student = None
        kind = 'student' if student is not None else classify_customer(c)

        prev = existing.get(uuid)
        if (prev is not None
                and prev['loyverse_updated_at'] == _dt(c.get('updated_at'))
                and prev['total_points'] == _dec(c.get('total_points'))
                and prev['total_visits'] == _int(c.get('total_visits'))
                and prev['student_id'] == (student.pk if student else None)
                and prev['kind'] == kind
                and prev['missing_since'] is None):
            unchanged.append(uuid)
        else:
            try:
                _, created = upsert_loyverse_profile(student, c)
            except Exception:  # noqa: BLE001 — fail-soft per bad customer
                report['errors'] += 1
                continue
            report['created' if created else 'updated'] += 1

        # Counted only once the row is known to be in place.
        if student is None:
            report['unmatched'] += 1
            report[kind if kind in ('staff', 'test', 'other') else 'other'] += 1
        else:
            report['matched'] += 1
            seen_students.add(student.pk)

    if unchanged:
        LoyverseProfile.objects.filter(loyverse_id__in=unchanged).update(synced_at=now)
    if mark_missing:
        gone = LoyverseProfile.objects.exclude(loyverse_id__in=seen_ids)
        gone.filter(missing_since__isnull=True).update(missing_since=now)
        report['missing'] = gone.count()
    else:
        report['missing'] = LoyverseProfile.objects.filter(missing_since__isnull=False).count()
    return report


def refresh_profiles_if_stale(max_age_hours=20):
    """Refresh all Loyverse profiles, but only if the last sync is stale.

    Lets a frequent cron (e.g. sync_balances every 10 min) also keep the full
    customer snapshots fresh without a separate cron entry, while doing the
    heavy all-customers fetch at most ~once/day. Fail-soft: a Loyverse hiccup
    is reported, never raised, so it can't break the balance cron.

    Returns a report dict (``skipped`` True when still fresh, ``error`` set on
    a transient failure).
    """
    from datetime import timedelta

    from django.utils import timezone

    from apps.accounts.models import StudentProfile

    from .models import LoyverseProfile, LoyverseSyncState
    from .services import LoyverseError, get_all_customers

    # Nothing to match against → don't burn the (paginated, up-to-10k-customer)
    # fetch on every 10-min cron. Launch state before any roster is imported.
    if not StudentProfile.objects.exists():
        return {'skipped': True, 'reason': 'no-students'}

    # Freshness throttle. Key off the most recent of (a) the last *successful*
    # full fetch — recorded even when it matched zero students — and (b) the
    # newest profile row. (a) is essential: during the onboarding window a
    # roster exists but its matrículas aren't linked to Loyverse customer_codes
    # yet, so a fetch writes no rows; without a persisted attempt marker the
    # (b)-only gate would never engage and the heavy fetch would repeat every
    # tick. LocMemCache can't hold this — each cron run is a fresh process.
    state = LoyverseSyncState.load()
    newest_profile = (LoyverseProfile.objects.order_by('-synced_at')
                      .values_list('synced_at', flat=True).first())
    stamps = [t for t in (state.last_full_fetch_at, newest_profile) if t]
    last = max(stamps) if stamps else None
    if last and timezone.now() - last < timedelta(hours=max_age_hours):
        return {'skipped': True, 'reason': 'fresh', 'last_sync': last}

    try:
        customers = get_all_customers()
    except LoyverseError as e:
        return {'skipped': True, 'reason': 'loyverse-error', 'error': str(e)}

    # The whole point of folding this into sync_balances is convenience; a
    # parse/ORM error on one snapshot must never take the balance cron down
    # with it, so treat any failure here as soft.
    try:
        report = refresh_all_profiles(customers)
    except Exception as e:  # noqa: BLE001 — fail-soft, protects the cron
        return {'skipped': True, 'reason': 'refresh-error', 'error': str(e)}

    # Record the successful fetch so the throttle engages regardless of how many
    # students matched — this is what closes the zero-match re-run loop.
    state.last_full_fetch_at = timezone.now()
    state.save(update_fields=['last_full_fetch_at'])

    report['skipped'] = False
    report['total_customers'] = len(customers)
    return report


def receipt_lines(payload: dict) -> str:
    """Short human summary of a receipt's line items, for the customer console."""
    parts = []
    for li in payload.get('line_items') or []:
        name = li.get('item_name') or li.get('variant_name') or 'Artículo'
        qty = li.get('quantity', 1)
        try:
            q = float(qty)
            qty = int(q) if q.is_integer() else q
        except (TypeError, ValueError):
            pass
        parts.append(f'{qty}× {name}' if qty not in (1, '1') else name)
    return ', '.join(parts)[:255]
