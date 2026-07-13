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
