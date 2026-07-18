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
        'total_visits': int(customer.get('total_visits') or 0),
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
    Returns ``{matched, created, updated, unmatched}``.
    """
    from apps.accounts.models import StudentProfile

    by_id, by_code = {}, {}
    for s in StudentProfile.objects.select_related('user').all():
        if s.loyverse_id:
            by_id[s.loyverse_id] = s
        if s.student_id:
            by_code[s.student_id.strip()] = s

    report = {'matched': 0, 'created': 0, 'updated': 0, 'unmatched': 0}
    for c in customers:
        student = by_id.get(c.get('id')) or by_code.get(
            (c.get('customer_code') or '').strip())
        if student is None:
            report['unmatched'] += 1
            continue
        report['matched'] += 1
        _, created = upsert_loyverse_profile(student, c)
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

    from .models import LoyverseProfile
    from .services import LoyverseError, get_all_customers

    newest = (LoyverseProfile.objects.order_by('-synced_at')
              .values_list('synced_at', flat=True).first())
    if newest and timezone.now() - newest < timedelta(hours=max_age_hours):
        return {'skipped': True, 'reason': 'fresh', 'last_sync': newest}

    try:
        customers = get_all_customers()
    except LoyverseError as e:
        return {'skipped': True, 'reason': 'loyverse-error', 'error': str(e)}

    report = refresh_all_profiles(customers)
    report['skipped'] = False
    report['total_customers'] = len(customers)
    return report
