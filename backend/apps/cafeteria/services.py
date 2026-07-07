"""
cafeteria/services.py — Loyverse API integration service
"""
import logging
from decimal import Decimal

import requests
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

LOYVERSE_BASE = settings.LOYVERSE_BASE_URL
LOYVERSE_TOKEN = settings.LOYVERSE_API_TOKEN

HEADERS = {
    'Authorization': f'Bearer {LOYVERSE_TOKEN}',
    'Content-Type': 'application/json',
}


class LoyverseError(Exception):
    pass


def _get(endpoint, params=None):
    """Generic GET against the Loyverse API."""
    url = f'{LOYVERSE_BASE}{endpoint}'
    try:
        resp = requests.get(url, headers=HEADERS, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error(f'Loyverse GET {endpoint} failed: {e}')
        raise LoyverseError(str(e)) from e


def get_customer_by_id(loyverse_customer_id: str) -> dict:
    """Fetch a single customer from Loyverse by their ID."""
    return _get(f'/customers/{loyverse_customer_id}')


def get_customer_by_email(email: str) -> dict | None:
    """Search for a Loyverse customer by email."""
    data = _get('/customers', params={'email': email})
    customers = data.get('customers', [])
    return customers[0] if customers else None


def get_balance_from_customer(customer: dict) -> Decimal:
    """
    Extract balance from Loyverse customer object.
    Loyverse uses loyalty points — 1 point = 1 MXN peso for Interlaken.
    """
    points = customer.get('total_points', 0) or 0
    return Decimal(str(points))


def get_recent_transactions(loyverse_customer_id: str, limit: int = 20) -> list:
    """Get recent receipts (purchases) for a customer."""
    data = _get('/receipts', params={
        'customer_id': loyverse_customer_id,
        'rows_limit': limit,
    })
    return data.get('receipts', [])


def sync_student_balance(student_profile) -> Decimal:
    """
    Sync a student's Loyverse balance into the DB.
    Returns the current balance in MXN pesos.
    """
    from apps.cafeteria.models import CafeteriaBalance

    try:
        customer = get_customer_by_id(student_profile.loyverse_id)
        balance = get_balance_from_customer(customer)

        cb, _ = CafeteriaBalance.objects.get_or_create(student=student_profile)
        cb.balance = balance
        cb.last_synced = timezone.now()
        cb.save(update_fields=['balance', 'last_synced'])

        logger.info(f'Synced balance for {student_profile}: {balance}')
        return balance

    except LoyverseError as e:
        logger.error(f'Balance sync failed for {student_profile}: {e}')
        raise


def sync_all_balances():
    """Sync balances for all active students. Called by a periodic task."""
    from apps.accounts.models import StudentProfile

    students = StudentProfile.objects.filter(
        is_active=True
    ).exclude(loyverse_id='')

    synced, failed = 0, 0
    for student in students:
        try:
            sync_student_balance(student)
            synced += 1
        except LoyverseError:
            failed += 1

    logger.info(f'Balance sync complete: {synced} synced, {failed} failed')
    return {'synced': synced, 'failed': failed}


def add_points_to_customer(loyverse_customer_id: str, points: float, note: str = '') -> dict:
    """
    Add loyalty points (= pesos) to a customer's card.
    Used after a successful top-up payment.
    """
    url = f'{LOYVERSE_BASE}/customers/{loyverse_customer_id}'
    try:
        # First get current points
        customer = get_customer_by_id(loyverse_customer_id)
        current_points = customer.get('total_points', 0) or 0
        new_points = current_points + points

        resp = requests.patch(url, headers=HEADERS, json={
            'total_points': new_points,
        }, timeout=10)
        resp.raise_for_status()
        logger.info(f'Added {points} points to {loyverse_customer_id}. New balance: {new_points}')
        return resp.json()
    except requests.RequestException as e:
        logger.error(f'Failed to add points to {loyverse_customer_id}: {e}')
        raise LoyverseError(str(e)) from e
