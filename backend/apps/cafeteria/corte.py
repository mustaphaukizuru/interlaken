"""
cafeteria/corte.py: «Corte de caja», one person's front-desk money for one day.

Owner 2026-11-27, Part 2 of «Caja». Whoever took money at the front desk
(``TopUpRequest.received_by``) counts it at the end of the school day
(America/Mexico_City) and closes the day:

- **Expected** is every desk top-up that person recorded that day and did not
  void, by method (cash / card / link). It includes top-ups still waiting for
  Loyverse (``status=pending``): the money is already in the drawer even if the
  balance is not on the card yet, so leaving it out would invent a shortage.
  Those are listed apart so the desk sees they still have to load.
- **Voids** of the day are listed with their reason; voided top-ups never
  count (the money went back or was never taken).
- **Likely duplicates**: the same child and amount within 10 minutes
  (``caja.DUPLICATE_WINDOW``), a second look before closing.

Closing stores a snapshot (``DeskCashClose``) with the counted amounts. While
the day is closed, Caja refuses to void its top-ups and to record new ones for
that person that day; an administrator reopens it with a reason. Everything is
audited.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.listing import MEXICO_CITY, day_end_exclusive, day_start

from .caja import DUPLICATE_WINDOW, CajaError, cents, desk_topups, method_label
from .models import DeskCashClose, TopUpRequest

METHODS = ("cash", "card", "link")
ZERO = Decimal("0.00")


def local_day(dt) -> date:
    return timezone.localtime(dt, MEXICO_CITY).date()


def today() -> date:
    return timezone.localtime(timezone.now(), MEXICO_CITY).date()


def day_rows(user_id, day: date):
    """That person's desk top-ups of that school day, oldest first."""
    return (
        desk_topups()
        .filter(
            received_by_id=user_id,
            created_at__gte=day_start(day),
            created_at__lt=day_end_exclusive(day),
        )
        .select_related("student__user", "received_by", "voided_by")
        .order_by("created_at", "pk")
    )


def expected_totals(rows) -> tuple[dict, int]:
    """``({cash, card, link}, count)`` of the top-ups that still count."""
    totals = {m: ZERO for m in METHODS}
    count = 0
    for t in rows:
        if t.voided_at is None and t.desk_method in totals:
            totals[t.desk_method] += cents(t.amount)
            count += 1
    return totals, count


def likely_duplicates(rows) -> list[dict]:
    """Pairs of top-ups for the same child and amount within the window."""
    live = [t for t in rows if t.voided_at is None]
    out = []
    for i, a in enumerate(live):
        for b in live[i + 1 :]:
            if (
                a.student_id == b.student_id
                and cents(a.amount) == cents(b.amount)
                and abs(b.created_at - a.created_at) <= DUPLICATE_WINDOW
            ):
                out.append(
                    {
                        "first": a.receipt_folio,
                        "second": b.receipt_folio,
                        "student": a.student.user.full_name,
                        "amount": f"{cents(a.amount):.2f}",
                    }
                )
    return out


def is_day_closed(user_id, day: date) -> bool:
    if not user_id:
        return False
    return DeskCashClose.objects.filter(user_id=user_id, day=day, closed_at__isnull=False).exists()


def assert_day_open(user_id, day: date) -> None:
    """Caja's guard for voids and new top-ups of a closed day."""
    if is_day_closed(user_id, day):
        raise CajaError(
            "El corte de ese día ya se cerró: pida a un administrador reabrirlo.",
            code="corte_closed",
            status=409,
        )


def _money(value):
    return None if value is None else f"{cents(value):.2f}"


def _row(t: TopUpRequest) -> dict:
    return {
        "id": t.pk,
        "folio": t.receipt_folio,
        "time": timezone.localtime(t.created_at, MEXICO_CITY).strftime("%H:%M"),
        "student": t.student.user.full_name,
        "amount": f"{cents(t.amount):.2f}",
        "desk_method": t.desk_method,
        "desk_method_label": method_label(t.desk_method),
        "reference": t.reference,
        "loaded": t.status == TopUpRequest.Status.COMPLETED,
        "voided": t.voided_at is not None,
        "void_reason": t.void_reason,
        "voided_by": t.voided_by.full_name if t.voided_by_id else "",
        "needs_verification": t.desk_needs_verification,
    }


def close_payload(close: DeskCashClose | None) -> dict | None:
    if close is None:
        return None
    diff = {}
    for m in METHODS:
        counted = getattr(close, f"counted_{m}")
        expected = getattr(close, f"expected_{m}")
        diff[m] = None if counted is None else _money(cents(counted) - cents(expected))
    return {
        "id": close.pk,
        "closed": close.is_closed,
        "closed_at": close.closed_at.isoformat() if close.closed_at else None,
        "closed_by": close.closed_by.full_name if close.closed_by_id else "",
        "expected": {m: _money(getattr(close, f"expected_{m}")) for m in METHODS},
        "counted": {m: _money(getattr(close, f"counted_{m}")) for m in METHODS},
        "difference": diff,
        "topups_count": close.topups_count,
        "note": close.note,
        "reopened_at": close.reopened_at.isoformat() if close.reopened_at else None,
        "reopened_by": close.reopened_by.full_name if close.reopened_by_id else "",
        "reopen_reason": close.reopen_reason,
    }


def summary(user, day: date) -> dict:
    """Everything the «Corte de caja» screen shows for ``user`` on ``day``."""
    rows = list(day_rows(user.pk, day))
    totals, count = expected_totals(rows)
    close = (
        DeskCashClose.objects.select_related("closed_by", "reopened_by")
        .filter(user=user, day=day)
        .first()
    )
    pending = [t for t in rows if t.voided_at is None and t.status != TopUpRequest.Status.COMPLETED]
    return {
        "day": day.isoformat(),
        "user": {"id": user.pk, "name": user.full_name},
        "expected": {m: _money(totals[m]) for m in METHODS},
        "expected_total": _money(sum(totals.values(), ZERO)),
        "count": count,
        "pending_load": {
            "count": len(pending),
            "amount": _money(sum((cents(t.amount) for t in pending), ZERO)),
        },
        "topups": [_row(t) for t in rows if t.voided_at is None],
        "voids": [_row(t) for t in rows if t.voided_at is not None],
        "duplicates": likely_duplicates(rows),
        "close": close_payload(close),
        "is_today": day == today(),
    }


def people_for_day(day: date):
    """Who took desk money on ``day`` or has a corte row for it (admins' list)."""
    from apps.accounts.models import User

    ids = set(
        desk_topups()
        .filter(created_at__gte=day_start(day), created_at__lt=day_end_exclusive(day))
        .exclude(received_by__isnull=True)
        .values_list("received_by_id", flat=True)
    )
    ids |= set(DeskCashClose.objects.filter(day=day).values_list("user_id", flat=True))
    return list(User.objects.filter(pk__in=ids).order_by("first_name", "last_name"))


def parse_amount(value, *, field: str, required: bool) -> Decimal | None:
    if value in (None, ""):
        if required:
            raise CajaError("Escriba el efectivo que contó.", code=field)
        return None
    try:
        amount = Decimal(str(value).strip().replace("$", "").replace(",", ""))
    except (InvalidOperation, ValueError):
        raise CajaError("Escriba una cantidad válida.", code=field) from None
    if not amount.is_finite() or amount < 0 or amount > Decimal("1000000"):
        raise CajaError("Escriba una cantidad válida.", code=field)
    return cents(amount)


def close_day(
    *, user, day: date, counted_cash, counted_card=None, counted_link=None, note="", actor
) -> DeskCashClose:
    """Close ``user``'s corte for ``day``: snapshot the expected totals with the
    counted amounts. Refuses a future day and a day already closed."""
    from apps.core.audit import record

    if day > today():
        raise CajaError("No se puede cerrar el corte de un día que aún no llega.", code="future")
    cash = parse_amount(counted_cash, field="counted_cash", required=True)
    card = parse_amount(counted_card, field="counted_card", required=False)
    link = parse_amount(counted_link, field="counted_link", required=False)
    note = str(note or "").strip()[:1000]
    with transaction.atomic():
        # The day's rows are locked so a void cannot slip in between the
        # snapshot and the close (voids lock the same rows).
        rows = list(day_rows(user.pk, day).select_for_update(of=("self",)))
        try:
            close, _created = DeskCashClose.objects.select_for_update().get_or_create(
                user=user, day=day
            )
        except IntegrityError:
            close = DeskCashClose.objects.select_for_update().get(user=user, day=day)
        if close.is_closed:
            raise CajaError(
                "El corte de ese día ya está cerrado.", code="already_closed", status=409
            )
        totals, count = expected_totals(rows)
        close.expected_cash = totals["cash"]
        close.expected_card = totals["card"]
        close.expected_link = totals["link"]
        close.counted_cash, close.counted_card, close.counted_link = cash, card, link
        close.topups_count = count
        close.note = note
        close.closed_at = timezone.now()
        close.closed_by = actor
        close.save()
        payload = close_payload(close)
        record(
            "update",
            close,
            {
                "closed": True,
                "day": day.isoformat(),
                "expected": payload["expected"],
                "counted": payload["counted"],
                "difference": payload["difference"],
                "count": count,
                "note": note,
            },
            actor=actor,
            context="cafeteria.caja.corte",
        )
    return close


def reopen_day(close_id, *, reason, actor) -> DeskCashClose:
    """An administrator reopens a closed corte (the counted figures stay as history)."""
    from apps.core.audit import record

    reason = str(reason or "").strip()[:255]
    if not reason:
        raise CajaError("Escriba el motivo para reabrir el corte.", code="reason")
    with transaction.atomic():
        close = DeskCashClose.objects.select_for_update().filter(pk=close_id).first()
        if close is None:
            raise CajaError("Corte no encontrado.", code="not_found", status=404)
        if not close.is_closed:
            raise CajaError("Ese corte no está cerrado.", code="not_closed", status=409)
        before = close.closed_at
        close.closed_at = None
        close.reopened_at = timezone.now()
        close.reopened_by = actor
        close.reopen_reason = reason
        close.save(update_fields=["closed_at", "reopened_at", "reopened_by", "reopen_reason"])
        record(
            "update",
            close,
            {
                "reopened": True,
                "reason": reason,
                "was_closed_at": before.isoformat() if before else None,
            },
            actor=actor,
            context="cafeteria.caja.corte",
        )
    return close
