"""
payments/settlement.py — turn a normalised ``PaymentEvent`` into money movement.

One locked, idempotent transaction per event:

- ``success`` marks the payment successful and, for a cafetería top-up, credits
  the student's **local** ledger (spec R1: never a Loyverse write) and notifies
  the family after commit.
- ``failed`` credits nothing. A failure with a ``stage`` is *soft* (expired,
  superseded, cancelled, bank timeout) and a later ``success`` may still
  override it; a bank decline is final.
- ``refunded`` on a successful payment reverses the credit.
- ``pending`` only records the provider payload.

Replays are no-ops: a final payment never moves money again (except success →
refunded). Callers: the Banorte result endpoint and the dev-only sandbox page.
"""

import logging

from django.db import transaction as db_transaction

from apps.core.exceptions import error_body

from .models import Payment

logger = logging.getLogger(__name__)


def _raw_with_stage(event) -> dict:
    raw = dict(event.raw or {})
    if event.stage:
        raw["stage"] = event.stage
    return raw


def apply_event(event):
    """Apply ``event`` under a row lock.

    Returns ``(http_status, body, notify_arg)``; ``notify_arg`` is
    ``(payment, success)`` when the family should be notified after commit.
    """
    from apps.cafeteria.services import (
        complete_online_topup,
        fail_online_topup,
        reverse_online_topup,
    )

    notify_arg = None
    with db_transaction.atomic():
        try:
            payment = Payment.objects.select_for_update().get(pk=event.payment_id)
        except (Payment.DoesNotExist, TypeError, ValueError):
            return 404, error_body("Pago no encontrado.", code="payment_not_found"), None

        # Refunded is fully closed; a bank-declined FAILED is closed too. A
        # soft-FAILED payment still accepts a late SUCCESS so a parent who paid
        # after a local expiry/supersede/cancel is credited.
        if payment.status == Payment.Status.REFUNDED:
            return 200, {"detail": "already_processed"}, None
        if payment.status == Payment.Status.FAILED:
            if not (event.status == "success" and payment.is_soft_failed()):
                return 200, {"detail": "already_processed"}, None

        # Successful capture: only a later refund/chargeback may move money again.
        if payment.status == Payment.Status.SUCCESS:
            if event.status != "refunded":
                return 200, {"detail": "already_processed"}, None
            payment.gateway_raw = event.raw or payment.gateway_raw
            if event.transaction_id:
                payment.gateway_tx_id = event.transaction_id
            payment.status = Payment.Status.REFUNDED
            payment.save(update_fields=["status", "gateway_tx_id", "gateway_raw", "updated_at"])
            reverse_online_topup(payment)
            return 200, {"detail": "refunded"}, None

        if event.reference:
            payment.gateway_ref = event.reference[:255]

        if event.status == "success":
            # mark_success does a full save, so gateway_ref set above persists.
            payment.mark_success(event.transaction_id or payment.gateway_tx_id, event.raw)
            complete_online_topup(payment)  # None for non-cafeteria payments
            notify_arg = (payment, True)
        elif event.status == "failed":
            payment.status = Payment.Status.FAILED
            if event.transaction_id:
                payment.gateway_tx_id = event.transaction_id
            payment.gateway_raw = _raw_with_stage(event)
            payment.save(
                update_fields=[
                    "status",
                    "gateway_tx_id",
                    "gateway_ref",
                    "gateway_raw",
                    "updated_at",
                ]
            )
            fail_online_topup(payment)
            # A cancel or a checkout that never authenticated charged nothing and
            # the parent is looking at the screen: no email for those.
            if event.stage not in ("cancel", "create_checkout"):
                notify_arg = (payment, False)
        elif event.status == "refunded":
            # Refund before capture is unusual — mark refunded, reverse no-ops.
            payment.status = Payment.Status.REFUNDED
            if event.transaction_id:
                payment.gateway_tx_id = event.transaction_id
            payment.gateway_raw = event.raw
            payment.save(
                update_fields=[
                    "status",
                    "gateway_tx_id",
                    "gateway_ref",
                    "gateway_raw",
                    "updated_at",
                ]
            )
            reverse_online_topup(payment)
        else:
            # Non-terminal: record the payload only.
            payment.gateway_raw = event.raw
            if event.transaction_id:
                payment.gateway_tx_id = event.transaction_id
            payment.save(
                update_fields=["gateway_tx_id", "gateway_ref", "gateway_raw", "updated_at"]
            )

    return 200, {"detail": "ok"}, notify_arg


def notify_result(notify_arg) -> None:
    """Best-effort family notification; call after the transaction committed."""
    if notify_arg is None:
        return
    payment, success = notify_arg
    if payment.payment_type == Payment.Type.CAFETERIA:
        from apps.cafeteria.services import notify_topup_result

        notify_topup_result(payment, success=success)


def settle(event, *, actor_label: str):
    """``apply_event`` + notification, with audit records attributed to ``actor_label``."""
    from apps.core.audit import audit_context

    with audit_context(actor_label=actor_label):
        http_status, body, notify_arg = apply_event(event)
    notify_result(notify_arg)
    return http_status, body
