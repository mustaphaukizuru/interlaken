"""
cafeteria/ingresos.py: «Ingresos de cafetería», money that came in, by channel.

Owner 2026-11-27 (Part 2 of «Caja»): daily and monthly totals of how wallet
money arrived. One school day = America/Mexico_City. Channels and their source
of truth (each top-up is counted ONCE, from the record that owns it):

- ``portal`` «Portal (tarjeta en línea)»: ``TopUpRequest`` method ``online``,
  status ``completed``, real money only (a refunded payment or a Payworks
  simulation is left out), dated when the payment was confirmed
  (``processed_at``, else ``applied_at``, else ``created_at``).
- ``desk_cash`` / ``desk_card`` / ``desk_link`` «Recepción»: desk top-ups
  (``caja.desk_topups``) not voided, dated when the money was received
  (``created_at``). A top-up still waiting for Loyverse counts (the money is in
  the drawer) and is reported apart as «pendiente de cargar». The old office
  top-ups («Caja Escolar», ``method=office`` without ``desk_method``, cash at
  the school office) count as cash, dated when applied.
- ``pos`` «Caja de cafetería (POS)»: money the cashier loaded at the Loyverse
  till. The POS mirror records it as a wallet ``topup`` movement whose ledger
  reference is ``pos-topup-<student>-<timestamp>`` (``services.mirror_pos_topups``).
  The app's own loads use other references (``topup-payment-<id>`` portal,
  ``topup-desk-<id>`` desk, ``topup-request-<id>`` office) and write Loyverse
  and the wallet together, so the mirror never sees them as a gap: counting
  only ``pos-topup-`` rows can never count an app load twice. A ``pos-topup``
  later reversed as a duplicate (a ``BalanceAdjustment`` pointing at it, the
  rule ``services`` already uses) is left out. Production, 30 days to
  2026-11-27: 177 ``pos-topup`` rows ($26,731) and 22 ``topup-payment`` rows
  ($2,414); no other reference on top-up movements.

Card and link desk top-ups not yet matched in MultiCobros are counted and
reported as «por verificar».
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.db.models.functions import Coalesce

from apps.core.listing import day_end_exclusive, day_start

from .caja import cents, desk_topups
from .corte import local_day
from .models import BalanceAdjustment, CafeteriaTransaction, TopUpRequest

CHANNELS = [
    ("portal", "Portal (tarjeta en línea)"),
    ("desk_cash", "Recepción · efectivo"),
    ("desk_card", "Recepción · tarjeta"),
    ("desk_link", "Recepción · liga de pago"),
    ("pos", "Caja de cafetería (POS)"),
]
CHANNEL_KEYS = [k for k, _ in CHANNELS]
POS_PREFIX = "pos-topup-"
MAX_DAYS = 366
ZERO = Decimal("0.00")


def _empty_day(d: date) -> dict:
    row = {"day": d, **{k: ZERO for k in CHANNEL_KEYS}}
    row.update({"total": ZERO, "count": 0, "pending_load": ZERO, "to_verify": ZERO})
    return row


def portal_topups(lo, hi):
    from apps.payments.models import Payment
    from apps.payments.multicobros import simulated_topup_ids

    return (
        TopUpRequest.objects.filter(
            method=TopUpRequest.Method.ONLINE, status=TopUpRequest.Status.COMPLETED
        )
        .exclude(payments__status=Payment.Status.REFUNDED)
        .exclude(pk__in=simulated_topup_ids())
        .annotate(paid_at=Coalesce("processed_at", "applied_at", "created_at"))
        .filter(paid_at__gte=lo, paid_at__lt=hi)
        .distinct()
    )


def desk_rows(lo, hi):
    return desk_topups().filter(voided_at__isnull=True, created_at__gte=lo, created_at__lt=hi)


def legacy_office_rows(lo, hi):
    return (
        TopUpRequest.objects.filter(
            method=TopUpRequest.Method.OFFICE, desk_method="", status=TopUpRequest.Status.COMPLETED
        )
        .annotate(paid_at=Coalesce("applied_at", "processed_at", "created_at"))
        .filter(paid_at__gte=lo, paid_at__lt=hi)
    )


def pos_rows(lo, hi):
    reversed_ids = BalanceAdjustment.objects.filter(source_transaction__isnull=False).values(
        "source_transaction_id"
    )
    return CafeteriaTransaction.objects.filter(
        transaction_type=CafeteriaTransaction.TxType.TOPUP,
        loyverse_receipt_id__startswith=POS_PREFIX,
        date__gte=lo,
        date__lt=hi,
    ).exclude(pk__in=reversed_ids)


def report(start: date, end: date) -> dict:
    """Per-day rows (every day of the range, zeros included) and the totals."""
    if end < start:
        start, end = end, start
    if (end - start).days + 1 > MAX_DAYS:
        end = start + timedelta(days=MAX_DAYS - 1)
    lo, hi = day_start(start), day_end_exclusive(end)
    days = {
        start + timedelta(days=i): _empty_day(start + timedelta(days=i))
        for i in range((end - start).days + 1)
    }

    def add(when, channel, amount):
        row = days.get(local_day(when))
        if row is None:  # a timestamp on the edge of the range
            return
        amount = cents(amount)
        row[channel] += amount
        row["total"] += amount
        row["count"] += 1
        return row

    for paid_at, amount in portal_topups(lo, hi).values_list("paid_at", "amount"):
        add(paid_at, "portal", amount)
    for t in desk_rows(lo, hi).only(
        "created_at", "amount", "desk_method", "status", "desk_verified_at", "voided_at"
    ):
        row = add(t.created_at, f"desk_{t.desk_method}", t.amount)
        if row is None:
            continue
        if t.status != TopUpRequest.Status.COMPLETED:
            row["pending_load"] += cents(t.amount)
        if t.desk_needs_verification:
            row["to_verify"] += cents(t.amount)
    for paid_at, amount in legacy_office_rows(lo, hi).values_list("paid_at", "amount"):
        add(paid_at, "desk_cash", amount)
    for when, amount in pos_rows(lo, hi).values_list("date", "amount"):
        add(when, "pos", amount)

    rows = [days[d] for d in sorted(days)]
    totals = {
        k: sum((r[k] for r in rows), ZERO)
        for k in (*CHANNEL_KEYS, "total", "pending_load", "to_verify")
    }
    totals["count"] = sum(r["count"] for r in rows)
    return {"start": start, "end": end, "rows": rows, "totals": totals}


def serialize(rep: dict) -> dict:
    def money(row):
        return {k: (f"{v:.2f}" if isinstance(v, Decimal) else v) for k, v in row.items()}

    return {
        "start": rep["start"].isoformat(),
        "end": rep["end"].isoformat(),
        "channels": [{"key": k, "label": label} for k, label in CHANNELS],
        "rows": [{**money(r), "day": r["day"].isoformat()} for r in rep["rows"]],
        "totals": money(rep["totals"]),
    }
