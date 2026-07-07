"""
cafeteria/services.py — Loyverse API integration service.

1 Loyverse point = 1 MXN peso.

Notes for maintainers:
- The API token is read **per call** from ``settings.LOYVERSE_API_TOKEN`` (never
  frozen at import — see spec R5) so scheduled management commands and env
  changes take effect without a reload.
- Each call builds a short-lived ``requests.Session`` with connect/read timeouts
  and transport-level retries (429/5xx).
- Per spec **R1** the Loyverse ``total_points`` field is effectively read-only,
  so the local ``CafeteriaBalance`` row is the source of truth for credits.
  ``add_points_to_customer`` credits that row **atomically and idempotently**
  (``select_for_update`` + a reference guard) and only *best-effort* attempts the
  remote write. It is intentionally **not** on the money-in critical path.
"""
import logging
from decimal import Decimal

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from django.conf import settings
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

# (connect, read) timeouts in seconds.
_TIMEOUT = (5, 15)


class LoyverseError(Exception):
    pass


def _base_url() -> str:
    return settings.LOYVERSE_BASE_URL


def _session() -> requests.Session:
    """Build a fresh, retrying session with the *current* token.

    Reading the token here (not at import) means rotating ``LOYVERSE_API_TOKEN``
    in the environment is picked up on the next call — important for cron-run
    management commands (spec R5).
    """
    token = settings.LOYVERSE_API_TOKEN
    if not token:
        raise LoyverseError('LOYVERSE_API_TOKEN is not configured.')

    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(['GET', 'POST', 'PATCH']),
        raise_on_status=False,
    )
    session = requests.Session()
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('https://', adapter)
    session.mount('http://', adapter)
    session.headers.update({
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    return session


def _get(endpoint, params=None):
    """Generic GET against the Loyverse API."""
    url = f'{_base_url()}{endpoint}'
    try:
        with _session() as session:
            resp = session.get(url, params=params, timeout=_TIMEOUT)
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
    """Sync balances for all active students. Called by the ``sync_balances`` cron command."""
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


def add_points_to_customer(loyverse_customer_id: str, points, note: str = '',
                           reference: str = '') -> dict:
    """Credit a student's cafeteria balance after a successful top-up.

    Per spec **R1**, Loyverse ``total_points`` is read-only, so the **local**
    ``CafeteriaBalance`` is the source of truth. This:

    - locks the balance row with ``select_for_update`` (fixes the R2 read-modify-write
      race with concurrent purchase syncs),
    - is **idempotent** when ``reference`` is supplied: a ``topup`` transaction
      already recorded under that reference makes the call a no-op (guards against
      a retried webhook / cron double-apply),
    - records a ``topup`` ``CafeteriaTransaction`` (only when ``reference`` is given),
    - then *best-effort* attempts the remote write for the day a Loyverse write
      path exists — a failure there never rolls back the local credit.

    Returns ``{'applied': bool, 'balance': Decimal, 'reason'?: str}``.
    """
    from apps.accounts.models import StudentProfile
    from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

    amount = Decimal(str(points))

    with transaction.atomic():
        try:
            student = StudentProfile.objects.get(loyverse_id=loyverse_customer_id)
        except StudentProfile.DoesNotExist as e:
            raise LoyverseError(
                f'No StudentProfile linked to Loyverse id {loyverse_customer_id!r}'
            ) from e

        cb, _ = CafeteriaBalance.objects.select_for_update().get_or_create(student=student)

        if reference and CafeteriaTransaction.objects.filter(
            loyverse_receipt_id=reference
        ).exists():
            logger.info(f'Top-up {reference!r} already applied for {student} — no-op.')
            return {'applied': False, 'balance': cb.balance, 'reason': 'duplicate'}

        cb.balance = (cb.balance or Decimal('0')) + amount
        cb.last_synced = timezone.now()
        cb.save(update_fields=['balance', 'last_synced'])

        if reference:
            CafeteriaTransaction.objects.create(
                student=student,
                transaction_type=CafeteriaTransaction.TxType.TOPUP,
                amount=amount,
                description=note,
                loyverse_receipt_id=reference,
            )
        new_balance = cb.balance

    # Best-effort remote write (R1: total_points is read-only on the current plan,
    # so this is expected to be a no-op / failure — it must never undo the local credit).
    try:
        with _session() as session:
            resp = session.post(
                f'{_base_url()}/customers',
                json={'id': loyverse_customer_id, 'total_points': float(new_balance)},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
    except requests.RequestException as e:
        logger.warning(
            f'Loyverse remote credit for {loyverse_customer_id} not applied '
            f'(local ledger is source of truth per R1): {e}'
        )

    logger.info(f'Credited {amount} to {loyverse_customer_id}. Local balance: {new_balance}')
    return {'applied': True, 'balance': new_balance}
