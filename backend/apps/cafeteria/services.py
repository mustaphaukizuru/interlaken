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
from datetime import timezone as dt_timezone
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

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


def get_all_customers(limit: int = 250, max_pages: int = 40) -> list:
    """Fetch every customer store-wide, following Loyverse's cursor.

    Powers ``link_loyverse`` (roster ↔ Loyverse linking): one pass builds a
    ``customer_code → id`` map for the whole school. ``max_pages`` caps the poll
    (250 × 40 = 10k customers) as a runaway guard.
    """
    customers: list = []
    cursor = None
    for _ in range(max_pages):
        params = {'cursor': cursor, 'limit': limit} if cursor else {'limit': limit}
        data = _get('/customers', params=params)
        customers.extend(data.get('customers', []) or [])
        cursor = data.get('cursor')
        if not cursor:
            break
    return customers


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


def _loyverse_ts(dt) -> str:
    """Format a datetime for Loyverse's ``created_at_min`` — RFC3339 with a ``Z``
    suffix and no microseconds. A raw ``.isoformat()`` (``+00:00`` offset) is
    rejected by the API with a 400."""
    return (dt.astimezone(dt_timezone.utc).replace(microsecond=0)
            .isoformat().replace('+00:00', 'Z'))


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
    from apps.accounts.family import family_notify_recipients
    for parent in family_notify_recipients(student):
        use_wa = bool(getattr(parent, 'whatsapp', '') or '')
        notify(parent, Notification.NotifType.CAFETERIA, title, message,
               whatsapp=use_wa)
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
    from apps.accounts.family import family_notify_recipients
    for parent in family_notify_recipients(student):
        use_wa = bool(getattr(parent, 'whatsapp', '') or '')
        notify(parent, Notification.NotifType.CAFETERIA, title, message,
               whatsapp=use_wa)
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
    if last and last.date:
        since = _loyverse_ts(last.date - timedelta(minutes=5))
    else:
        # FIRST RUN — must NOT backfill history. The opening balance was seeded
        # from Loyverse points, which ALREADY reflect every past purchase, so
        # replaying historical receipts would double-debit (spec R1). Start from
        # the configured go-live moment (CAFETERIA_SYNC_PURCHASES_SINCE), or now.
        since = (getattr(settings, 'CAFETERIA_SYNC_PURCHASES_SINCE', '') or '').strip() \
            or _loyverse_ts(timezone.now())

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
    """SEED a student's opening cafeteria balance from Loyverse — exactly once.

    Per spec **R1** the local ``CafeteriaBalance`` is the source of truth: top-ups,
    purchase syncs, adjustments and refunds all own the balance. Loyverse
    ``total_points`` is used ONLY to establish the *opening* balance the first time
    we ever touch a student — after that we must never overwrite it, or an online
    top-up (which R1 can't push to Loyverse) would be clobbered and POS purchases
    double-counted (once here, once by ``sync_purchases``).

    ``last_synced is None`` is the "never seeded" signal — every ledger mutation
    sets it — so an already-seeded student is a no-op (no overwrite, no Loyverse
    call). Returns the current balance in MXN. The points fetch runs outside the
    row lock; a re-check under ``select_for_update`` guards the onboarding race
    with a concurrent first top-up/purchase.
    """
    from apps.cafeteria.models import CafeteriaBalance

    # Fast path: already seeded / locally owned — no overwrite, no Loyverse call.
    existing = CafeteriaBalance.objects.filter(student=student_profile).first()
    if existing is not None and existing.last_synced is not None:
        return existing.balance

    # Fetch the opening points BEFORE creating any row, so a failed seed leaves no
    # empty balance behind.
    try:
        customer = get_customer_by_id(student_profile.loyverse_id)
        balance = get_balance_from_customer(customer)
    except LoyverseError as e:
        logger.error(f'Opening-balance seed failed for {student_profile}: {e}')
        raise

    with transaction.atomic():
        cb, _ = CafeteriaBalance.objects.select_for_update().get_or_create(student=student_profile)
        if cb.last_synced is not None:
            return cb.balance      # seeded/credited while we were fetching
        cb.balance = balance
        cb.last_synced = timezone.now()
        cb.save(update_fields=['balance', 'last_synced'])

    logger.info(f'Seeded opening balance for {student_profile}: {balance}')
    return balance


def sync_all_balances():
    """Seed opening balances for every linked student — the ``sync_balances`` cron.

    Idempotent by design (see ``sync_student_balance``): newly-linked students get
    their opening balance from Loyverse; already-seeded students are a no-op, so
    this is safe to run on a schedule without ever clobbering the local ledger.
    """
    from apps.accounts.models import StudentProfile

    students = StudentProfile.objects.filter(
        is_active=True
    ).exclude(loyverse_id='')

    seeded, failed = 0, 0
    for student in students:
        try:
            sync_student_balance(student)
            seeded += 1
        except LoyverseError:
            failed += 1

    logger.info(f'Opening-balance seed complete: {seeded} ok, {failed} failed')
    return {'synced': seeded, 'failed': failed}


def _topup_reference(payment) -> str:
    """Stable idempotency key for an online top-up, stored on the ``topup``
    transaction's unique ``loyverse_receipt_id`` so a replayed webhook is a no-op."""
    return f'topup-payment-{payment.id}'


def complete_online_topup(payment):
    """Credit the local cafeteria ledger for a confirmed online top-up (spec §2.2).

    Given a **successful** cafeteria ``Payment`` linked to a ``TopUpRequest`` (via
    ``related_topup``), this atomically:

    - credits the student's local ``CafeteriaBalance`` — the source of truth per
      spec **R1** (Loyverse ``total_points`` is read-only, so we **never** write to
      Loyverse here; the local ledger is authoritative for credit),
    - records a ``topup`` ``CafeteriaTransaction`` with ``balance_after`` set,
    - marks the ``TopUpRequest`` completed.

    Idempotent and safe to call more than once: the unique reference guards against
    a retried/replayed webhook double-crediting. Returns the created
    ``CafeteriaTransaction`` (or ``None`` if the payment isn't a linked top-up or
    was already applied).
    """
    from django.utils import timezone as _tz

    from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest

    topup = getattr(payment, 'related_topup', None)
    if topup is None:
        return None

    # Defence in depth against a double-credit: COMPLETED means already applied
    # (admin or prior webhook). FAILED is allowed so a late SUCCESS after soft
    # expire/supersede can still credit. The per-payment reference guard below
    # catches a replay of the *same* payment.
    if topup.status == TopUpRequest.Status.COMPLETED:
        logger.info(f'Top-up #{topup.id} already completed — webhook credit no-op.')
        return None
    if topup.status not in (TopUpRequest.Status.PENDING, TopUpRequest.Status.FAILED):
        logger.info(f'Top-up #{topup.id} status={topup.status} — webhook credit no-op.')
        return None

    student = topup.student
    amount = Decimal(str(payment.amount))
    reference = _topup_reference(payment)

    with transaction.atomic():
        cb, _ = CafeteriaBalance.objects.select_for_update().get_or_create(student=student)

        if CafeteriaTransaction.objects.filter(loyverse_receipt_id=reference).exists():
            logger.info(f'Top-up {reference!r} already credited for {student} — no-op.')
            return None

        cb.balance = (cb.balance or Decimal('0')) + amount
        cb.last_synced = _tz.now()
        cb.save(update_fields=['balance', 'last_synced'])

        tx = CafeteriaTransaction.objects.create(
            student=student,
            transaction_type=CafeteriaTransaction.TxType.TOPUP,
            amount=amount,
            description=payment.description or f'Recarga en línea #{topup.id}',
            loyverse_receipt_id=reference,
            balance_after=cb.balance,
        )

        topup.status = TopUpRequest.Status.COMPLETED
        topup.processed_at = _tz.now()
        topup.payment_ref = payment.gateway_tx_id or str(payment.id)
        topup.save(update_fields=['status', 'processed_at', 'payment_ref'])

    logger.info(f'Online top-up credited: ${amount} to {student} (payment #{payment.id}).')
    return tx


def fail_online_topup(payment):
    """Mark a linked ``TopUpRequest`` failed after a declined/failed payment.

    Credits **nothing** (spec F4: no Loyverse/ledger credit on failure). Idempotent.
    Returns the ``TopUpRequest`` (or ``None`` if the payment isn't a linked top-up).
    """
    from django.utils import timezone as _tz

    from apps.cafeteria.models import TopUpRequest

    topup = getattr(payment, 'related_topup', None)
    if topup is None:
        return None

    if topup.status != TopUpRequest.Status.PENDING:
        return topup

    topup.status = TopUpRequest.Status.FAILED
    topup.processed_at = _tz.now()
    topup.save(update_fields=['status', 'processed_at'])
    return topup


def flag_pos_unload_if_needed(topup) -> bool:
    """Queue Loyverse POS unload when a POS-loaded online top-up is reversed.

    Local ledger reversal does not touch Loyverse (R1). If staff already loaded
    the credit into POS, ops must manually remove it. Idempotent.
    Returns True when the unload flag was newly set.
    """
    from apps.cafeteria.models import TopUpRequest

    if topup is None:
        return False
    if topup.method != TopUpRequest.Method.ONLINE:
        return False
    if topup.pos_loaded_at is None:
        return False
    if topup.pos_unload_needed_at is not None:
        return False

    topup.pos_unload_needed_at = timezone.now()
    topup.save(update_fields=['pos_unload_needed_at'])
    logger.info(
        'Queued Loyverse POS unload for top-up #%s (was loaded at %s).',
        topup.id, topup.pos_loaded_at,
    )
    return True


def reverse_online_topup(payment):
    """Reverse a credited online top-up after a provider refund/chargeback webhook.

    Locates the ``topup-payment-<id>`` ledger row and runs ``refund_transaction``.
    If the top-up was already loaded into Loyverse POS, queues a staff unload.
    Idempotent (second call is a no-op via the refund-tx reference). Returns the
    ``BalanceAdjustment`` or ``None`` when there is nothing to reverse.
    """
    from apps.cafeteria.models import CafeteriaTransaction

    topup = getattr(payment, 'related_topup', None)
    if topup is None and payment.payment_type != 'cafeteria':
        return None

    # Flag unload even when the local reverse fails (e.g. child already spent) —
    # Loyverse may still hold residual credit that staff must clear.
    flag_pos_unload_if_needed(topup)

    reference = _topup_reference(payment)
    tx = CafeteriaTransaction.objects.filter(loyverse_receipt_id=reference).first()
    if tx is None:
        logger.info(
            'No cafeteria credit to reverse for payment #%s (never credited).',
            payment.id,
        )
        return None

    try:
        return refund_transaction(
            tx, reason='Reembolso del proveedor de pagos', admin=None,
            # Unload already flagged above; avoid a second save in the nested path.
            flag_pos_unload=False,
        )
    except ValueError as exc:
        # Already refunded, or balance already spent — leave Payment.REFUNDED and
        # surface for ops; never re-raise into the webhook ack.
        logger.warning(
            'Could not reverse cafeteria top-up for payment #%s: %s',
            payment.id, exc,
        )
        return None


def notify_topup_result(payment, *, success: bool) -> int:
    """Notify the student's guardians of a top-up outcome (type ``payment`` + email).

    Best-effort and side-effect-only (call it **after** the DB transaction commits so
    email sending never runs inside a lock). Returns the number of guardians notified.
    """
    from apps.portal.models import Notification
    from apps.portal.services import notify

    topup = getattr(payment, 'related_topup', None)
    if topup is None:
        return 0

    student = topup.student
    if success:
        title = 'Recarga de cafetería exitosa'
        message = (
            f'Se registró el pago de ${payment.amount:.2f} para el saldo de '
            f'cafetería de {student.user.full_name}. Ya puede verlo en el portal; '
            f'el colegio cargará el monto en el POS para que pueda usarlo al comprar. '
            f'Referencia: {payment.gateway_tx_id or payment.id}.'
        )
    else:
        title = 'Recarga de cafetería no completada'
        message = (
            f'No fue posible procesar la recarga de ${payment.amount:.2f} para '
            f'{student.user.full_name}. No se realizó ningún cargo a su saldo. '
            f'Puede intentarlo nuevamente desde el portal.'
        )

    notified = 0
    from apps.accounts.family import family_notify_recipients
    for parent in family_notify_recipients(student):
        notify(parent, Notification.NotifType.PAYMENT, title, message)
        notified += 1
    return notified


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


# ── Admin console (Phase D) ──────────────────────────────────────────────────
#
# Manual adjustments, refunds and reconciliation. Every balance mutation here is
# atomic (``select_for_update``) and audited via ``BalanceAdjustment`` so who/when/
# why is always recoverable (spec §5 F5, R7). Per spec R1 the local ledger is the
# source of truth — we never write ``total_points`` to Loyverse.


def _notify_balance_change(student, title, message):
    """Fan out an in-app + email notification to every guardian. Returns count."""
    from apps.accounts.family import family_notify_recipients
    from apps.portal.models import Notification
    from apps.portal.services import notify

    notified = 0
    for parent in family_notify_recipients(student):
        notify(parent, Notification.NotifType.CAFETERIA, title, message)
        notified += 1
    return notified


def adjust_balance(student, amount, reason: str, admin=None):
    """Apply an audited manual credit/debit to a student's cafeteria balance.

    ``amount`` is a signed ``Decimal`` (positive = credit, negative = debit). This
    atomically updates the local ledger, records an ``ADJUSTMENT``
    ``CafeteriaTransaction`` (with running ``balance_after``) and a
    ``BalanceAdjustment`` audit row, then notifies the guardians (outside the lock).

    Returns the created ``BalanceAdjustment``. Raises ``ValueError`` on a zero
    amount or a debit that would overdraw the balance below zero.
    """
    from apps.cafeteria.models import BalanceAdjustment, CafeteriaBalance, CafeteriaTransaction

    amount = Decimal(str(amount)).quantize(Decimal('0.01'))
    if amount == 0:
        raise ValueError('El monto del ajuste no puede ser cero.')

    with transaction.atomic():
        cb, _ = CafeteriaBalance.objects.select_for_update().get_or_create(student=student)
        current = cb.balance or Decimal('0')
        new_balance = current + amount
        if new_balance < 0:
            raise ValueError(
                f'El ajuste dejaría el saldo en ${new_balance:.2f}; no se permite un '
                f'saldo negativo (saldo actual ${current:.2f}).'
            )

        cb.balance = new_balance
        cb.last_synced = timezone.now()
        # A credit that lifts the balance above the threshold clears the alert dedup
        # so a future dip re-alerts (mirrors low_balance_alerts recovery behaviour).
        fields = ['balance', 'last_synced']
        if not cb.is_low_balance and cb.last_low_balance_alert_at is not None:
            cb.last_low_balance_alert_at = None
            fields.append('last_low_balance_alert_at')
        cb.save(update_fields=fields)

        tx = CafeteriaTransaction.objects.create(
            student=student,
            transaction_type=CafeteriaTransaction.TxType.ADJUSTMENT,
            amount=amount.copy_abs(),
            description=(f'Ajuste manual: {reason}' if reason else 'Ajuste manual'),
            balance_after=cb.balance,
        )
        # loyverse_receipt_id is unique=True; leaving it '' means only ONE such
        # row can ever exist system-wide, so the second manual adjustment (any
        # student) would hit an IntegrityError. Stamp a unique synthetic
        # reference, mirroring the refund-tx-<id> / topup-* convention.
        tx.loyverse_receipt_id = f'adjust-tx-{tx.id}'
        tx.save(update_fields=['loyverse_receipt_id'])
        adj = BalanceAdjustment.objects.create(
            student=student,
            admin=admin,
            kind=BalanceAdjustment.Kind.ADJUSTMENT,
            amount=amount,
            reason=reason,
            balance_after=cb.balance,
            transaction=tx,
        )

    # Best-effort remote mirror (R1: expected no-op on the current Loyverse plan).
    if student.loyverse_id:
        try:
            with _session() as session:
                resp = session.post(
                    f'{_base_url()}/customers',
                    json={'id': student.loyverse_id, 'total_points': float(cb.balance)},
                    timeout=_TIMEOUT,
                )
                resp.raise_for_status()
        except requests.RequestException as e:
            logger.warning(f'Loyverse mirror after adjustment skipped for {student}: {e}')

    verb = 'acreditaron' if amount > 0 else 'descontaron'
    _notify_balance_change(
        student,
        'Ajuste de saldo en cafetería',
        (f'Se {verb} ${amount.copy_abs():.2f} al saldo de cafetería de '
         f'{student.user.full_name}. Motivo: {reason}. '
         f'Saldo actual: ${cb.balance:.2f}.'),
    )
    logger.info(f'Balance adjustment ${amount} for {student} by {admin} — reason: {reason!r}')
    return adj


def _net_effect(tx) -> Decimal:
    """The signed effect the given transaction had on the local balance.

    Credits (top-ups, refunds/devoluciones) are positive; purchases are negative.
    Adjustments carry their own sign, recoverable from the audit row.
    """
    from apps.cafeteria.models import BalanceAdjustment, CafeteriaTransaction

    amount = Decimal(str(tx.amount))
    t = tx.transaction_type
    if t == CafeteriaTransaction.TxType.PURCHASE:
        return -amount
    if t in (CafeteriaTransaction.TxType.TOPUP, CafeteriaTransaction.TxType.REFUND):
        return amount
    # ADJUSTMENT: amount is stored absolute; recover the sign from its audit row.
    adj = BalanceAdjustment.objects.filter(transaction=tx).first()
    return Decimal(str(adj.amount)) if adj else amount


def refund_transaction(tx, reason: str = '', admin=None, *, flag_pos_unload: bool = True):
    """Reverse a cafeteria transaction: undo its balance effect + refund any payment.

    Creates a ``REFUND`` ledger transaction that negates the original's effect on
    the balance (a top-up reversal debits; a purchase refund credits), marks the
    linked ``Payment`` refunded when one exists, writes a ``BalanceAdjustment``
    audit row, and notifies the guardians. Idempotent: a second call is a no-op
    (guarded by a unique ``refund-tx-<id>`` reference).

    When reversing a POS-loaded online top-up, queues staff Loyverse unload unless
    ``flag_pos_unload`` is False (webhook path flags earlier so spent-balance
    failures still queue unload).

    Returns the created ``BalanceAdjustment``. Raises ``ValueError`` if the
    transaction can't be refunded (already refunded, is itself a reversal, or the
    debit would overdraw the balance).
    """
    from apps.cafeteria.models import BalanceAdjustment, CafeteriaBalance, CafeteriaTransaction
    from apps.payments.models import Payment

    if tx.transaction_type in (CafeteriaTransaction.TxType.REFUND,
                               CafeteriaTransaction.TxType.ADJUSTMENT):
        raise ValueError('Solo se pueden revertir compras o recargas.')

    student = tx.student
    reference = f'refund-tx-{tx.id}'
    effect = _net_effect(tx)      # original effect on balance
    reversal = -effect            # what the refund applies

    with transaction.atomic():
        cb, _ = CafeteriaBalance.objects.select_for_update().get_or_create(student=student)

        if CafeteriaTransaction.objects.filter(loyverse_receipt_id=reference).exists():
            raise ValueError('Esta transacción ya fue reembolsada.')

        current = cb.balance or Decimal('0')
        new_balance = current + reversal
        if new_balance < 0:
            raise ValueError(
                f'La devolución dejaría el saldo en ${new_balance:.2f}; el alumno ya '
                f'gastó ese saldo. Saldo actual ${current:.2f}.'
            )

        cb.balance = new_balance
        cb.last_synced = timezone.now()
        cb.save(update_fields=['balance', 'last_synced'])

        refund_tx = CafeteriaTransaction.objects.create(
            student=student,
            transaction_type=CafeteriaTransaction.TxType.REFUND,
            amount=reversal.copy_abs(),
            description=(f'Devolución de {tx.get_transaction_type_display().lower()} '
                        f'#{tx.id}' + (f': {reason}' if reason else '')),
            loyverse_receipt_id=reference,
            balance_after=cb.balance,
        )
        adj = BalanceAdjustment.objects.create(
            student=student,
            admin=admin,
            kind=BalanceAdjustment.Kind.REFUND,
            amount=reversal,
            reason=reason or f'Devolución de transacción #{tx.id}',
            balance_after=cb.balance,
            transaction=refund_tx,
            source_transaction=tx,
        )

        # Mark any linked Payment refunded. Online top-ups tag their ledger row
        # ``topup-payment-<payment_id>``; fall back to the TopUpRequest linkage.
        payment = _payment_for_transaction(tx)
        if payment is not None and payment.status != Payment.Status.REFUNDED:
            payment.status = Payment.Status.REFUNDED
            payment.save(update_fields=['status', 'updated_at'])

        if flag_pos_unload and payment is not None:
            flag_pos_unload_if_needed(getattr(payment, 'related_topup', None))

    _notify_balance_change(
        student,
        'Devolución en cafetería',
        (f'Se procesó una devolución de ${reversal.copy_abs():.2f} en el saldo de '
         f'cafetería de {student.user.full_name}.'
         + (f' Motivo: {reason}.' if reason else '')
         + f' Saldo actual: ${cb.balance:.2f}.'),
    )
    logger.info(f'Refund of tx #{tx.id} for {student} by {admin} — reversal ${reversal}')
    return adj


def _payment_for_transaction(tx):
    """Best-effort locate the ``Payment`` behind a top-up ledger transaction."""
    import re

    from apps.payments.models import Payment

    m = re.match(r'topup-payment-(\d+)$', tx.loyverse_receipt_id or '')
    if m:
        return Payment.objects.filter(pk=int(m.group(1))).first()
    return None


def reconcile_balances(*, limit: int = 50, offset: int = 0):
    """Compare linked students' local ledger against Loyverse ``total_points``.

    Paginated (default ``limit=50``) so the admin reconcile endpoint does not
    timeout on a full roster. Returns a dict::

        {rows, checked, total, offset, limit, has_more}

    Read-only — never writes to either side (surfacing drift is the point; see
    spec §7 R1). Students whose Loyverse fetch errors are reported with
    ``error`` set rather than dropped.
    """
    from apps.accounts.models import StudentProfile
    from apps.cafeteria.models import CafeteriaBalance

    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))

    qs = (StudentProfile.objects.filter(is_active=True)
          .exclude(loyverse_id='')
          .select_related('user')
          .order_by('id'))
    total = qs.count()
    page = list(qs[offset:offset + limit])

    rows = []
    for student in page:
        cb, _ = CafeteriaBalance.objects.get_or_create(student=student)
        local = Decimal(str(cb.balance or 0))
        row = {
            'student_id': student.id,
            'student_name': student.user.full_name,
            'student_code': student.student_id,
            'loyverse_id': student.loyverse_id,
            'local_balance': local,
            'loyverse_balance': None,
            'drift': None,
            'in_sync': False,
            'error': None,
        }
        try:
            customer = get_customer_by_id(student.loyverse_id)
            remote = get_balance_from_customer(customer)
            row['loyverse_balance'] = remote
            row['drift'] = local - remote
            row['in_sync'] = (local == remote)
        except LoyverseError as e:
            row['error'] = str(e)
        rows.append(row)

    checked = len(rows)
    return {
        'rows': rows,
        'checked': checked,
        'total': total,
        'offset': offset,
        'limit': limit,
        'has_more': (offset + checked) < total,
    }


# ── Roster ↔ Loyverse linking ────────────────────────────────────────────────
#
# A student's purchases/balance only sync once StudentProfile.loyverse_id holds
# the Loyverse customer's internal **id (UUID)** — NOT the visible customer_code
# or barcode. Collecting each UUID by hand for the whole school is impractical, so
# this matches customers to students by matrícula (== customer_code) and backfills
# every id in one pass. Matching is EXACT (stripped) to avoid mis-linking one
# child's spending onto another; an email fallback covers rosters keyed that way.


def link_students_to_loyverse(customers, *, overwrite=False, commit=False) -> dict:
    """Match Loyverse ``customers`` to students and backfill ``loyverse_id``.

    Pure over the given ``customers`` list (no API calls here — the command/endpoint
    fetches them via ``get_all_customers``), so it is fully unit-testable offline.
    Matches by exact matrícula (``StudentProfile.student_id`` == ``customer_code``),
    falling back to exact email. Only fills EMPTY ids unless ``overwrite``; writes
    only when ``commit`` (default is a dry-run preview).

    Returns a report: ``{customers, students, linked, already_linked,
    skipped_conflict, unmatched_students[], unmatched_customer_count,
    duplicate_codes[], commit, changes[]}``.
    """
    from apps.accounts.models import StudentProfile

    by_code, by_email, dup_codes = {}, {}, set()
    for c in customers:
        code = (c.get('customer_code') or '').strip()
        if code:
            if code in by_code:
                dup_codes.add(code)
            else:
                by_code[code] = c
        email = (c.get('email') or '').strip().lower()
        if email and email not in by_email:
            by_email[email] = c

    report = {
        'customers': len(customers), 'students': 0,
        'linked': 0, 'already_linked': 0, 'skipped_conflict': 0,
        'unmatched_students': [], 'unmatched_customer_count': 0,
        'duplicate_codes': sorted(dup_codes), 'commit': commit, 'changes': [],
    }

    matched_ids = set()
    students = StudentProfile.objects.filter(is_active=True).select_related('user')
    report['students'] = students.count()

    for s in students:
        code = (s.student_id or '').strip()
        email = (s.user.email or '').strip().lower()

        cust, matched_by = by_code.get(code), 'código'
        if cust is None and email:
            cust, matched_by = by_email.get(email), 'correo'
        if cust is None:
            report['unmatched_students'].append(
                {'matricula': s.student_id, 'name': s.user.full_name})
            continue

        uuid = cust.get('id')
        matched_ids.add(uuid)

        if s.loyverse_id == uuid:
            report['already_linked'] += 1
            continue
        if s.loyverse_id and not overwrite:
            # Already linked to a DIFFERENT id — never silently repoint (privacy).
            report['skipped_conflict'] += 1
            continue

        report['linked'] += 1
        report['changes'].append({
            'matricula': s.student_id, 'name': s.user.full_name,
            'loyverse_id': uuid, 'matched_by': matched_by,
            'was': s.loyverse_id or None,
        })
        if commit:
            s.loyverse_id = uuid
            s.save(update_fields=['loyverse_id'])

    report['unmatched_customer_count'] = sum(
        1 for c in customers if c.get('id') not in matched_ids)
    return report


# ── Import students FROM Loyverse ─────────────────────────────────────────────
#
# The whole roster already lives in Loyverse (name, matrícula = customer_code,
# grade encoded in the address like "6APRI", the customer id/UUID, and current
# points). This creates the StudentProfiles directly from those customers so the
# cafeteria works for everyone in one pass — no CSV needed. Parents aren't in
# Loyverse, so guardian linkage is added separately (CSV/manual) afterward.

_LEVEL_ABBR = {'PRE': 'Preescolar', 'KIN': 'Kinder', 'MAT': 'Maternal',
               'PRI': 'Primaria', 'SEC': 'Secundaria', 'PREP': 'Preparatoria'}


def _is_loyverse_student(c) -> bool:
    """A Loyverse customer is a student iff it has a numeric matrícula and the
    school's student email shape ``ci<digits>@interlaken.com.mx`` — this cleanly
    excludes staff (name-based emails, ``ZP-`` prefixes) and test/junk records."""
    code = (c.get('customer_code') or '').strip()
    email = (c.get('email') or '').strip().lower()
    return (code.isdigit()
            and email.startswith('ci')
            and email.endswith('@interlaken.com.mx'))


def _parse_grade_code(addr):
    """Decode Loyverse's grade code → (grade, group). ``6APRI`` → ("6° Primaria", "A")."""
    import re
    m = re.match(r'^\s*(\d)\s*([A-Za-z])\s*(PREP|PRE|KIN|MAT|PRI|SEC)\s*$', (addr or '').upper())
    if not m:
        return '', ''
    num, group, lvl = m.groups()
    return f'{num}° {_LEVEL_ABBR.get(lvl, lvl.title())}', group


def _split_loyverse_name(name):
    """Split a Loyverse name into (first_name, last_name). Mexican convention puts
    the two apellidos first, then the nombres — so the first two words are the
    last name and the rest are the first name (a heuristic; admin can correct
    the rare single-apellido case)."""
    parts = (name or '').split()
    if not parts:
        return 'Alumno', ''
    if len(parts) == 1:
        return parts[0], ''
    if len(parts) == 2:
        return parts[1], parts[0]          # [apellido, nombre]
    return ' '.join(parts[2:]), ' '.join(parts[:2])


def import_students_from_loyverse(customers, *, commit=False, seed_balances=True) -> dict:
    """Create/refresh StudentProfiles from Loyverse customers (students only).

    Pure over the given ``customers`` list (no API calls), so unit-testable
    offline. Idempotent, keyed by matrícula (``student_id`` == ``customer_code``):
    an existing student is updated (name/grade/loyverse_id), a new one is created
    with a student ``User`` (unusable password). When ``seed_balances`` and the
    customer has points, the opening balance is seeded **once** (respects the
    seed-once rule: only when the balance was never touched). Writes only when
    ``commit`` (default is a dry-run preview).

    Returns a report: ``{total_customers, candidates, created, updated,
    skipped_non_student, balance_seeded, errors[], commit, samples[]}``.
    """
    from django.db import transaction as _txn

    from apps.accounts.models import StudentProfile, User
    from apps.cafeteria.models import CafeteriaBalance

    report = {
        'total_customers': len(customers), 'candidates': 0,
        'created': 0, 'updated': 0, 'skipped_non_student': 0,
        'balance_seeded': Decimal('0'), 'errors': [], 'commit': commit, 'samples': [],
    }

    for c in customers:
        if not _is_loyverse_student(c):
            report['skipped_non_student'] += 1
            continue
        report['candidates'] += 1

        code = (c.get('customer_code') or '').strip()
        email = (c.get('email') or '').strip().lower()
        uuid = c.get('id') or ''
        first, last = _split_loyverse_name(c.get('name'))
        grade, group = _parse_grade_code(c.get('address'))
        points = _to_decimal(c.get('total_points'))

        try:
            existing = (StudentProfile.objects.filter(student_id=code)
                        .select_related('user').first())
            is_new = existing is None
            if len(report['samples']) < 10:
                report['samples'].append({
                    'matricula': code, 'name': f'{first} {last}'.strip(),
                    'grade': grade or '—', 'group': group or '—',
                    'points': str(points), 'action': 'crear' if is_new else 'actualizar'})

            if not commit:
                report['created' if is_new else 'updated'] += 1
                continue

            with _txn.atomic():
                if existing:
                    profile = existing
                    u = profile.user
                    u.first_name, u.last_name = first, last
                    u.save(update_fields=['first_name', 'last_name'])
                    if grade:
                        profile.grade = grade
                    if group:
                        profile.group = group
                    profile.loyverse_id = uuid
                    profile.save()
                    report['updated'] += 1
                else:
                    u = User.objects.filter(email=email).first()
                    if u is None:
                        u = User.objects.create_user(
                            email=email, password=None, first_name=first,
                            last_name=last, role=User.Role.STUDENT)
                        u.set_unusable_password()
                        u.save(update_fields=['password'])
                    else:
                        u.first_name, u.last_name, u.role = first, last, User.Role.STUDENT
                        u.save()
                    profile = StudentProfile.objects.create(
                        user=u, student_id=code, grade=grade or 'N/D',
                        group=group, loyverse_id=uuid)
                    report['created'] += 1

                # At Interlaken the family logs in with the student's OWN email
                # (student email == parent email), so the account is its own
                # guardian — this routes purchase/low-balance notifications, which
                # fan out over ``student.parents``, to the family. Idempotent.
                profile.parents.add(u)

                if seed_balances and points > 0:
                    cb, _ = CafeteriaBalance.objects.get_or_create(student=profile)
                    if cb.last_synced is None:      # seed-once (never clobber a topup)
                        cb.balance = points
                        cb.last_synced = timezone.now()
                        cb.save(update_fields=['balance', 'last_synced'])
                        report['balance_seeded'] += points
        except Exception as exc:                     # per-row isolation
            report['errors'].append({'matricula': code, 'error': str(exc)[:150]})

    return report
