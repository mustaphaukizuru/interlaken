"""
cafeteria/loyverse_profile.py — parse + persist the full Loyverse customer
snapshot for a student (IK-CAFE: full student information from Loyverse).

Kept out of services.py so the parsing is a small, pure, unit-testable unit
with no API calls or ORM coupling. `parse_customer_snapshot` maps a raw
Loyverse customer dict to the LoyverseProfile column values;
`upsert_loyverse_profile` writes them.
"""
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.utils.dateparse import parse_datetime


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
    """Create or refresh the LoyverseProfile for ``student`` from ``customer``.

    Returns (profile, created). Idempotent: re-running just refreshes the
    snapshot in place.
    """
    from django.utils import timezone

    from .models import LoyverseProfile

    values = parse_customer_snapshot(customer)
    values['synced_at'] = timezone.now()
    profile, created = LoyverseProfile.objects.update_or_create(
        student=student, defaults=values)
    return profile, created


def refresh_all_profiles(customers):
    """Upsert LoyverseProfile snapshots for every matched student.

    Pure over ``customers`` (no API call), so it's cheap to unit-test. Matches
    by Loyverse id first, then matrícula (customer_code == student_id).
    Returns ``{matched, created, updated, unmatched, errors}``.

    Each student is bound to at most one customer (LoyverseProfile is a
    OneToOne), so once a student matches we skip further customers claiming the
    same student — otherwise a duplicate customer_code would overwrite the
    snapshot and inflate the counters. A single malformed customer is counted
    under ``errors`` and skipped, never allowed to abort the batch.
    """
    from apps.accounts.models import StudentProfile

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

    report = {'matched': 0, 'created': 0, 'updated': 0, 'unmatched': 0,
              'errors': 0}
    seen_students = set()
    for c in customers:
        code = (c.get('customer_code') or '').strip()
        student = by_id.get(c.get('id')) or (by_code.get(code) if code else None)
        if student is None:
            report['unmatched'] += 1
            continue
        if student.pk in seen_students:
            continue
        try:
            _, created = upsert_loyverse_profile(student, c)
        except Exception:  # noqa: BLE001 — fail-soft per bad customer
            report['errors'] += 1
            continue
        seen_students.add(student.pk)
        report['matched'] += 1
        report['created' if created else 'updated'] += 1
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
