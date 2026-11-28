"""
cafeteria/hand_loads.py: the same money is never credited twice when a
top-up ends up loaded into Loyverse by hand.

The risk (owner, Caja Part 2, 2026-11-28): a front-desk or office top-up
whose next step is a person typing it into the Loyverse POS (the app's write
failed, the push is off, or an old «Caja Escolar» request) sits in Depósitos
until someone clicks «Aplicar». If the POS mirror (``services.mirror_pos_topups``)
reads Loyverse after the POS load and before that click, it sees a positive
gap and credits it as an anonymous cash recarga (``pos-topup-…``); «Aplicar»
then credits it again. The child gets the money twice and Caja / Ingresos
count it twice.

Three guards, none of which ever writes Loyverse or debits a wallet:

1. The mirror explains a settled positive gap with the ONE waiting hand-load
   top-up of exactly that amount (``match_gap_locked``) instead of crediting
   an anonymous recarga: the ledger row carries the top-up's own reference,
   so Ingresos counts it in its real channel. Two candidates of the same
   amount, or none, keep today's behaviour: never guess.
2. «Aplicar» (single and bulk, office and paid card top-ups) is refused for a
   top-up already found in Loyverse, and stops with ``pos_already_mirrored``
   when an anonymous POS recarga of the same student and amount was recorded
   after the top-up was created (``mirrored_duplicate``): a human decides.
3. «Es esta misma» (``link_mirrored_topup``) turns that anonymous recarga
   into the top-up's own credit: the ledger row is relabelled and the top-up
   closed, without moving any money.

Paid card top-ups (status PAID) were already matched by the mirror
(``services._apply_matched_paid_locked``); guards 2 and 3 cover them too.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)

POS_PREFIX = "pos-topup-"
FOUND_NOTE = "Encontrada en Loyverse: alguien la cargó a mano en el POS."


class HandLoadError(Exception):
    def __init__(self, message: str, *, code: str, status: int = 409):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def cents(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def is_hand_load(topup) -> bool:
    """A pending office/desk top-up whose next step is a person loading it
    into the Loyverse POS (and then «Aplicar»)."""
    from apps.cafeteria import loyverse_push as push
    from apps.cafeteria.models import TopUpRequest

    S = TopUpRequest.PushState
    if (
        topup.method != TopUpRequest.Method.OFFICE
        or topup.status != TopUpRequest.Status.PENDING
        or topup.voided_at is not None
    ):
        return False
    if not topup.desk_method:
        return True  # old «Caja Escolar» request: always by hand
    if topup.loyverse_push_state == S.FAILED:
        return True  # staff were told to load it by hand
    return topup.loyverse_push_state == S.NONE and push.push_mode() == "off"


def hand_load_candidates(student_ids=None):
    """The top-ups ``is_hand_load`` describes, as a queryset (oldest first)."""
    from apps.cafeteria import loyverse_push as push
    from apps.cafeteria.models import TopUpRequest

    S = TopUpRequest.PushState
    waits_for_a_person = Q(desk_method="") | Q(loyverse_push_state=S.FAILED)
    if push.push_mode() == "off":
        waits_for_a_person |= Q(loyverse_push_state=S.NONE)
    qs = TopUpRequest.objects.filter(
        method=TopUpRequest.Method.OFFICE,
        status=TopUpRequest.Status.PENDING,
        voided_at__isnull=True,
        amount__gt=0,
    ).filter(waits_for_a_person)
    if student_ids is not None:
        qs = qs.filter(student_id__in=student_ids)
    return qs.order_by("created_at", "pk")


def candidates_by_student(student_ids=None) -> dict:
    out: dict = {}
    for topup in hand_load_candidates(student_ids):
        out.setdefault(topup.student_id, []).append(topup)
    return out


def reference_for(topup, payment=None) -> str:
    """The ledger reference the top-up's own credit carries (unique)."""
    from apps.cafeteria.models import TopUpRequest

    if topup.method == TopUpRequest.Method.ONLINE:
        from apps.cafeteria.services import _topup_reference

        return _topup_reference(payment)
    return f"topup-desk-{topup.pk}" if topup.desk_method else f"topup-request-{topup.pk}"


def _description(topup) -> str:
    from apps.cafeteria.caja import movement_description

    if topup.desk_method:
        return movement_description(topup)
    return f"Recarga en caja · #{topup.pk}"


def _close_found(topup, now, actor=None):
    """Mark a hand-load top-up completed because its money is in Loyverse."""
    from apps.cafeteria import loyverse_push as push
    from apps.cafeteria.models import TopUpRequest

    topup.status = TopUpRequest.Status.COMPLETED
    topup.processed_at = topup.processed_at or now
    topup.applied_at = now
    topup.applied_by = actor
    topup.applied_via = TopUpRequest.AppliedVia.POS_SYNC
    topup.pos_loaded_at = topup.pos_loaded_at or now
    topup.save(
        update_fields=[
            "status",
            "processed_at",
            "applied_at",
            "applied_by",
            "applied_via",
            "pos_loaded_at",
        ]
    )
    if topup.desk_method:
        push._save_push(topup, TopUpRequest.PushState.PUSHED, FOUND_NOTE, now)


def match_gap_locked(student, cb, candidates, delta, now):
    """Guard 1, called by the mirror under its locks (the candidate rows, then
    ``cb``) for a settled positive gap ``delta``. Credits and returns the one
    candidate of exactly ``delta``; ``None`` (nothing done) otherwise."""
    from apps.cafeteria.models import CafeteriaTransaction
    from apps.core.audit import record

    delta = cents(delta)
    exact = [t for t in candidates if is_hand_load(t) and cents(t.amount) == delta]
    if len(exact) != 1:
        if len(exact) > 1:
            logger.warning(
                "POS gap of $%s for %s matches %d hand-load top-ups: not guessing.",
                delta,
                student,
                len(exact),
            )
        return None
    topup = exact[0]
    reference = reference_for(topup)
    if CafeteriaTransaction.objects.filter(loyverse_receipt_id=reference).exists():
        return None  # already credited: never twice
    cb.balance = (cb.balance or Decimal("0")) + delta
    cb.last_synced = now
    fields = ["balance", "last_synced"]
    if not cb.is_low_balance and cb.last_low_balance_alert_at is not None:
        cb.last_low_balance_alert_at = None
        fields.append("last_low_balance_alert_at")
    cb.save(update_fields=fields)
    CafeteriaTransaction.objects.create(
        student=student,
        transaction_type=CafeteriaTransaction.TxType.TOPUP,
        amount=delta,
        description=_description(topup),
        loyverse_receipt_id=reference,
        balance_after=cb.balance,
        date=now,
    )
    _close_found(topup, now)
    record(
        "update",
        topup,
        {
            "status": ["pending", "completed"],
            "amount": f"{delta:.2f}",
            "applied_via": topup.applied_via,
            "loyverse_gap": f"{delta:.2f}",
            "folio": topup.receipt_folio or None,
        },
        actor=None,
        context="cafeteria.topup.found_in_loyverse",
    )
    transaction.on_commit(lambda pk=topup.pk: notify_found(pk), robust=True)
    return topup


def notify_found(topup_id) -> None:
    """After a match: the family's receipt (desk top-ups, once) and a bell
    notice for the cafetería staff, so nobody loads or applies it again."""
    from apps.cafeteria.models import TopUpRequest

    topup = TopUpRequest.objects.select_related("student__user").filter(pk=topup_id).first()
    if topup is None:
        return
    if topup.desk_method:
        try:
            from apps.cafeteria.caja import notify_receipt

            notify_receipt(topup.pk)
        except Exception:  # noqa: BLE001 - a notice never undoes the credit
            logger.exception("Receipt for found top-up %s failed", topup.pk)
    try:
        from apps.cafeteria.services import cafeteria_staff, format_amount
        from apps.portal.models import Notification
        from apps.portal.services import notify

        name = topup.student.user.full_name
        label = topup.receipt_folio or f"#{topup.pk}"
        title = f"Encontrada en Loyverse: {name}, {format_amount(topup.amount)}"
        message = (
            f"La recarga {label} ya estaba cargada en Loyverse y se acreditó en la app. "
            "No la cargue en el POS ni la aplique otra vez."
        )
        for person in cafeteria_staff():
            notify(
                person, Notification.NotifType.CAFETERIA, title, message, email=False, fanout=False
            )
    except Exception:  # noqa: BLE001
        logger.exception("Staff notice for found top-up %s failed", topup_id)


def mirrored_duplicate(topup, amount=None):
    """Guard 2: an anonymous POS recarga (``pos-topup-…``) of the same student
    and amount, recorded after ``topup`` was created and not reversed, or
    ``None``. Oldest first."""
    from apps.cafeteria.models import BalanceAdjustment, CafeteriaTransaction

    amount = cents(topup.amount if amount is None else amount)
    reversed_ids = BalanceAdjustment.objects.filter(source_transaction__isnull=False).values(
        "source_transaction_id"
    )
    return (
        CafeteriaTransaction.objects.filter(
            student_id=topup.student_id,
            transaction_type=CafeteriaTransaction.TxType.TOPUP,
            loyverse_receipt_id__startswith=POS_PREFIX,
            amount=amount,
            date__gte=topup.created_at,
        )
        .exclude(pk__in=reversed_ids)
        .order_by("date", "pk")
        .first()
    )


def duplicate_details(tx) -> dict:
    when = timezone.localtime(tx.date)
    return {
        "pos_transaction": tx.pk,
        "pos_date": when.isoformat(),
        "pos_amount": f"{cents(tx.amount):.2f}",
    }


def duplicate_message(tx) -> str:
    from apps.cafeteria.services import format_amount

    when = timezone.localtime(tx.date).strftime("%d/%m/%Y %H:%M")
    return (
        f"Loyverse ya registró una recarga de {format_amount(tx.amount)} para este alumno "
        f"el {when}: si es esta misma, no la aplique; use «Es esta misma» para vincularlas."
    )


def found_message() -> str:
    return (
        "Esta recarga ya se encontró en Loyverse y se acreditó: no la aplique ni la "
        "cargue en el POS."
    )


def link_mirrored_topup(topup_id, transaction_id, *, actor):
    """Guard 3, «Es esta misma»: ``transaction_id`` (an anonymous POS recarga)
    IS this top-up. Relabels the ledger row with the top-up's reference and
    closes the top-up; the wallet does not move. Raises ``HandLoadError``."""
    from apps.cafeteria.models import BalanceAdjustment, CafeteriaTransaction, TopUpRequest
    from apps.core.audit import record

    with transaction.atomic():
        topup = (
            TopUpRequest.objects.select_for_update()
            .select_related("student__user")
            .filter(pk=topup_id)
            .first()
        )
        if topup is None:
            raise HandLoadError("Recarga no encontrada.", code="not_found", status=404)
        payment = None
        if topup.method == TopUpRequest.Method.ONLINE:
            from apps.cafeteria.services import _paid_payment

            if topup.status != TopUpRequest.Status.PAID:
                raise HandLoadError(
                    (
                        found_message()
                        if topup.applied_via == TopUpRequest.AppliedVia.POS_SYNC
                        else "Esta recarga ya no está pendiente de aplicar."
                    ),
                    code="not_pending",
                )
            payment = _paid_payment(topup)
            if payment is None:
                raise HandLoadError(
                    "El pago de esta recarga no está aprobado (o fue devuelto).", code="no_payment"
                )
            if payment.needs_bank_verification():
                # Closing it would take it out of «Por verificar»: a forged
                # approval would never be checked.
                raise HandLoadError(
                    "Verifique primero la operación en MultiCobros (Banorte).",
                    code="needs_verification",
                )
            amount = cents(payment.amount)
        else:
            if not is_hand_load(topup):
                raise HandLoadError(
                    (
                        found_message()
                        if topup.applied_via == TopUpRequest.AppliedVia.POS_SYNC
                        else "Esta recarga ya no está pendiente de aplicar."
                    ),
                    code="not_pending",
                )
            amount = cents(topup.amount)
        tx = CafeteriaTransaction.objects.select_for_update().filter(pk=transaction_id).first()
        if (
            tx is None
            or tx.student_id != topup.student_id
            or tx.transaction_type != CafeteriaTransaction.TxType.TOPUP
            or not (tx.loyverse_receipt_id or "").startswith(POS_PREFIX)
            or cents(tx.amount) != amount
            or tx.date < topup.created_at
        ):
            raise HandLoadError(
                "Esa recarga de Loyverse no corresponde a esta recarga.",
                code="mismatch",
                status=400,
            )
        if BalanceAdjustment.objects.filter(source_transaction=tx).exists():
            raise HandLoadError("Esa recarga de Loyverse ya se revirtió.", code="reversed")
        reference = reference_for(topup, payment)
        if CafeteriaTransaction.objects.filter(loyverse_receipt_id=reference).exists():
            raise HandLoadError(found_message(), code="already_credited")
        old_reference = tx.loyverse_receipt_id
        tx.loyverse_receipt_id = reference
        tx.description = (
            payment.description
            if payment is not None and payment.description
            else _description(topup)
        )
        tx.save(update_fields=["loyverse_receipt_id", "description"])
        now = timezone.now()
        if payment is not None:
            topup.payment_ref = topup.payment_ref or payment.gateway_tx_id or str(payment.id)
            topup.save(update_fields=["payment_ref"])
        _close_found(topup, now, actor)
        changes = {
            "status": ["pending" if payment is None else "paid", "completed"],
            "amount": f"{amount:.2f}",
            "applied_via": topup.applied_via,
            "linked_transaction": tx.pk,
            "ledger_reference": [old_reference, reference],
            "folio": topup.receipt_folio or None,
        }
        record("update", topup, changes, actor=actor, context="cafeteria.topup.linked_to_loyverse")
        if topup.desk_method:
            transaction.on_commit(lambda pk=topup.pk: notify_found(pk), robust=True)
    return topup


def pos_mirror_map(rows) -> dict:
    """``{topup_id: duplicate_details}`` for the rows of one console page that
    are still waiting for «Aplicar» (hand-load office/desk, PAID card) and
    have an anonymous POS recarga that may be the same money. One query."""
    from apps.cafeteria.models import BalanceAdjustment, CafeteriaTransaction, TopUpRequest

    waiting = []
    for t in rows:
        if t.method == TopUpRequest.Method.ONLINE and t.status == TopUpRequest.Status.PAID:
            payments = list(t.payments.all())
            amount = payments[0].amount if payments else t.amount
        elif is_hand_load(t):
            amount = t.amount
        else:
            continue
        waiting.append((t, cents(amount)))
    if not waiting:
        return {}
    reversed_ids = BalanceAdjustment.objects.filter(source_transaction__isnull=False).values(
        "source_transaction_id"
    )
    txs = list(
        CafeteriaTransaction.objects.filter(
            student_id__in={t.student_id for t, _ in waiting},
            transaction_type=CafeteriaTransaction.TxType.TOPUP,
            loyverse_receipt_id__startswith=POS_PREFIX,
            date__gte=min(t.created_at for t, _ in waiting),
        )
        .exclude(pk__in=reversed_ids)
        .order_by("date", "pk")
        .only("pk", "student_id", "amount", "date")
    )
    out = {}
    for t, amount in waiting:
        for tx in txs:
            if (
                tx.student_id == t.student_id
                and cents(tx.amount) == amount
                and tx.date >= t.created_at
            ):
                out[t.pk] = duplicate_details(tx)
                break
    return out
