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
import re
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


# Coarse spend categories for the parent breakdown (F14). Loyverse receipt line
# items don't carry a category name (only item_id), and resolving item→category
# would need a separate catalog sync; a keyword classifier over the item name is
# a deliberate, good-enough approximation for a school cafeteria and degrades
# gracefully to "Otros". Keep keywords lower-case and accent-stripped.
CATEGORY_OTHER = 'Otros'
_CATEGORY_KEYWORDS = (
    ('Bebidas', (
        'agua', 'jugo', 'refresco', 'soda', 'leche', 'cafe', 'te ', 'licuado',
        'malteada', 'smoothie', 'boing', 'gatorade', 'yakult', 'bebida', 'coca',
        'sprite', 'fanta', 'jarrito', 'electrolit', 'powerade', 'frappe',
    )),
    ('Comida', (
        'torta', 'sandwich', 'sndwich', 'quesadilla', 'taco', 'pizza', 'sopa',
        'hamburguesa', 'hot dog', 'hotdog', 'ensalada', 'arroz', 'pollo', 'carne',
        'burrito', 'mollete', 'chilaquil', 'huevo', 'desayuno', 'almuerzo',
        'comida', 'guisado', 'baguette', 'panini', 'wrap', 'nugget', 'papas a la',
        'espagueti', 'pasta', 'fruta', 'yogurt', 'yoghurt', 'gelatina',
    )),
    ('Snacks', (
        'papas', 'sabritas', 'chips', 'galleta', 'dulce', 'chocolate', 'gomita',
        'chicle', 'palomita', 'frituras', 'botana', 'barra', 'cacahuate',
        'churro', 'donita', 'pan ', 'panque', 'muffin', 'nieve', 'helado',
        'paleta', 'chetos', 'cheetos', 'takis', 'doritos', 'ruffles',
    )),
)


def categorize_item(name: str) -> str:
    """Map a Loyverse line-item name to a coarse cafeteria spend category.

    Deliberate keyword heuristic (see ``_CATEGORY_KEYWORDS``): the receipt gives
    us only the item name, so we bucket by substring. First match wins in the
    Bebidas → Comida → Snacks order; anything unmatched is ``Otros``.
    """
    if not name:
        return CATEGORY_OTHER
    text = name.strip().lower()
    # Cheap accent fold so "café"/"cafe" and "plátano"/"platano" both match.
    for a, b in (('á', 'a'), ('é', 'e'), ('í', 'i'), ('ó', 'o'), ('ú', 'u')):
        text = text.replace(a, b)
    for category, keywords in _CATEGORY_KEYWORDS:
        if any(k in text for k in keywords):
            return category
    return CATEGORY_OTHER


def _points_spent(receipt: dict) -> Decimal:
    """MXN charged to the prepaid wallet on one receipt.

    The school POS charges the wallet through Loyverse's *points redemption*,
    which lands on receipts as a receipt-level ``DISCOUNT_BY_POINTS`` entry in
    ``total_discounts`` (in MXN — 1 point == $1, the same 1:1 mapping the
    opening-balance seed uses). ``total_money`` on such receipts is 0: it is
    the cash/card portion and must NEVER debit the wallet (a kid paying cash
    would otherwise drain a wallet they didn't use). Some Loyverse flows
    report the redemption in ``points_deducted`` instead, so take the MAX of
    the two — never the sum — so a receipt carrying the same redemption in
    both fields can't double-debit (spec R1: prefer under- to over-counting).
    ``points_earned`` (cashback, 0 in this store) is subtracted, clamped at 0.
    """
    discounts = Decimal('0')
    for d in receipt.get('total_discounts') or []:
        if (d.get('type') or '').upper() == 'DISCOUNT_BY_POINTS':
            discounts += _to_decimal(d.get('money_amount')).copy_abs()
    deducted = _to_decimal(receipt.get('points_deducted')).copy_abs()
    earned = _to_decimal(receipt.get('points_earned')).copy_abs()
    return max(max(discounts, deducted) - earned, Decimal('0'))


def _parse_receipt(receipt: dict):
    """Normalise a Loyverse receipt into the pieces a transaction needs.

    Returns ``(amount, items, summary, is_refund, date)`` where ``amount`` is
    the wallet movement in MXN (the points portion — see ``_points_spent``;
    NOT ``total_money``, which is the cash/card portion), ``items`` is a
    JSON-friendly list of line items and ``summary`` is a short human string
    for the notification / description.
    """
    amount = _points_spent(receipt)
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
        # A line's economic value = money paid + points paid. On a points sale
        # the line's total_money is 0 and the spend sits in a line-level
        # DISCOUNT_BY_POINTS entry — without adding it back, every line would
        # aggregate as $0 and the category donut would collapse into "Otros"
        # (promo discounts are NOT added back: those reduce real value).
        total = li.get('total_money')
        line_points = Decimal('0')
        for d in li.get('line_discounts') or []:
            if (d.get('type') or '').upper() == 'DISCOUNT_BY_POINTS':
                line_points += _to_decimal(d.get('money_amount')).copy_abs()
        if total is None and not line_points:
            value = None   # unknown line total → shortfall handling downstream
        else:
            value = _to_decimal(total) + line_points
        items.append({
            'name': name,
            'quantity': qty,
            'total': str(value) if value is not None else None,
            'category': categorize_item(name),
        })
        parts.append(f'{qty}× {name}' if qty not in (1, '1') else name)

    summary = ', '.join(parts)[:255]
    raw_date = receipt.get('receipt_date') or receipt.get('created_at')
    date = parse_datetime(raw_date) if raw_date else None
    return amount, items, summary, is_refund, date


def _record_receipt(student, receipt: dict, *, apply=None):
    """Idempotently record one receipt against ``student``.

    Returns the newly-created ``CafeteriaTransaction`` (with balance debited), or
    ``None`` if the receipt had no usable id or was already processed — the unique
    ``loyverse_receipt_id`` makes re-runs a no-op.

    ``apply`` decides whether the row moves the balance. ``None`` (the default)
    applies the seed rule: a receipt dated on or before the wallet's
    ``seeded_at`` is already netted into the opening balance copied from
    Loyverse, so it is stored as history (``applied=False``, no debit, no
    ``balance_after``). Without this the nightly 7-day re-read would charge a
    pupil imported mid-week twice for last Monday's lunch. ``False`` forces
    history-only (the one-off backfill); ``True`` forces a debit.
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
        if apply is None:
            # The seed copied the points Loyverse's SERVER held at that moment,
            # which include every receipt ingested by then: compare on the
            # server's created_at when present, not the tablet's sale time
            # (a tablet syncing after a day offline ingests old-dated sales
            # the seed could not have known about; those must still debit).
            raw_ingested = receipt.get('created_at')
            ingested = (parse_datetime(raw_ingested) if raw_ingested else None) or date
            apply = not (cb.seeded_at is not None and ingested is not None
                         and ingested <= cb.seeded_at)
        tx, created = CafeteriaTransaction.objects.get_or_create(
            loyverse_receipt_id=receipt_id,
            defaults={
                'student': student,
                'transaction_type': tx_type,
                'amount': amount,
                'description': summary,
                'items': items,
                'date': date or timezone.now(),
                'applied': apply,
            },
        )
        if not created:
            return None
        if not apply:
            return tx

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
               whatsapp=use_wa, fanout=False)
        notified += 1
    return notified


def _maybe_low_balance_alert(cb, now):
    """Send a deduped low-balance alert if a purchase pushed the balance under.

    Mirrors the ``low_balance_alerts`` cron dedup: one alert per cooldown window,
    tracked on ``CafeteriaBalance.last_low_balance_alert_at`` and cleared by that
    command once the balance recovers.
    """
    from django.db.models import Q

    from apps.cafeteria.models import CafeteriaBalance
    from apps.portal.models import Notification
    from apps.portal.services import notify

    if not cb.is_low_balance:
        return 0

    cooldown = getattr(settings, 'CAFETERIA_LOW_BALANCE_ALERT_COOLDOWN_DAYS', 7)
    cutoff = now - timedelta(days=cooldown)
    # Atomically CLAIM the alert slot: a single conditional UPDATE flips the
    # timestamp only if it's unset or past the cooldown. The webhook and a
    # concurrent on-demand refresh both call this for the same student, so a
    # check-then-save read-modify-write would let both send; the DB WHERE clause
    # makes exactly one caller win (rowcount 1) and the loser no-op (rowcount 0).
    claimed = (CafeteriaBalance.objects
               .filter(pk=cb.pk)
               .filter(Q(last_low_balance_alert_at__isnull=True)
                       | Q(last_low_balance_alert_at__lte=cutoff))
               .update(last_low_balance_alert_at=now))
    if not claimed:
        return 0
    cb.last_low_balance_alert_at = now

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
               whatsapp=use_wa, fanout=False)
        notified += 1
    return notified


def _spend_since(student, start) -> Decimal:
    """Sum of a student's PURCHASE amounts since ``start`` (local ledger, F13)."""
    from django.db.models import Sum

    from apps.cafeteria.models import CafeteriaTransaction

    total = (CafeteriaTransaction.objects
             .filter(student=student,
                     transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                     date__gte=start)
             .aggregate(t=Sum('amount'))['t'])
    return total or Decimal('0')


def _maybe_budget_alert(cb, now):
    """Alert guardians when spend crosses a parent-set daily/weekly budget (F13).

    Fired from the purchase record path. Deduped to at most one budget alert per
    student per calendar day, so once a child is over budget the parent isn't
    re-pinged on every later purchase that day. No-op when both limits are 0.
    """
    from django.db.models import Q

    from apps.cafeteria.models import CafeteriaBalance
    from apps.portal.models import Notification
    from apps.portal.services import notify

    daily = cb.daily_spend_limit or Decimal('0')
    weekly = cb.weekly_spend_limit or Decimal('0')
    if daily <= 0 and weekly <= 0:
        return 0

    local_now = timezone.localtime(now)
    start_of_day = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_week = start_of_day - timedelta(days=local_now.weekday())

    student = cb.student
    over = []
    if daily > 0:
        day_spend = _spend_since(student, start_of_day)
        if day_spend > daily:
            over.append(f'hoy lleva ${day_spend:.2f} (límite diario ${daily:.2f})')
    if weekly > 0:
        week_spend = _spend_since(student, start_of_week)
        if week_spend > weekly:
            over.append(f'esta semana lleva ${week_spend:.2f} (límite semanal ${weekly:.2f})')

    if not over:
        return 0

    # Atomically CLAIM the once-per-day slot (see _maybe_low_balance_alert): only
    # one concurrent caller's conditional UPDATE matches when the last alert is
    # unset or from a previous day, so a webhook + a concurrent refresh can't
    # double-alert.
    claimed = (CafeteriaBalance.objects
               .filter(pk=cb.pk)
               .filter(Q(last_budget_alert_at__isnull=True)
                       | Q(last_budget_alert_at__lt=start_of_day))
               .update(last_budget_alert_at=now))
    if not claimed:
        return 0
    cb.last_budget_alert_at = now

    title = 'Límite de gasto alcanzado'
    message = (
        f'{student.user.full_name} superó su presupuesto de cafetería: '
        f'{" y ".join(over)}.'
    )
    notified = 0
    from apps.accounts.family import family_notify_recipients
    for parent in family_notify_recipients(student):
        use_wa = bool(getattr(parent, 'whatsapp', '') or '')
        notify(parent, Notification.NotifType.CAFETERIA, title, message,
               whatsapp=use_wa, fanout=False)
        notified += 1
    return notified


def _students_by_loyverse_id(loyverse_ids=None):
    """Map ``loyverse_id`` → active StudentProfile for receipt matching.

    ``loyverse_ids=None`` loads the whole linked roster (the ``sync_purchases``
    cron, which must match receipts from *any* student). When given, the fetch
    is scoped to just those customer ids — the webhook path passes the payload's
    ids so a 1-receipt delivery doesn't load hundreds of profiles (P7b audit).
    Matching semantics are identical either way: ids outside the roster simply
    aren't in the map and count as unmatched.
    """
    from apps.accounts.models import StudentProfile

    qs = StudentProfile.objects.filter(is_active=True).exclude(loyverse_id='')
    if loyverse_ids is not None:
        qs = qs.filter(loyverse_id__in=loyverse_ids)
    return {s.loyverse_id: s for s in qs}


def _keep_unmatched_receipt(receipt) -> bool:
    """Park a wallet receipt whose Loyverse customer is linked to no student.

    Only receipts that actually moved the wallet are kept (a cash sale attached
    to an unlinked staff card is noise). Keyed by receipt number, so a webhook
    redelivery or an overlapping poll stores it once. Returns True when parked.
    """
    from apps.cafeteria.models import UnmatchedReceipt

    number = str(receipt.get('receipt_number') or '').strip()
    customer_id = receipt.get('customer_id')
    if not number or not customer_id:
        return False
    points = _points_spent(receipt)
    if points == 0:
        return False
    raw = receipt.get('receipt_date') or receipt.get('created_at')
    UnmatchedReceipt.objects.get_or_create(
        receipt_number=number,
        defaults={
            'customer_id': customer_id,
            'receipt_date': parse_datetime(raw) if raw else None,
            'points': points,
            'payload': receipt,
        },
    )
    return True


def replay_unmatched_receipts(loyverse_ids=None) -> dict:
    """Run parked receipts through the normal record path once linked.

    Called after every roster link/import. A receipt is *replayed* (debited,
    silently: it is history, not news) only when it is newer than the
    student's opening-balance seed; anything older is already netted into the
    points that seed was copied from, so it is marked *absorbed* instead of
    debited a second time. Returns ``{replayed, absorbed, created, pending}``.
    """
    from apps.cafeteria.models import CafeteriaBalance, UnmatchedReceipt

    qs = UnmatchedReceipt.objects.filter(resolved_at__isnull=True)
    if loyverse_ids is not None:
        qs = qs.filter(customer_id__in=list(loyverse_ids))
    students = _students_by_loyverse_id(set(qs.values_list('customer_id', flat=True)))
    rows = list(qs.filter(customer_id__in=list(students)).order_by('receipt_date', 'id'))
    if not rows:
        return {'replayed': 0, 'absorbed': 0, 'created': 0,
                'pending': UnmatchedReceipt.objects.filter(resolved_at__isnull=True).count()}

    seeded_at = {
        cb.student_id: cb.seeded_at
        for cb in CafeteriaBalance.objects.filter(student__in=students.values())
    }
    now = timezone.now()
    to_replay, absorbed = [], []
    for r in rows:
        student = students[r.customer_id]
        seed = seeded_at.get(student.id)
        if seed is not None and r.receipt_date is not None and r.receipt_date > seed:
            to_replay.append(r)
        else:
            absorbed.append(r)

    result = record_receipts([r.payload for r in to_replay], students, notify=False)
    # Absorbed receipts are still the family's history: store them without
    # touching the balance the seed already settled.
    record_receipts([r.payload for r in absorbed], students, notify=False, apply=False)
    for r in rows:
        r.resolved_at = now
        r.resolved_student = students[r.customer_id]
    UnmatchedReceipt.objects.bulk_update(rows, ['resolved_at', 'resolved_student'])
    logger.info('replay_unmatched_receipts: %d replayed (%d new rows), %d absorbed by an opening balance',
                len(to_replay), result['created'], len(absorbed))
    return {'replayed': len(to_replay), 'absorbed': len(absorbed), 'created': result['created'],
            'pending': UnmatchedReceipt.objects.filter(resolved_at__isnull=True).count()}


def record_receipts(receipts, students=None, *, notify=True, apply=None):
    """Record a batch of Loyverse receipts against matched students.

    Shared by the ``sync_purchases`` cron and the real-time Loyverse webhook
    (``LoyverseWebhookView``). Idempotent — each receipt maps to a unique
    ``loyverse_receipt_id`` — so a webhook delivery that overlaps the poll, or a
    webhook retry, is a no-op. Receipts with no wallet movement (pure cash/card
    sales — ``_points_spent`` == 0) are skipped entirely: no ledger row, no
    "$0.00" notification. A wallet receipt whose customer matches no student is
    counted as ``unmatched`` AND parked (``UnmatchedReceipt``) for replay once
    the roster catches up, instead of being lost. For every newly recorded
    purchase it fires the per-purchase parent alert (unless digest mode is on
    or ``notify=False``, the replay path), a low-balance alert and a
    budget/overspend alert. Returns
    ``{'created', 'notified', 'unmatched', 'skipped'}``.
    """
    from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

    if students is None:
        # Webhook path (no pre-built roster map): fetch only the students the
        # payload's receipts can actually match instead of the whole roster.
        # The cron passes its full map explicitly, so its behaviour is unchanged.
        ids = {r.get('customer_id') for r in (receipts or []) if r.get('customer_id')}
        students = _students_by_loyverse_id(ids)
    now = timezone.now()
    per_purchase_notify = notify and not getattr(settings, 'CAFETERIA_PURCHASE_DIGEST', False)

    created = notified = unmatched = skipped = 0
    for receipt in receipts or []:
        customer_id = receipt.get('customer_id')
        student = students.get(customer_id) if customer_id else None
        if student is None:
            unmatched += 1
            _keep_unmatched_receipt(receipt)
            continue

        if _points_spent(receipt) == 0:
            # Cash/card sale merely *attached* to the student (or a zero-point
            # refund): the wallet didn't move, so recording it would fabricate
            # a $0 purchase and spam parents. Visible in the summary so a POS
            # flow change (wallet charged some other way) can't hide silently.
            skipped += 1
            continue

        tx = _record_receipt(student, receipt, apply=apply)
        if tx is None:
            continue

        created += 1
        if not tx.applied:
            continue            # history only: nothing moved, nothing to announce
        if per_purchase_notify:
            notified += _notify_purchase(tx)

        if notify and tx.transaction_type == CafeteriaTransaction.TxType.PURCHASE:
            cb = CafeteriaBalance.objects.get(student=student)
            notified += _maybe_low_balance_alert(cb, now)
            notified += _maybe_budget_alert(cb, now)

    return {'created': created, 'notified': notified, 'unmatched': unmatched,
            'skipped': skipped}


def _newest_receipt_dt(receipts):
    """Newest receipt timestamp in a batch — the poll's own high-water mark.

    Uses the same field ``_parse_receipt`` stores (``receipt_date``/``created_at``).
    Returns an aware datetime or ``None`` for an empty/undated batch.
    """
    newest = None
    for r in receipts or []:
        raw = r.get('receipt_date') or r.get('created_at')
        dt = parse_datetime(raw) if raw else None
        if dt and (newest is None or dt > newest):
            newest = dt
    return newest


def _stamp_poll() -> None:
    """Record that the purchase poll ran. The cursor records the newest receipt
    it SAW, which legitimately stands still over a weekend; this does not, and
    is what "the cron stopped" is measured against (check_sync_fresh, panel)."""
    from apps.cafeteria.models import LoyverseSyncState
    LoyverseSyncState.load()
    LoyverseSyncState.objects.filter(pk=1).update(last_poll_at=timezone.now())


def sync_purchases(*, since_days: int | None = None):
    """Poll Loyverse receipts → transactions + balance debit + parent alerts.

    Idempotent: each receipt maps to a unique ``CafeteriaTransaction`` so re-runs
    neither duplicate rows nor re-notify. Called by the ``sync_purchases`` cron
    command (spec §2.1); the near-real-time webhook shares the same record path
    (``record_receipts``). Returns a summary dict.

    ``since_days`` re-reads a trailing window instead of the cursor's 5-minute
    look-back: the nightly catch-up, so a receipt that reached Loyverse late
    (a tablet syncing after a day offline) or an edited one can never be lost
    behind the cursor. The unique receipt id makes the re-read a no-op for
    everything already recorded.
    """
    from apps.cafeteria.models import LoyverseSyncState

    students = _students_by_loyverse_id()
    _stamp_poll()
    if not students:
        logger.info('sync_purchases: no students with a Loyverse id — nothing to do.')
        return {'students': 0, 'receipts': 0, 'created': 0, 'notified': 0,
                'unmatched': 0, 'skipped': 0}

    # Drive the poll from ITS OWN persisted high-water mark, never from
    # max(PURCHASE.date). The real-time webhook (LoyverseWebhookView) also inserts
    # PURCHASE rows through the shared record path, so keying off the newest
    # transaction would let a delivered webhook advance the cursor past receipts
    # the poll never scanned — permanently skipping an older receipt whose webhook
    # was lost (a never-debited wallet). ``last_purchases_cursor`` is advanced only
    # by the poll below. A small look-back + idempotency guard the overlap window.
    now = timezone.now()
    state = LoyverseSyncState.load()
    if since_days:
        since = _loyverse_ts(now - timedelta(days=int(since_days)))
    elif state.last_purchases_cursor:
        since = _loyverse_ts(state.last_purchases_cursor - timedelta(minutes=5))
    else:
        # FIRST RUN — must NOT backfill history. The opening balance was seeded
        # from Loyverse points, which ALREADY reflect every past purchase, so
        # replaying historical receipts would double-debit (spec R1). Start from
        # the configured go-live moment (CAFETERIA_SYNC_PURCHASES_SINCE), or now.
        since = (getattr(settings, 'CAFETERIA_SYNC_PURCHASES_SINCE', '') or '').strip() \
            or _loyverse_ts(now)

    receipts = get_receipts(since=since)
    result = record_receipts(receipts, students)

    # Advance the poll's own cursor by the newest receipt IT fetched (clamped to
    # now so a mis-stamped future date can't skip a window). The webhook never
    # touches this, so a lost webhook is always re-scanned by a later poll.
    newest = _newest_receipt_dt(receipts)
    if newest is not None:
        newest = min(newest, now)
        if state.last_purchases_cursor is None or newest > state.last_purchases_cursor:
            state.last_purchases_cursor = newest
            state.save(update_fields=['last_purchases_cursor'])

    logger.info(
        f'sync_purchases: {len(receipts)} receipt(s) polled, {result["created"]} new, '
        f'{result["notified"]} notification(s) sent, {result["unmatched"]} unmatched, '
        f'{result["skipped"]} skipped (no wallet movement).'
    )
    return {'students': len(students), 'receipts': len(receipts), **result}


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
        cb.last_synced = cb.seeded_at = timezone.now()
        cb.save(update_fields=['balance', 'last_synced', 'seeded_at'])

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
        notify(parent, Notification.NotifType.PAYMENT, title, message, fanout=False)
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
    # LoyverseError too: _session() raises it when the token is unset, and a
    # best-effort mirror must never undo/500 the already-committed local credit.
    except (LoyverseError, requests.RequestException) as e:
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
        notify(parent, Notification.NotifType.CAFETERIA, title, message, fanout=False)
        notified += 1
    return notified


def _audit_wallet(context, balance, *, admin=None, **metadata):
    """Append an ``AuditLog`` row for a manual wallet mutation. Fail-open: the
    signal-based wallet auditing already records the balance diff, but not the
    admin's *reason* — this explicit row carries it. A logging failure must
    never break the money mutation it describes."""
    try:
        from apps.core.audit import record
        record('update', balance, metadata, actor=admin, context=context)
    except Exception:  # noqa: BLE001 — audit is best-effort by design
        logger.warning('AuditLog write failed for balance #%s (%s)',
                       balance.pk, context, exc_info=True)


def adjust_balance(student, amount, reason: str, admin=None, *,
                   notify=True, mirror=True):
    """Apply an audited manual credit/debit to a student's cafeteria balance.

    ``amount`` is a signed ``Decimal`` (positive = credit, negative = debit). This
    atomically updates the local ledger, records an ``ADJUSTMENT``
    ``CafeteriaTransaction`` (with running ``balance_after``) and a
    ``BalanceAdjustment`` audit row, then notifies the guardians (outside the lock).

    ``notify=False`` skips the guardian notification and ``mirror=False`` skips
    the best-effort Loyverse points push — both are used by the
    ``repair_wallet_ledger`` reconcile, where the local ledger is being SET TO
    Loyverse's value (mirroring back is pointless and a roster-wide adjustment
    blast would spam every family).

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

    _audit_wallet(
        'cafeteria.adjust', cb, admin=admin,
        reason=reason, amount=str(amount), balance_after=str(cb.balance),
        student=student.student_id,
    )

    # Best-effort remote mirror (R1: expected no-op on the current Loyverse plan).
    if mirror and student.loyverse_id:
        try:
            with _session() as session:
                resp = session.post(
                    f'{_base_url()}/customers',
                    json={'id': student.loyverse_id, 'total_points': float(cb.balance)},
                    timeout=_TIMEOUT,
                )
                resp.raise_for_status()
        # LoyverseError too: unset token must skip the mirror, not 500 the adjustment.
        except (LoyverseError, requests.RequestException) as e:
            logger.warning(f'Loyverse mirror after adjustment skipped for {student}: {e}')

    if notify:
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

    _audit_wallet(
        'cafeteria.refund', cb, admin=admin,
        reason=reason or f'Devolución de transacción #{tx.id}',
        amount=str(reversal), balance_after=str(cb.balance),
        source_transaction=tx.id, student=student.student_id,
    )
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


# The POS mirror must not trust a points delta while the ledger is still moving.
# Loyverse's ``customers.update`` fires with a PRE-SALE points snapshot a few
# seconds after the receipt event has already debited the wallet, so for a
# moment Loyverse reads higher than local by exactly the purchase. The
# 2026-09-23 audit found 31 such phantom recargas ($679) across 29 students,
# every one stamped within seconds of a same-amount purchase. A real cash
# recarga that lands inside the window is simply credited on the next tick.
POS_MIRROR_SETTLE_SECONDS = 180
# Loyverse can deliver that stale snapshot later than the settle window when
# it is slow, so a delta that exactly echoes a purchase recorded recently is
# held back for longer. A genuine recarga of the same amount as a purchase in
# the same quarter hour is rare and only waits, never lost.
POS_MIRROR_ECHO_MINUTES = 15


def _pos_delta_is_settled(student, delta, now, *, fresh=False) -> bool:
    """Is a remote-minus-local delta safe to credit as a cash recarga?

    The echo check always runs: a delta equal to one purchase, or to the sum
    of the purchases, recorded in the last ``POS_MIRROR_ECHO_MINUTES`` is the
    stale-snapshot signature, whatever the source. The settle window (no row
    at all in the last ``POS_MIRROR_SETTLE_SECONDS``) only applies to values
    that may be stale, i.e. a webhook payload; a value just read from the API
    (``fresh=True``, the cron's list or the webhook's re-read) reflects the
    sale already, so a genuine recarga typed seconds after a purchase lands
    at once instead of waiting a tick.
    """
    from django.db.models import Sum

    from apps.cafeteria.models import CafeteriaTransaction

    rows = CafeteriaTransaction.objects.filter(student=student)
    if not fresh and rows.filter(
            recorded_at__gte=now - timedelta(seconds=POS_MIRROR_SETTLE_SECONDS)).exists():
        return False
    recent = rows.filter(transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                         applied=True,
                         recorded_at__gte=now - timedelta(minutes=POS_MIRROR_ECHO_MINUTES))
    if recent.filter(amount=delta).exists():
        return False
    total = recent.aggregate(s=Sum('amount'))['s'] or Decimal('0')
    return total != delta


def _record_wallet_audit(customers, result, now) -> dict:
    """Flag stale links, count the unlinked, and persist the roster-wide picture.

    Runs only on a FULL customer list (never on a webhook's partial payload,
    which would flag every student it did not mention). The numbers land in
    ``OpsStatus['wallet_audit']`` so the console and the daily alert read what
    the last mirror pass actually saw, without another Loyverse round trip.
    """
    from django.db.models import Sum

    from apps.accounts.models import StudentProfile
    from apps.cafeteria.models import UnmatchedReceipt
    from apps.core.models import OpsStatus

    remote_ids = {c.get('id') for c in customers if c.get('id')}
    linked = StudentProfile.objects.filter(is_active=True).exclude(loyverse_id='')
    stale = linked.exclude(loyverse_id__in=remote_ids)
    stale.filter(loyverse_missing_since__isnull=True).update(loyverse_missing_since=now)
    (linked.filter(loyverse_id__in=remote_ids, loyverse_missing_since__isnull=False)
           .update(loyverse_missing_since=None))

    linked_ids = set(linked.values_list('loyverse_id', flat=True))
    unlinked = [c for c in customers if c.get('id') not in linked_ids]
    pending = UnmatchedReceipt.objects.filter(resolved_at__isnull=True)

    # Every customer in the store gets (or refreshes) its profile row, staff
    # and test cards included, so the console can show the whole store. A
    # profile failure must never undo the credits this pass just wrote.
    from apps.cafeteria.loyverse_profile import refresh_all_profiles
    try:
        profiles = refresh_all_profiles(customers)
    except Exception:  # noqa: BLE001
        logger.exception('Loyverse profile refresh failed; audit continues')
        profiles = {}

    audit = {
        'profiles_total': profiles.get('total', 0),
        'profiles_staff': profiles.get('staff', 0),
        'profiles_test': profiles.get('test', 0),
        'profiles_other': profiles.get('other', 0),
        'profiles_missing': profiles.get('missing', 0),
        'at': now.isoformat(),
        'compared': (result['credited'] + result['in_sync'] + result['below']
                     + result['deferred'] + result['skipped_pending']),
        'in_sync': result['in_sync'],
        'credited': result['credited'],
        'drifting': result['below'],
        'drift_total': str(result['drift_total']),
        'deferred': result['deferred'],
        'unseeded': result['unseeded'],
        'stale_links': stale.count(),
        'unlinked_customers': len(unlinked),
        'unlinked_students': sum(1 for c in unlinked if _is_loyverse_student(c)),
        'unmatched_receipts': pending.count(),
        'unmatched_points': str(pending.aggregate(s=Sum('points'))['s'] or Decimal('0')),
    }
    OpsStatus.set('wallet_audit', audit)
    return audit


def mirror_pos_topups(customers=None, *, notify=True, fresh=None) -> dict:
    """Credit recargas typed directly into the Loyverse POS into the local ledger.

    The 2026-09-16 roster reconcile showed 69 wallets BELOW Loyverse by round
    amounts ($100, $200, $500 ...), many negative. That is the one flow R1 has no
    channel for: a cash top-up loaded on the POS tablet raises ``total_points``
    in Loyverse, the purchase poll keeps debiting every sale, and the local
    wallet marches negative. Every other money path (online top-up, caja
    escolar, refund, adjustment) already writes the ledger itself.

    One-directional by design: only a POSITIVE remote-minus-local delta is
    credited, as a TOPUP the family can see. A negative delta is never touched
    here; it is either a purchase the next poll will record, or an online top-up
    the staff has not loaded into the POS yet (also excluded explicitly below,
    so a simultaneous cash load cannot be misread). After crediting, local ==
    remote, so re-runs are no-ops: idempotent without needing a receipt id.

    A positive delta is credited only once the ledger has been still for
    ``POS_MIRROR_SETTLE_SECONDS`` and does not echo a purchase just recorded
    (see ``_pos_delta_is_settled``); otherwise it is ``deferred`` to the next
    pass. Every student compared gets ``last_synced`` stamped, so the roster's
    "last sync" column means what it says. When the caller did not supply the
    customer list (the cron, Sincronizar todos) the full roster is audited too:
    stale links flagged, unlinked customers counted, numbers persisted.

    ``customers`` lets the caller reuse an already-fetched store-wide list; the
    cron passes none and fetches once (2 pages), never per student.

    ``notify=False`` is for the deploy-day catch-up: the first run credits the
    accumulated backlog (one wallet was $4,823 behind), and "se registró una
    recarga de $4,823" is not a message to send a family about months of
    history. After that first run the deltas are single recargas and the cron
    notifies normally.
    """
    from apps.accounts.models import StudentProfile
    from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest

    full_roster = customers is None
    if full_roster:
        customers = get_all_customers()
    # A list we fetched ourselves is fresh by construction; a caller-supplied
    # one (webhook payload) is presumed stale unless the caller re-read it.
    if fresh is None:
        fresh = full_roster
    points_by_id = {c.get('id'): get_balance_from_customer(c) for c in customers}

    pending_pos = set(
        TopUpRequest.objects.filter(
            method=TopUpRequest.Method.ONLINE,
            status=TopUpRequest.Status.COMPLETED,
            pos_loaded_at__isnull=True,
        ).values_list('student_id', flat=True)
    )

    students = (StudentProfile.objects.filter(is_active=True)
                .exclude(loyverse_id='').select_related('user'))
    credited = skipped_pending = in_sync = below = unseeded = deferred = 0
    total = drift_total = Decimal('0')
    stamp: list[int] = []
    now = timezone.now()

    for student in students:
        remote = points_by_id.get(student.loyverse_id)
        if remote is None:
            continue
        if student.id in pending_pos:
            skipped_pending += 1
            stamp.append(student.id)
            continue
        with transaction.atomic():
            cb = (CafeteriaBalance.objects.select_for_update()
                  .filter(student=student).first())
            if cb is None or cb.last_synced is None:
                unseeded += 1          # sync_balances seeds these from Loyverse
                continue
            delta = Decimal(str(remote)) - Decimal(str(cb.balance or 0))
            if delta == 0:
                in_sync += 1
                stamp.append(student.id)
                continue
            if delta < 0:
                below += 1             # not ours to touch, see docstring
                drift_total += delta
                stamp.append(student.id)
                continue
            if not _pos_delta_is_settled(student, delta, now, fresh=fresh):
                deferred += 1
                stamp.append(student.id)
                continue
            cb.balance = (cb.balance or Decimal('0')) + delta
            cb.last_synced = now
            fields = ['balance', 'last_synced']
            if not cb.is_low_balance and cb.last_low_balance_alert_at is not None:
                cb.last_low_balance_alert_at = None
                fields.append('last_low_balance_alert_at')
            cb.save(update_fields=fields)
            CafeteriaTransaction.objects.create(
                student=student,
                transaction_type=CafeteriaTransaction.TxType.TOPUP,
                amount=delta,
                description='Recarga en caja de cafetería (POS Loyverse)',
                loyverse_receipt_id=f'pos-topup-{student.id}-{int(now.timestamp())}',
                balance_after=cb.balance,
                date=now,
            )
        credited += 1
        total += delta
        if not notify:
            continue
        _notify_balance_change(
            student, 'Recarga registrada',
            f'Se registró una recarga de ${delta:.2f} en la cafetería. '
            f'Saldo actual: ${cb.balance:.2f}.')

    if stamp:
        CafeteriaBalance.objects.filter(student_id__in=stamp).update(last_synced=now)

    result = {'credited': credited, 'total': total, 'in_sync': in_sync, 'below': below,
              'deferred': deferred, 'drift_total': drift_total,
              'skipped_pending': skipped_pending, 'unseeded': unseeded}
    if full_roster:
        result['audit'] = _record_wallet_audit(customers, result, now)

    logger.info(
        f'mirror_pos_topups: {credited} credited (${total}), {in_sync} in sync, '
        f'{below} below Loyverse (${drift_total}, left to the purchase poll), '
        f'{deferred} deferred (ledger still settling), '
        f'{skipped_pending} pending POS load, {unseeded} unseeded.')
    return result


# ── Phantom POS credits (the 2026-09-23 drift) ───────────────────────────────

PHANTOM_WINDOW_SECONDS = 180


def find_phantom_topups() -> list:
    """Pairs ``(topup_tx, purchase_tx)`` where a POS-mirror credit merely echoed
    a purchase: same student, same amount, stamped within the window, and not
    already reversed. Detection uses ``date`` (the only stamp historical rows
    carry) so it works on rows written before ``recorded_at`` existed."""
    from apps.cafeteria.models import BalanceAdjustment, CafeteriaTransaction

    reversed_ids = set(
        BalanceAdjustment.objects.filter(source_transaction__isnull=False)
        .values_list('source_transaction_id', flat=True))
    window = timedelta(seconds=PHANTOM_WINDOW_SECONDS)
    pairs = []
    topups = (CafeteriaTransaction.objects
              .filter(loyverse_receipt_id__startswith='pos-topup-')
              .select_related('student__user').order_by('id'))
    for tp in topups:
        if tp.id in reversed_ids:
            continue
        purchase = (CafeteriaTransaction.objects
                    .filter(student_id=tp.student_id,
                            transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                            amount=tp.amount,
                            date__gte=tp.date - window, date__lte=tp.date + window)
                    .order_by('id').first())
        if purchase is not None:
            pairs.append((tp, purchase))
    return pairs


def reverse_phantom_topup(topup_tx, *, reason: str, admin=None):
    """Audited debit that undoes one phantom POS credit.

    Writes an ADJUSTMENT row plus a ``BalanceAdjustment`` pointing at the
    phantom via ``source_transaction`` (which is also what makes a second run
    skip it). Unlike ``adjust_balance`` it may not raise on a negative result:
    the amount is by construction what Loyverse already deducted, so the
    outcome is Loyverse's own number. Returns the ``BalanceAdjustment``, or
    ``None`` if this phantom was already reversed.
    """
    from apps.cafeteria.models import BalanceAdjustment, CafeteriaBalance, CafeteriaTransaction

    ref = f'phantom-reversal-{topup_tx.id}'
    if CafeteriaTransaction.objects.filter(loyverse_receipt_id=ref).exists():
        return None
    now = timezone.now()
    with transaction.atomic():
        cb = CafeteriaBalance.objects.select_for_update().get(student_id=topup_tx.student_id)
        amount = Decimal(str(topup_tx.amount))
        cb.balance = (cb.balance or Decimal('0')) - amount
        cb.last_synced = now
        cb.save(update_fields=['balance', 'last_synced'])
        tx = CafeteriaTransaction.objects.create(
            student_id=topup_tx.student_id,
            transaction_type=CafeteriaTransaction.TxType.ADJUSTMENT,
            amount=amount,
            description=f'Reverso de recarga duplicada: {reason}',
            loyverse_receipt_id=ref,
            balance_after=cb.balance,
            date=now,
        )
        adj = BalanceAdjustment.objects.create(
            student_id=topup_tx.student_id,
            admin=admin,
            kind=BalanceAdjustment.Kind.ADJUSTMENT,
            amount=-amount,
            reason=reason,
            balance_after=cb.balance,
            transaction=tx,
            source_transaction=topup_tx,
        )
    _audit_wallet('cafeteria.phantom_reversal', cb, admin=admin, reason=reason,
                  amount=str(-amount), balance_after=str(cb.balance),
                  student=topup_tx.student.student_id, source_tx=topup_tx.id)
    return adj


# A wallet counts as "low" only while it is in use. 148 of 386 wallets sit at
# $0 because those children never buy at the cafetería; counting them made the
# dashboard say "235 saldos bajos" when 25 families actually needed a nudge,
# and the weekly alert would have nagged 144 families about a wallet they do
# not use. Leavers (customer gone from Loyverse) are excluded too.
LOW_BALANCE_ACTIVITY_DAYS = 30


def low_balance_queryset():
    """Active students' wallets at/below their threshold WITH a ledger movement
    in the last ``LOW_BALANCE_ACTIVITY_DAYS`` days. Shared by the dashboard
    counter, the Saldo bajo tab and the weekly alert so all three agree."""
    from django.db.models import Exists, F, OuterRef

    from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

    since = timezone.now() - timedelta(days=LOW_BALANCE_ACTIVITY_DAYS)
    recent = CafeteriaTransaction.objects.filter(student=OuterRef('student'), date__gte=since)
    return (CafeteriaBalance.objects
            .filter(student__is_active=True,
                    student__loyverse_missing_since__isnull=True,
                    balance__lte=F('low_balance_threshold'))
            .annotate(_in_use=Exists(recent)).filter(_in_use=True))


def loyverse_reachable() -> tuple[bool, str]:
    """Cheapest possible liveness probe: one customer, one page.

    Separated from the heavier reads so the health panel can answer "is the
    token still valid and the API up?" without pulling the roster.
    """
    try:
        _get('/customers', params={'limit': 1})
        return True, ''
    except LoyverseError as e:
        return False, str(e)[:200]


def sync_health() -> dict:
    """Everything needed to answer "is the cafeteria sync actually working?".

    This used to be answerable only by SSH-ing to the box and reading
    /var/log/interlaken/loyverse.log, which puts the one diagnosis the office
    needs behind root access to a server. Each field maps to a distinct failure:

    * ``last_purchases_cursor`` old/None → the poll is not running (cron not
      installed, or it has never completed a run).
    * ``loyverse_ok`` false → token expired or the API is unreachable; nothing
      can sync regardless of everything else.
    * ``linked_students`` well below ``active_students`` → receipts will keep
      landing in ``unmatched`` because the roster is not linked.
    * ``last_transaction_at`` old while the cursor is fresh → the poll runs and
      sees receipts but records nothing, i.e. the POS is charging the wallet by
      a route ``_points_spent`` does not recognise.
    """
    from apps.accounts.models import StudentProfile
    from apps.cafeteria.models import CafeteriaTransaction, LoyverseSyncState, UnmatchedReceipt

    state = LoyverseSyncState.load()
    active = StudentProfile.objects.filter(is_active=True)
    week_ago = timezone.now() - timedelta(days=7)
    last_tx = CafeteriaTransaction.objects.order_by('-date').first()
    ok, error = loyverse_reachable()

    from apps.core.models import OpsStatus

    return {
        # Roster-wide picture from the last full mirror pass (cron / Sincronizar
        # todos): drift, stale links, unlinked customers, parked receipts.
        'wallet_audit': OpsStatus.get('wallet_audit'),
        'stale_links': active.filter(loyverse_missing_since__isnull=False).count(),
        'unmatched_receipts': UnmatchedReceipt.objects.filter(resolved_at__isnull=True).count(),
        'loyverse_ok': ok,
        'loyverse_error': error,
        'last_purchases_cursor': state.last_purchases_cursor,
        'last_full_fetch_at': state.last_full_fetch_at,
        # When the poll last RAN: the honest "is the cron alive" signal.
        'last_poll_at': state.last_poll_at,
        # When the daily roster sync (link → import → replay) last completed a
        # written run; None until 2026-09-24 in production because it never had.
        'last_roster_sync_at': state.last_roster_sync_at,
        # Real-time: stamped on every authenticated Loyverse delivery.
        'last_webhook_at': state.last_webhook_at,
        'last_webhook_type': state.last_webhook_type,
        # Nightly backup marker, reported in by deploy/backup-db.sh via
        # `manage.py record_backup` (the container cannot see /var/backups).
        'backup': OpsStatus.get('backup'),
        'active_students': active.count(),
        'linked_students': active.exclude(loyverse_id='').count(),
        'last_transaction_at': last_tx.date if last_tx else None,
        'transactions_last_7d': CafeteriaTransaction.objects.filter(date__gte=week_ago).count(),
        'purchases_last_7d': CafeteriaTransaction.objects.filter(
            date__gte=week_ago,
            transaction_type=CafeteriaTransaction.TxType.PURCHASE).count(),
    }


# ── Roster ↔ Loyverse linking ────────────────────────────────────────────────
#
# A student's purchases/balance only sync once StudentProfile.loyverse_id holds
# the Loyverse customer's internal **id (UUID)** — NOT the visible customer_code
# or barcode. Collecting each UUID by hand for the whole school is impractical, so
# this matches customers to students by matrícula (== customer_code) and backfills
# every id in one pass. Matching is EXACT (stripped) to avoid mis-linking one
# child's spending onto another; an email fallback covers rosters keyed that way.

# Per-student rows the console can act on (unmatched, possible leavers) and the
# before/after preview are capped so a 400-pupil roster never returns an
# unbounded payload.
ROSTER_ROWS_CAP = 500
SKIPPED_ROWS_CAP = 200


def _leaver_row(s, *, loyverse_code):
    """One row of ``unmatched_students`` / ``possible_leavers``: what the office
    needs to decide a baja (id for the bulk-status endpoint, leftover balance so
    money is never silently written off)."""
    cb = getattr(s, 'cafeteria_balance', None)
    return {
        'id': s.id, 'matricula': s.student_id, 'loyverse_code': loyverse_code,
        'name': s.user.full_name, 'grade': s.grade, 'status': s.status,
        'balance': str(cb.balance if cb is not None else Decimal('0')),
    }


def link_students_to_loyverse(customers, *, overwrite=False, commit=False) -> dict:
    """Match Loyverse ``customers`` to students and backfill ``loyverse_id``.

    Pure over the given ``customers`` list (no API calls here — the command/endpoint
    fetches them via ``get_all_customers``), so it is fully unit-testable offline.
    Matches by exact matrícula (``StudentProfile.student_id`` == ``customer_code``),
    falling back to exact email. Only fills EMPTY ids unless ``overwrite``; writes
    only when ``commit`` (default is a dry-run preview).

    Returns a report: ``{customers, students, linked, already_linked,
    skipped_conflict, unmatched_students[], possible_leavers[],
    unmatched_customer_count, duplicate_codes[], commit, changes[]}``.
    ``changes`` rows carry ``field='vinculo'`` with ``before``/``after`` so the
    console can show them in the same diff table as the import.
    ``possible_leavers`` are linked students whose Loyverse customer carries no
    grade code (neither in ``address`` nor as a name suffix): the office strips
    the suffix when a pupil leaves, and nothing else tells the app. No status is
    ever changed here; the office confirms through Vincular Loyverse → Dar de
    baja.
    """
    from apps.accounts.models import StudentProfile

    by_code, by_email, dup_codes = {}, {}, set()
    for c in customers:
        # Same normalisation as the import: Loyverse says ci09938, the app 09938.
        code = _matricula(c.get('customer_code'))
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
        'unmatched_students': [], 'possible_leavers': [], 'unmatched_customer_count': 0,
        'duplicate_codes': sorted(dup_codes), 'commit': commit, 'changes': [],
    }

    matched_ids = set()
    students = (StudentProfile.objects.filter(is_active=True)
                .select_related('user', 'cafeteria_balance'))
    report['students'] = students.count()

    for s in students:
        code = _matricula(s.student_id)
        email = (s.user.email or '').strip().lower()

        cust, matched_by = by_code.get(code), 'código'
        if cust is None and email:
            cust, matched_by = by_email.get(email), 'correo'
        if cust is None:
            # An active student with no Loyverse customer is, in practice, a
            # leaver: the school deletes the customer when a student goes and
            # nothing else tells the app.
            if len(report['unmatched_students']) < ROSTER_ROWS_CAP:
                report['unmatched_students'].append(
                    _leaver_row(s, loyverse_code=s.student_id))
            continue

        uuid = cust.get('id')
        matched_ids.add(uuid)
        raw_code = (cust.get('customer_code') or '').strip() or s.student_id
        if not _has_grade_code(cust) and len(report['possible_leavers']) < ROSTER_ROWS_CAP:
            report['possible_leavers'].append(_leaver_row(s, loyverse_code=raw_code))

        if s.loyverse_id == uuid:
            report['already_linked'] += 1
            continue
        if s.loyverse_id and not overwrite:
            # Already linked to a DIFFERENT id — never silently repoint (privacy).
            report['skipped_conflict'] += 1
            continue

        report['linked'] += 1
        report['changes'].append({
            'matricula': s.student_id, 'loyverse_code': raw_code, 'name': s.user.full_name,
            'loyverse_id': uuid, 'matched_by': matched_by, 'was': s.loyverse_id or None,
            'field': 'vinculo', 'before': s.loyverse_id or '', 'after': uuid,
            'action': 'actualizar',
        })
        if commit:
            s.loyverse_id = uuid
            s.loyverse_missing_since = None
            s.save(update_fields=['loyverse_id', 'loyverse_missing_since'])

    report['unmatched_customer_count'] = sum(
        1 for c in customers if c.get('id') not in matched_ids)
    if commit and report['changes']:
        # Receipts that arrived while these students were unlinked were parked,
        # not lost: run them through the ledger now (or absorb them into the
        # opening balance the seed is about to copy, see replay rules).
        report['replay'] = replay_unmatched_receipts(
            loyverse_ids=[ch['loyverse_id'] for ch in report['changes']])
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


# The school's matrículas are written ``ci10020`` in Loyverse — the same ``ci``
# prefix the student email carries — not bare digits. ``code.isdigit()`` therefore
# rejected EVERY real student, so "Importar desde Loyverse" reported zero
# candidates and imported nobody. Accept both spellings; the email guard below is
# what actually excludes staff and junk records.
_STUDENT_CODE_RE = re.compile(r'^(?:ci)?\d{3,10}$', re.IGNORECASE)

# Why a customer is not treated as a pupil, in the office's words. Reported
# per customer so an edited email or a typo in the code is visible instead of
# silently folded into ``skipped_non_student``.
SKIP_BAD_CODE = 'código no numérico'
SKIP_BAD_EMAIL = 'correo no tiene la forma ci…@interlaken.com.mx'
SKIP_DUPLICATE = 'matrícula duplicada en Loyverse'


def _skip_reason(c) -> str:
    """'' when ``c`` is a pupil, else the es-MX reason it is skipped."""
    code = (c.get('customer_code') or '').strip()
    email = (c.get('email') or '').strip().lower()
    if not _STUDENT_CODE_RE.match(code):
        return SKIP_BAD_CODE
    if not (email.startswith('ci') and email.endswith('@interlaken.com.mx')):
        return SKIP_BAD_EMAIL
    return ''


def _is_loyverse_student(c) -> bool:
    """A Loyverse customer is a student iff its matrícula is ``ci<digits>`` (or
    bare digits) AND it carries the school's student email shape
    ``ci<digits>@interlaken.com.mx`` — which cleanly excludes staff (name-based
    emails, ``ZP-`` prefixes) and test/junk records."""
    return _skip_reason(c) == ''


_GRADE_CODE_RE = re.compile(r'^\s*(\d)\s*([A-Za-z])?\s*(PREP|PRE|KIN|MAT|PRI|SEC)\s*$', re.IGNORECASE)


def _parse_grade_code(addr):
    """Decode Loyverse's grade code → (grade, group).

    ``6APRI`` → ("6° Primaria", "A"). The live roster writes it WITHOUT a group
    letter — ``1PRI`` — and the old pattern made the letter mandatory, so every
    student decoded to ('', '') and was imported with grade "N/D".
    """
    m = _GRADE_CODE_RE.match(addr or '')
    if not m:
        return '', ''
    num, group, lvl = m.groups()
    return f'{num}° {_LEVEL_ABBR.get(lvl.upper(), lvl.title())}', (group or '').upper()


# Loyverse's ``name`` field carries the grade code as a suffix on the given
# name — "Calles Lopez Sebastian-1PRI" — so it has to come off before the
# apellidos/nombre split, or the student is created as "Sebastian-1PRI".
_NAME_GRADE_SUFFIX_RE = re.compile(r'\s*-\s*\d\s*[A-Za-z]?\s*(?:PREP|PRE|KIN|MAT|PRI|SEC)\s*$', re.IGNORECASE)


def _strip_grade_suffix(name):
    return _NAME_GRADE_SUFFIX_RE.sub('', name or '').strip()


def _customer_grade(c):
    """(grade, group) for a customer: the ``address`` code first, else the
    suffix on the name ("…-1PRI"). A code without a letter yields group ''
    so the caller keeps whatever group the app already holds."""
    grade, group = _parse_grade_code(c.get('address'))
    if not grade:
        m = _NAME_GRADE_SUFFIX_RE.search(c.get('name') or '')
        if m:
            grade, group = _parse_grade_code(m.group(0).lstrip(' -'))
    return grade, group


def _has_grade_code(c) -> bool:
    """Does Loyverse still say which grade this customer is in? The office
    removes the code when a pupil leaves, so its absence is the baja signal."""
    return bool(_customer_grade(c)[0])


def _matricula(code):
    """Loyverse writes the matrícula as ``ci09938``; the app stores ``09938``
    (and that is what every existing StudentProfile.student_id holds). Without
    this the import matched none of the 333 linked students and would have
    created 350 duplicates beside them. One rule for every caller: see
    ``apps.core.matricula``."""
    from apps.core.matricula import normalize_matricula
    return normalize_matricula(code)


def _split_loyverse_name(name):
    """Split a Loyverse name into (first_name, last_name). Mexican convention puts
    the two apellidos first, then the nombres — so the first two words are the
    last name and the rest are the first name (a heuristic; admin can correct
    the rare single-apellido case)."""
    parts = _strip_grade_suffix(name).split()
    if not parts:
        return 'Alumno', ''
    if len(parts) == 1:
        return parts[0], ''
    if len(parts) == 2:
        return parts[1], parts[0]          # [apellido, nombre]
    return ' '.join(parts[2:]), ' '.join(parts[:2])


def _note_change(report, *, matricula, name, field, before, after, action):
    if len(report['changes']) < ROSTER_ROWS_CAP:
        report['changes'].append({
            'matricula': matricula, 'name': name, 'field': field,
            'before': before or '', 'after': after or '', 'action': action,
        })


def _note_skip(report, c, reason):
    if len(report['skipped']) < SKIPPED_ROWS_CAP:
        report['skipped'].append({
            'customer_code': (c.get('customer_code') or '').strip(),
            'name': (c.get('name') or '').strip(), 'reason': reason,
        })


def _plan_existing(existing, snapshot, *, first, last, incoming_name, grade, group,
                   raw_code, uuid):
    """What the import would change on an existing student, as
    ``[(field, before, after)]`` plus whether the name gets rewritten.

    The name rule (decision C3.2): Loyverse wins only when the Loyverse name
    CHANGED since the roster sync last applied it (``LoyverseProfile
    .applied_name``). With no marker yet (first run after this shipped, or a
    customer never snapshotted) the name is written only when the app holds
    none, so a correction typed in the console is never clobbered by a sync
    that merely re-read the same Loyverse name.
    """
    u = existing.user
    previous_name = snapshot.applied_name if snapshot is not None else ''
    if previous_name:
        rename = incoming_name != previous_name
    else:
        rename = not f'{u.first_name}{u.last_name}'.strip()
    rename = rename and (u.first_name, u.last_name) != (first, last)

    diffs = []
    if rename:
        diffs.append(('nombre', u.full_name, f'{first} {last}'.strip()))
    if grade and existing.grade != grade:
        diffs.append(('grado', existing.grade, grade))
    if group and existing.group != group:
        diffs.append(('grupo', existing.group, group))
    shown_code = (snapshot.customer_code if snapshot is not None and snapshot.customer_code
                  else existing.student_id)
    if raw_code and shown_code != raw_code:
        diffs.append(('codigo', shown_code, raw_code))
    if uuid and existing.loyverse_id != uuid:
        diffs.append(('vinculo', existing.loyverse_id, uuid))
    return diffs, rename


def _stamp_snapshot(profile, c, snapshot, incoming_name):
    """Keep the student's LoyverseProfile row current for what the console
    shows (Código Loyverse) and record the Loyverse name the sync just
    applied/acknowledged. One refresh when the row is missing or its code,
    name or binding drifted; one UPDATE when only the marker moved; nothing
    when nothing changed, so the nightly run is mostly reads."""
    from apps.cafeteria.loyverse_profile import parse_customer_snapshot, upsert_loyverse_profile
    from apps.cafeteria.models import LoyverseProfile

    fresh = parse_customer_snapshot(c)
    if (snapshot is None or snapshot.student_id != profile.pk
            or snapshot.customer_code != fresh['customer_code']
            or snapshot.name != fresh['name']
            or snapshot.address_code != fresh['address_code']):
        snapshot, _ = upsert_loyverse_profile(profile, c)
    if snapshot.applied_name != incoming_name:
        LoyverseProfile.objects.filter(pk=snapshot.pk).update(applied_name=incoming_name)
        snapshot.applied_name = incoming_name
    return snapshot


def import_students_from_loyverse(customers, *, commit=False, seed_balances=True) -> dict:
    """Create/refresh StudentProfiles from Loyverse customers (students only).

    Pure over the given ``customers`` list (no API calls), so unit-testable
    offline. Idempotent, keyed by matrícula (``student_id`` == ``customer_code``):
    an existing student is refreshed (grade/group from the Loyverse grade code,
    ``loyverse_id``, and the name only when Loyverse's name changed since the
    last sync, see ``_plan_existing``), a new one is created with a student
    ``User`` (unusable password). When ``seed_balances`` and the customer has
    points, the opening balance is seeded **once** (respects the seed-once
    rule: only when the balance was never touched). Writes only when
    ``commit`` (default is a dry-run preview); the dry run computes exactly the
    diffs the commit would apply.

    Returns a report: ``{total_customers, candidates, created, updated,
    unchanged, renamed, skipped_non_student, skipped_duplicate, balance_seeded,
    errors[], commit, samples[], skipped[{customer_code, name, reason}],
    changes[{matricula, name, field, before, after, action}]}`` where
    ``field`` is one of ``nombre``, ``grado``, ``grupo``, ``codigo``,
    ``vinculo``. Every name rewrite is audited (``context='import:loyverse'``).
    """
    from django.db import transaction as _txn

    from apps.accounts.models import StudentProfile, User
    from apps.cafeteria.models import CafeteriaBalance, LoyverseProfile
    from apps.core.audit import record

    report = {
        'total_customers': len(customers), 'candidates': 0,
        'created': 0, 'updated': 0, 'unchanged': 0, 'renamed': 0,
        'skipped_non_student': 0, 'skipped_duplicate': 0,
        'balance_seeded': Decimal('0'), 'errors': [], 'commit': commit,
        'samples': [], 'skipped': [], 'changes': [],
    }

    # Two lookups for the whole run instead of one SELECT per customer: the
    # roster by matrícula and the Loyverse snapshots by customer id.
    pupils = [c for c in customers if _is_loyverse_student(c)]
    existing_by_code = {
        s.student_id: s for s in StudentProfile.objects
        .filter(student_id__in={_matricula(c.get('customer_code')) for c in pupils})
        .select_related('user')
    }
    snapshots = {
        p.loyverse_id: p for p in LoyverseProfile.objects
        .filter(loyverse_id__in={c.get('id') for c in pupils if c.get('id')})
    }

    seen_codes = set()
    for c in customers:
        reason = _skip_reason(c)
        if reason:
            report['skipped_non_student'] += 1
            _note_skip(report, c, reason)
            continue
        code = _matricula(c.get('customer_code'))
        if code in seen_codes:
            # Two customers with one matrícula: the link pass uses the first
            # and reports the code; importing the second would repoint the
            # student's wallet to the other card.
            report['skipped_duplicate'] += 1
            _note_skip(report, c, SKIP_DUPLICATE)
            continue
        seen_codes.add(code)
        report['candidates'] += 1

        email = (c.get('email') or '').strip().lower()
        uuid = c.get('id') or ''
        raw_code = (c.get('customer_code') or '').strip()
        incoming_name = _strip_grade_suffix(c.get('name'))
        first, last = _split_loyverse_name(incoming_name)
        grade, group = _customer_grade(c)
        points = _to_decimal(c.get('total_points'))
        display_name = f'{first} {last}'.strip()

        try:
            existing = existing_by_code.get(code)
            is_new = existing is None
            snapshot = snapshots.get(uuid)
            if len(report['samples']) < 10:
                report['samples'].append({
                    'matricula': code, 'name': display_name,
                    'grade': grade or '—', 'group': group or '—',
                    'points': str(points), 'action': 'crear' if is_new else 'actualizar'})

            if is_new:
                rename = False
                diffs = [('nombre', '', display_name), ('grado', '', grade or 'N/D')]
                if group:
                    diffs.append(('grupo', '', group))
                diffs += [('codigo', '', raw_code), ('vinculo', '', uuid)]
            else:
                diffs, rename = _plan_existing(
                    existing, snapshot, first=first, last=last, incoming_name=incoming_name,
                    grade=grade, group=group, raw_code=raw_code, uuid=uuid)
            for field, before, after in diffs:
                _note_change(report, matricula=code, name=display_name if is_new else
                             existing.user.full_name, field=field, before=before,
                             after=after, action='crear' if is_new else 'actualizar')

            if not commit:
                if is_new:
                    report['created'] += 1
                elif diffs:
                    report['updated'] += 1
                else:
                    report['unchanged'] += 1
                if rename:
                    report['renamed'] += 1
                continue

            with _txn.atomic():
                if existing:
                    profile = existing
                    u = profile.user
                    if rename:
                        old_first, old_last = u.first_name, u.last_name
                        u.first_name, u.last_name = first, last
                        u.save(update_fields=['first_name', 'last_name'])
                        record('update', u,
                               {'first_name': [old_first, first], 'last_name': [old_last, last]},
                               context='import:loyverse')
                        report['renamed'] += 1
                    fields = []
                    if grade and profile.grade != grade:
                        profile.grade, fields = grade, fields + ['grade']
                    if group and profile.group != group:
                        profile.group, fields = group, fields + ['group']
                    if uuid and profile.loyverse_id != uuid:
                        profile.loyverse_id, fields = uuid, fields + ['loyverse_id']
                    if fields:
                        profile.save(update_fields=fields)
                    report['updated' if diffs else 'unchanged'] += 1
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

                if uuid:
                    snapshots[uuid] = _stamp_snapshot(profile, c, snapshot, incoming_name)

                if seed_balances and points > 0:
                    cb, _ = CafeteriaBalance.objects.get_or_create(student=profile)
                    if cb.last_synced is None:      # seed-once (never clobber a topup)
                        cb.balance = points
                        cb.last_synced = cb.seeded_at = timezone.now()
                        cb.save(update_fields=['balance', 'last_synced', 'seeded_at'])
                        report['balance_seeded'] += points
        except Exception as exc:                     # per-row isolation
            report['errors'].append({'matricula': code, 'error': str(exc)[:150]})

    if commit and (report['created'] or report['updated']):
        report['replay'] = replay_unmatched_receipts()
    return report


# ── The daily roster sync, as one function ────────────────────────────────────


def sync_roster(customers, *, commit=False) -> dict:
    """Converge the roster with Loyverse: link → import → replay (→ audit).

    The body of ``manage.py sync_roster``, shared with the console's
    "Sincronizar roster ahora" so the button and the cron cannot drift. Pure
    over ``customers`` except for the full-roster mirror pass on commit, which
    fetches the store once more (it audits stale links and unlinked customers
    and refuses a caller-supplied list as partial).

    On a written run it stamps ``LoyverseSyncState.last_roster_sync_at`` (what
    ``check_sync_fresh`` and the Roster light read) and writes one summary
    audit entry with the counts. Returns ``{commit, link, import, replay,
    audit, stale_links, synced_at, summary}``.
    """
    from apps.accounts.models import StudentProfile
    from apps.cafeteria.models import LoyverseSyncState
    from apps.core.audit import record

    link = link_students_to_loyverse(customers, commit=commit)
    imp = import_students_from_loyverse(customers, commit=commit, seed_balances=True)
    replay = (replay_unmatched_receipts() if commit
              else {'replayed': 0, 'absorbed': 0, 'created': 0, 'pending': None})
    audit = {}
    if commit:
        # The mirror needs the full list to audit; passing ``customers`` would
        # mark it partial, so let it fetch (one call, two pages).
        audit = mirror_pos_topups().get('audit', {})

    stale_links = StudentProfile.objects.filter(
        is_active=True, loyverse_missing_since__isnull=False).count()
    summary = {
        'linked': link['linked'], 'conflicts': link['skipped_conflict'],
        'created': imp['created'], 'updated': imp['updated'], 'unchanged': imp['unchanged'],
        'renamed': imp['renamed'], 'skipped': imp['skipped_non_student'] + imp['skipped_duplicate'],
        'errors': len(imp['errors']), 'replayed': replay['replayed'],
        'absorbed': replay['absorbed'], 'stale_links': stale_links,
        'unmatched_students': len(link['unmatched_students']),
        'possible_leavers': len(link['possible_leavers']),
        'unlinked_customers': audit.get('unlinked_students'),
    }

    synced_at = None
    if commit:
        synced_at = timezone.now()
        state = LoyverseSyncState.load()
        state.last_roster_sync_at = synced_at
        state.save(update_fields=['last_roster_sync_at'])
        record('update', state, {**summary, 'last_roster_sync_at': synced_at.isoformat()},
               context='system:sync_roster')

    return {'commit': commit, 'link': link, 'import': imp, 'replay': replay,
            'audit': audit, 'stale_links': stale_links, 'synced_at': synced_at,
            'summary': summary}


def roster_sync_line(report) -> str:
    """The one log line ops greps for (``sync_roster (written): …``)."""
    s = report['summary']
    mode = 'written' if report['commit'] else 'DRY RUN'
    unlinked = s['unlinked_customers'] if s['unlinked_customers'] is not None else '?'
    return (f'sync_roster ({mode}): {s["linked"]} linked, {s["conflicts"]} conflicts, '
            f'{s["created"]} created, {s["updated"]} refreshed, {s["renamed"]} renamed, '
            f'{s["replayed"]} receipt(s) replayed, {s["absorbed"]} absorbed, '
            f'{s["stale_links"]} stale link(s), {s["possible_leavers"]} without grade code, '
            f'{unlinked} unlinked student-looking customer(s).')
