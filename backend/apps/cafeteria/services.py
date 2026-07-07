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
from datetime import timedelta
from decimal import Decimal, InvalidOperation

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

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


def get_receipts(since: str | None = None, limit: int = 250, max_pages: int = 20) -> list:
    """Fetch receipts store-wide, newest first, following Loyverse's cursor.

    The Loyverse ``/receipts`` endpoint has no ``customer_id`` filter, so
    ``sync_purchases`` polls the store's receipts and matches each one against the
    linked students in memory. ``since`` is an ISO-8601 string passed as
    ``created_at_min`` to bound the poll; pagination beyond the first page uses the
    opaque ``cursor`` (which cannot be combined with other filters).
    """
    receipts: list = []
    cursor = None
    for _ in range(max_pages):
        if cursor:
            params = {'cursor': cursor, 'limit': limit}
        else:
            params = {'limit': limit}
            if since:
                params['created_at_min'] = since
        data = _get('/receipts', params=params)
        receipts.extend(data.get('receipts', []) or [])
        cursor = data.get('cursor')
        if not cursor:
            break
    return receipts


def _to_decimal(value) -> Decimal:
    try:
        return Decimal(str(value if value is not None else 0))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal('0')


def _parse_receipt(receipt: dict):
    """Normalise a Loyverse receipt into the pieces a transaction needs.

    Returns ``(amount, items, summary, is_refund, date)`` where ``amount`` is the
    absolute total (MXN), ``items`` is a JSON-friendly list of line items and
    ``summary`` is a short human string for the notification / description.
    """
    amount = _to_decimal(receipt.get('total_money')).copy_abs()
    is_refund = (receipt.get('receipt_type') or 'SALE').upper() == 'REFUND'

    items, parts = [], []
    for li in receipt.get('line_items') or []:
        name = li.get('item_name') or li.get('variant_name') or 'Artículo'
        raw_qty = li.get('quantity', 1)
        try:
            qty = float(raw_qty)
            qty = int(qty) if qty.is_integer() else qty
        except (TypeError, ValueError):
            qty = raw_qty
        total = li.get('total_money')
        items.append({
            'name': name,
            'quantity': qty,
            'total': str(_to_decimal(total)) if total is not None else None,
        })
        parts.append(f'{qty}× {name}' if qty not in (1, '1') else name)

    summary = ', '.join(parts)[:255]
    raw_date = receipt.get('receipt_date') or receipt.get('created_at')
    date = parse_datetime(raw_date) if raw_date else None
    return amount, items, summary, is_refund, date


def _record_receipt(student, receipt: dict):
    """Idempotently record one receipt against ``student``.

    Returns the newly-created ``CafeteriaTransaction`` (with balance debited), or
    ``None`` if the receipt had no usable id or was already processed — the unique
    ``loyverse_receipt_id`` makes re-runs a no-op.
    """
    from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

    receipt_id = str(receipt.get('receipt_number') or '').strip()
    if not receipt_id:
        return None

    amount, items, summary, is_refund, date = _parse_receipt(receipt)
    tx_type = (CafeteriaTransaction.TxType.REFUND if is_refund
               else CafeteriaTransaction.TxType.PURCHASE)

    with transaction.atomic():
        cb, _ = CafeteriaBalance.objects.select_for_update().get_or_create(student=student)
        tx, created = CafeteriaTransaction.objects.get_or_create(
            loyverse_receipt_id=receipt_id,
            defaults={
                'student': student,
                'transaction_type': tx_type,
                'amount': amount,
                'description': summary,
                'items': items,
                'date': date or timezone.now(),
            },
        )
        if not created:
            return None

        # Purchases debit the local ledger; refunds credit it (spec R1: DB is the
        # source of truth, Loyverse receipts are authoritative for spend).
        current = cb.balance or Decimal('0')
        cb.balance = current + amount if is_refund else current - amount
        cb.last_synced = timezone.now()
        cb.save(update_fields=['balance', 'last_synced'])

        tx.balance_after = cb.balance
        tx.save(update_fields=['balance_after'])
        return tx


def _notify_purchase(tx):
    """Fan out an in-app + email purchase notification to every guardian."""
    from apps.cafeteria.models import CafeteriaTransaction
    from apps.portal.models import Notification
    from apps.portal.services import notify

    student = tx.student
    if tx.transaction_type == CafeteriaTransaction.TxType.REFUND:
        title = 'Devolución en cafetería'
        head = f'Se registró una devolución de ${tx.amount:.2f}'
    else:
        title = 'Compra en cafetería'
        head = f'Compra en cafetería: ${tx.amount:.2f}'
    detail = f' — {tx.description}' if tx.description else ''
    balance = f' Saldo actual: ${tx.balance_after:.2f}.' if tx.balance_after is not None else ''
    message = f'{student.user.full_name}: {head}{detail}.{balance}'

    notified = 0
    for parent in student.parents.all():
        notify(parent, Notification.NotifType.CAFETERIA, title, message)
        notified += 1
    return notified


def _maybe_low_balance_alert(cb, now):
    """Send a deduped low-balance alert if a purchase pushed the balance under.

    Mirrors the ``low_balance_alerts`` cron dedup: one alert per cooldown window,
    tracked on ``CafeteriaBalance.last_low_balance_alert_at`` and cleared by that
    command once the balance recovers.
    """
    from apps.portal.models import Notification
    from apps.portal.services import notify

    if not cb.is_low_balance:
        return 0

    cooldown = getattr(settings, 'CAFETERIA_LOW_BALANCE_ALERT_COOLDOWN_DAYS', 7)
    cutoff = now - timedelta(days=cooldown)
    if cb.last_low_balance_alert_at is not None and cb.last_low_balance_alert_at > cutoff:
        return 0

    student = cb.student
    title = 'Saldo bajo en cafetería'
    message = (
        f'El saldo de cafetería de {student.user.full_name} es de '
        f'${cb.balance:.2f}, por debajo del mínimo de '
        f'${cb.low_balance_threshold:.2f}. Le recomendamos recargar para evitar '
        f'contratiempos a la hora del almuerzo.'
    )
    notified = 0
    for parent in student.parents.all():
        notify(parent, Notification.NotifType.CAFETERIA, title, message)
        notified += 1

    cb.last_low_balance_alert_at = now
    cb.save(update_fields=['last_low_balance_alert_at'])
    return notified


def sync_purchases():
    """Poll Loyverse receipts → transactions + balance debit + parent alerts.

    Idempotent: each receipt maps to a unique ``CafeteriaTransaction`` so re-runs
    neither duplicate rows nor re-notify. Called by the ``sync_purchases`` cron
    command (spec §2.1). Returns a summary dict.
    """
    from apps.accounts.models import StudentProfile
    from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

    students = {
        s.loyverse_id: s
        for s in StudentProfile.objects.filter(is_active=True).exclude(loyverse_id='')
    }
    if not students:
        logger.info('sync_purchases: no students with a Loyverse id — nothing to do.')
        return {'students': 0, 'receipts': 0, 'created': 0, 'notified': 0}

    # Only poll receipts newer than the last one we processed (idempotency still
    # guards the overlap window); a small look-back avoids missing boundary rows.
    last = (CafeteriaTransaction.objects
            .filter(transaction_type=CafeteriaTransaction.TxType.PURCHASE)
            .order_by('-date').first())
    since = (last.date - timedelta(minutes=5)).isoformat() if last and last.date else None

    receipts = get_receipts(since=since)

    now = timezone.now()
    created = notified = 0
    for receipt in receipts:
        customer_id = receipt.get('customer_id')
        student = students.get(customer_id) if customer_id else None
        if student is None:
            continue

        tx = _record_receipt(student, receipt)
        if tx is None:
            continue

        created += 1
        notified += _notify_purchase(tx)

        if tx.transaction_type == CafeteriaTransaction.TxType.PURCHASE:
            cb = CafeteriaBalance.objects.get(student=student)
            notified += _maybe_low_balance_alert(cb, now)

    logger.info(
        f'sync_purchases: {len(receipts)} receipt(s) polled, {created} new, '
        f'{notified} notification(s) sent.'
    )
    return {
        'students': len(students),
        'receipts': len(receipts),
        'created': created,
        'notified': notified,
    }


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
