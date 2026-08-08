"""
payments/services.py — checkout reuse + stale PENDING expiry.

Concurrent initiate calls (double-tab, retry) must not open a second HPP
session that can double-charge. Fresh open checkouts are reused; stale ones
are failed before a replacement is created.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from .models import Payment

logger = logging.getLogger(__name__)

# Default window for considering an open HPP session still usable.
DEFAULT_OPEN_CHECKOUT_MINUTES = 45


def open_checkout_ttl_minutes() -> int:
    return int(getattr(
        settings, 'OPEN_CHECKOUT_TTL_MINUTES', DEFAULT_OPEN_CHECKOUT_MINUTES))


def _fresh_cutoff(minutes: int | None = None):
    return timezone.now() - timedelta(minutes=minutes or open_checkout_ttl_minutes())


def _open_pending_qs():
    """PENDING payments that never advanced past checkout (no gateway tx id)."""
    return Payment.objects.filter(status=Payment.Status.PENDING).filter(
        Q(gateway_tx_id__isnull=True) | Q(gateway_tx_id=''),
    )


def reuse_or_clear_invoice_checkout(invoice) -> Payment | None:
    """Return a fresh open tuition checkout for ``invoice``, or clear stale ones.

    Caller must hold a row lock on ``invoice`` (``select_for_update``). When a
    fresh PENDING payment linked via ``InvoicePayment`` exists, it is returned
    for reuse. Stale open checkouts are marked failed and ``None`` is returned
    so the caller can create a replacement.
    """
    link = (
        invoice.invoice_payments
        .select_related('payment')
        .filter(payment__status=Payment.Status.PENDING)
        .filter(Q(payment__gateway_tx_id__isnull=True) | Q(payment__gateway_tx_id=''))
        .order_by('-payment__created_at')
        .first()
    )
    if link is None:
        return None

    payment = link.payment
    if payment.created_at >= _fresh_cutoff():
        return payment

    payment.mark_failed('checkout superseded — stale open session', stage='supersede')
    _cascade_fail_linked_topup(payment)
    logger.info(
        'Superseded stale tuition checkout payment=%s invoice=%s',
        payment.id, invoice.id,
    )
    return None


def reuse_or_clear_cafeteria_checkout(
    student, *, amount: Decimal, gateway_name: str,
) -> Payment | None:
    """Return a matching fresh cafeteria checkout, or clear incompatible/stale ones.

    Match requires same student, amount, and gateway. A mismatched or stale
    open checkout is failed so a new TopUpRequest + Payment can be created.
    """
    open_payments = list(
        _open_pending_qs()
        .filter(
            payment_type=Payment.Type.CAFETERIA,
            related_topup__student=student,
            related_topup__isnull=False,
        )
        .select_related('related_topup')
        .order_by('-created_at')
    )
    if not open_payments:
        return None

    cutoff = _fresh_cutoff()
    amount = Decimal(amount)
    reusable = None
    for payment in open_payments:
        same = (
            payment.amount == amount
            and payment.gateway == gateway_name
            and payment.created_at >= cutoff
        )
        if same and reusable is None:
            reusable = payment
        else:
            reason = (
                'checkout superseded — amount/gateway change'
                if payment.amount != amount or payment.gateway != gateway_name
                else 'checkout superseded — stale open session'
            )
            payment.mark_failed(reason, stage='supersede')
            _cascade_fail_linked_topup(payment)
            logger.info(
                'Superseded cafeteria checkout payment=%s student=%s (%s)',
                payment.id, student.id, reason,
            )
    return reusable


def _cascade_fail_linked_topup(payment: Payment) -> None:
    """Mark a linked cafeteria TopUpRequest failed when its Payment soft-fails."""
    if payment.related_topup_id is None:
        return
    from apps.cafeteria.services import fail_online_topup

    fail_online_topup(payment)


def expire_stale_checkouts(*, older_than_minutes: int | None = None) -> int:
    """Mark stale open PENDING payments as FAILED. Returns count updated."""
    minutes = older_than_minutes if older_than_minutes is not None else open_checkout_ttl_minutes()
    cutoff = timezone.now() - timedelta(minutes=minutes)
    qs = _open_pending_qs().filter(created_at__lt=cutoff)
    count = 0
    for payment in qs.iterator():
        payment.mark_failed(
            f'checkout expired after {minutes}m without capture',
            stage='expire',
        )
        _cascade_fail_linked_topup(payment)
        count += 1
    if count:
        logger.info('expire_stale_checkouts: marked %s payments FAILED', count)
    return count
