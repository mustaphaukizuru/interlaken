"""
cafeteria/caja.py: money taken at the front desk («Caja», owner 2026-11-27).

Parents still pay at the school's front desk in cash, on the card terminal or
through a payment link. Before this, that money reached the wallet only when
somebody typed it into the Loyverse POS, and nothing recorded how it was paid
($31,129 in 30 days arrived that way with no method). A desk top-up is a
``TopUpRequest`` with ``method=office`` and ``desk_method`` set, recorded here
by a console user holding the «Caja» area (or an admin).

Loyverse FIRST, then the app (the school's rule: the till is where the child
spends): under the top-up row lock and the wallet lock, the app reads the
card, requires Loyverse == wallet to the cent, writes the new ABSOLUTE
balance, re-reads it and credits the wallet only when the re-read shows
exactly that figure (``loyverse_push.write_points_locked``, the path card
top-ups have used since 2026-11-21). Anything else leaves the wallet alone:
``waiting`` (a sale in flight, Loyverse slow or unreachable) is retried by the
5-minute cron; ``failed`` (the write was not confirmed) goes to the staff,
who check Loyverse before applying it by hand in Depósitos. A void takes the
money back the same way. The front desk never types these into the POS: that
would put the money on the card twice.

Not here (on purpose): ``PAYMENTS_LIVE`` and the bank checks of card
payments. A desk top-up is money received in person; the only switch is
``CAFETERIA_TOPUP_LOYVERSE_PUSH`` (``off``: nothing is written and the top-up
waits in Depósitos as an office top-up, the old flow).
"""

from __future__ import annotations

import logging
import time
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import StudentProfile
from apps.cafeteria import loyverse_push as push
from apps.cafeteria.models import (
    BalanceAdjustment,
    CafeteriaBalance,
    CafeteriaTransaction,
    TopUpRequest,
)

logger = logging.getLogger(__name__)

CENT = Decimal("0.01")
# Same child and amount at the desk within this window: probably the same
# payment typed twice. The desk confirms it before a second one is recorded.
DUPLICATE_WINDOW = timedelta(minutes=10)
DESK = TopUpRequest.DeskMethod
NEEDS_REFERENCE = (DESK.CARD, DESK.LINK)


class CajaError(Exception):
    """A refusal the console shows as it is (Spanish ``message``)."""

    def __init__(self, message: str, *, code: str = "invalid", status: int = 400, **extra):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.extra = extra


def cents(value) -> Decimal:
    try:
        return Decimal(str(value)).quantize(CENT)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def method_label(desk_method: str) -> str:
    return dict(DESK.choices).get(desk_method, "Recepción")


def movement_description(topup) -> str:
    """What the family reads in its history: «Recarga en recepción, efectivo · Folio R-000123»."""
    how = {DESK.CASH: "efectivo", DESK.CARD: "tarjeta", DESK.LINK: "liga de pago"}.get(
        topup.desk_method, ""
    )
    base = f"Recarga en recepción, {how}" if how else "Recarga en recepción"
    return f"{base} · Folio {topup.receipt_folio}" if topup.receipt_folio else base


def folio_for(pk: int) -> str:
    return f"R-{pk:06d}"


def desk_topups():
    return TopUpRequest.objects.filter(method=TopUpRequest.Method.OFFICE).exclude(desk_method="")


# ── lookup ───────────────────────────────────────────────────────────────────


def lookup(code: str):
    """Active cafetería accounts matching what the desk scanned or typed.

    The credential's barcode carries the Loyverse customer code (``ci09932``,
    ``jperez``) or, unlinked, the matrícula; the desk may also type the
    matrícula (``09932``). Never a name search: two children can share a
    name, and the wrong card would get the money.
    """
    from apps.accounts.people import ALUMNO, normalize_code

    raw = str(code or "").strip()
    if len(raw) < 2:
        return StudentProfile.objects.none()
    q = Q(loyverse_profile__customer_code__iexact=raw) | Q(student_id__iexact=raw)
    pupil_key = normalize_code(raw, ALUMNO)
    if pupil_key and pupil_key.lower() != raw.lower():
        q |= Q(tipo=ALUMNO, student_id__iexact=pupil_key)
    return (
        StudentProfile.objects.filter(q, is_active=True)
        .select_related("user", "loyverse_profile", "cafeteria_balance")
        .order_by("user__last_name", "user__first_name", "pk")
        .distinct()[:10]
    )


# ── create ───────────────────────────────────────────────────────────────────


def _validate(student, amount, desk_method, reference):
    from apps.cafeteria.schedule import format_amount
    from apps.cafeteria.serializers import TOPUP_MIN_AMOUNT, topup_max_amount

    if student is None or not student.is_active:
        raise CajaError("La cuenta no existe o ya no está activa.", code="student_inactive")
    if not (student.loyverse_id or "").strip():
        raise CajaError(
            "Esta cuenta aún no está vinculada a Loyverse: vincúlela en Cafetería antes de "
            "recargar.",
            code="not_linked",
        )
    if desk_method not in DESK.values:
        raise CajaError(
            "Elija la forma de pago: efectivo, tarjeta o liga de pago.", code="desk_method"
        )
    if amount is None or amount < TOPUP_MIN_AMOUNT:
        raise CajaError(f"El monto mínimo es {format_amount(TOPUP_MIN_AMOUNT)}.", code="amount")
    maximum = topup_max_amount()
    if amount > maximum:
        raise CajaError(
            f"El máximo por recarga es {format_amount(maximum)} por alumno.", code="amount_max"
        )
    if desk_method in NEEDS_REFERENCE and not reference:
        what = (
            "el número de autorización de la terminal"
            if desk_method == DESK.CARD
            else "el folio de la liga de pago"
        )
        raise CajaError(f"Escriba {what}.", code="reference")


def create_desk_topup(
    *,
    student_id,
    amount,
    desk_method,
    reference="",
    note="",
    idempotency_key="",
    confirm_duplicate=False,
    actor,
):
    """Record money received at the desk and load it (Loyverse first).

    Returns ``(topup, outcome, created)``; ``outcome`` is the push result
    (``pushed`` / ``waiting`` / ``failed`` / ``skipped``). A repeated
    ``idempotency_key`` returns the first top-up untouched (``created`` False).
    Raises ``CajaError``.
    """
    key = str(idempotency_key or "").strip()[:64]
    if key:
        existing = desk_topups().filter(idempotency_key=key).first()
        if existing is not None:
            return existing, outcome_of(existing), False
    student = (
        StudentProfile.objects.select_related("user", "cafeteria_balance")
        .filter(pk=student_id)
        .first()
    )
    amount = cents(amount) if amount not in (None, "") else None
    reference = str(reference or "").strip()[:80]
    _validate(student, amount, desk_method, reference)

    if not confirm_duplicate:
        earlier = (
            desk_topups()
            .filter(
                student=student,
                amount=amount,
                voided_at__isnull=True,
                created_at__gte=timezone.now() - DUPLICATE_WINDOW,
            )
            .order_by("-created_at")
            .first()
        )
        if earlier is not None:
            raise CajaError(
                f"Hace unos minutos se registró una recarga igual para {student.user.full_name} "
                f"(folio {earlier.receipt_folio}). ¿Es otra recarga?",
                code="possible_duplicate",
                status=409,
                folio=earlier.receipt_folio,
                created_at=earlier.created_at.isoformat(),
            )

    try:
        with transaction.atomic():
            topup = TopUpRequest.objects.create(
                student=student,
                amount=amount,
                method=TopUpRequest.Method.OFFICE,
                status=TopUpRequest.Status.PENDING,
                desk_method=desk_method,
                reference=reference,
                notes=str(note or "").strip()[:500],
                received_by=actor,
                idempotency_key=key or None,
            )
            topup.receipt_folio = folio_for(topup.pk)
            topup.save(update_fields=["receipt_folio"])
            _audit(
                "create",
                topup,
                actor,
                {
                    "via": "caja",
                    "amount": f"{amount:.2f}",
                    "desk_method": desk_method,
                    "reference": reference,
                    "folio": topup.receipt_folio,
                },
            )
    except IntegrityError:
        # The same submission raced itself (two clicks, two workers).
        existing = desk_topups().filter(idempotency_key=key).first() if key else None
        if existing is None:
            raise
        return existing, outcome_of(existing), False

    outcome = push_desk_topup(topup, actor=actor)
    topup.refresh_from_db()
    return topup, outcome, True


def outcome_of(topup) -> dict:
    """The outcome of a desk top-up already recorded (idempotent replies, lists)."""
    S = TopUpRequest.PushState
    if topup.status == TopUpRequest.Status.COMPLETED:
        state = "pushed" if topup.applied_via == TopUpRequest.AppliedVia.AUTO_POS else "applied"
    elif topup.loyverse_push_state == S.WAITING:
        state = "waiting"
    elif topup.loyverse_push_state == S.FAILED:
        state = "failed"
    else:
        state = "skipped"
    balance = getattr(getattr(topup.student, "cafeteria_balance", None), "balance", None)
    return {
        "state": state,
        "reason": topup.loyverse_push_note,
        "balance": None if balance is None else f"{cents(balance):.2f}",
    }


# ── the Loyverse-first load ──────────────────────────────────────────────────


def push_desk_topup(topup, *, actor=None) -> dict:
    """Write one desk top-up into Loyverse and credit the wallet.

    Returns ``{'state', 'reason', 'balance'}`` like ``loyverse_push.push_topup``:
    ``pushed`` (in Loyverse and in the wallet), ``waiting`` (retried by the
    cron), ``failed`` (the staff were told), ``skipped`` (push off, voided,
    already done). Never raises for Loyverse trouble.
    """
    S = TopUpRequest.PushState
    if push.push_mode() == "off":
        return push._result("skipped", reason="off")
    after_commit = []
    with transaction.atomic():
        topup = (
            TopUpRequest.objects.select_for_update()
            .select_related("student__user")
            .filter(pk=topup.pk)
            .first()
        )
        if (
            topup is None
            or not topup.is_desk
            or topup.voided_at is not None
            or topup.status != TopUpRequest.Status.PENDING
            or topup.loyverse_push_state in (S.PUSHED, S.CHECK, S.FAILED)
        ):
            return push._result("skipped", reason="not_due")
        student = topup.student
        now = timezone.now()
        started = time.monotonic()
        if not student.loyverse_id:
            push._save_push(
                topup, S.FAILED, "La cuenta no tiene tarjeta de Loyverse vinculada.", now
            )
            after_commit.append(("failed", topup))
            outcome = push._result("failed", reason="not_linked")
        else:
            cb = CafeteriaBalance.objects.select_for_update().filter(student=student).first()
            written = push.write_points_locked(student, cb, cents(topup.amount), started=started)
            if written["status"] == "wait":
                # Gives up (failed + staff notice) after MAX_ATTEMPTS, like card top-ups.
                outcome = push._record_wait(topup, None, written["note"], now, after_commit)
            elif written["status"] == "failed":
                push._save_push(topup, S.FAILED, written["note"], now)
                logger.error("Desk top-up %s not loaded: %s", topup.receipt_folio, written["note"])
                after_commit.append(("failed", topup))
                outcome = push._result("failed", reason=written["reason"])
            else:
                _credit_locked(topup, cb, written, now, actor)
                after_commit.append(("receipt", topup.pk))
                after_commit.append(("check", topup.pk, written["read_at"]))
                outcome = push._result("pushed", balance=cb.balance)

    for kind, *args in after_commit:
        if kind == "receipt":
            transaction.on_commit(lambda a=args: notify_receipt(*a), robust=True)
        elif kind == "check":
            transaction.on_commit(lambda a=args: push._check_overlap(*a), robust=True)
        else:
            transaction.on_commit(
                lambda a=args: push.notify_staff("failed", a[0], None), robust=True
            )
    return outcome


def _credit_locked(topup, cb, written, now, actor):
    """Loyverse shows the new balance: credit the wallet once (unique reference)."""
    reference = f"topup-desk-{topup.pk}"
    amount = cents(topup.amount)
    if not CafeteriaTransaction.objects.filter(loyverse_receipt_id=reference).exists():
        cb.balance = (cb.balance or Decimal("0")) + amount
        cb.last_synced = now
        fields = ["balance", "last_synced"]
        if not cb.is_low_balance and cb.last_low_balance_alert_at is not None:
            cb.last_low_balance_alert_at = None
            fields.append("last_low_balance_alert_at")
        cb.save(update_fields=fields)
        CafeteriaTransaction.objects.create(
            student=topup.student,
            transaction_type=CafeteriaTransaction.TxType.TOPUP,
            amount=amount,
            description=movement_description(topup),
            loyverse_receipt_id=reference,
            balance_after=cb.balance,
            date=now,
        )
    topup.status = TopUpRequest.Status.COMPLETED
    topup.processed_at = now
    topup.applied_at = now
    topup.applied_by = actor
    topup.applied_via = TopUpRequest.AppliedVia.AUTO_POS
    topup.pos_loaded_at = now
    topup.pos_loaded_by = actor
    topup.save(
        update_fields=[
            "status",
            "processed_at",
            "applied_at",
            "applied_by",
            "applied_via",
            "pos_loaded_at",
            "pos_loaded_by",
        ]
    )
    push._save_push(
        topup,
        TopUpRequest.PushState.PUSHED,
        f"Loyverse ${written['before']:,.2f} → ${written['target']:,.2f}.",
        now,
    )
    _audit(
        "update",
        topup,
        actor,
        {
            "status": ["pending", "completed"],
            "amount": f"{amount:.2f}",
            "applied_via": TopUpRequest.AppliedVia.AUTO_POS,
            "loyverse_before": f"{written['before']:.2f}",
            "loyverse_after": f"{written['target']:.2f}",
            "folio": topup.receipt_folio,
        },
        context="cafeteria.caja.loyverse_push",
    )


def push_due_desk_topups(*, limit: int = 100, budget_seconds: int = 30) -> dict:
    """The 5-minute cron: desk top-ups still waiting for Loyverse."""
    counts = {"pushed": 0, "waiting": 0, "failed": 0, "skipped": 0}
    if push.push_mode() == "off":
        return counts
    S = TopUpRequest.PushState
    started = time.monotonic()
    due = (
        desk_topups()
        .filter(
            status=TopUpRequest.Status.PENDING,
            voided_at__isnull=True,
            loyverse_push_state__in=[S.NONE, S.WAITING],
        )
        .order_by("created_at", "pk")[:limit]
    )
    for topup in due:
        if time.monotonic() - started > budget_seconds:
            break
        try:
            outcome = push_desk_topup(topup)
        except Exception:  # noqa: BLE001 (one bad row never stops the pass)
            logger.exception("Desk top-up %s crashed in the cron", topup.receipt_folio)
            outcome = push._result("failed")
        counts[outcome["state"]] = counts.get(outcome["state"], 0) + 1
    return counts


# ── void ─────────────────────────────────────────────────────────────────────


def void_desk_topup(topup_id, *, reason, actor) -> dict:
    """«Anular»: take a desk top-up back (Loyverse first, then the wallet).

    Never deletes: the row stays, marked voided, and the ledger gets the
    reversal. A top-up not loaded yet is simply cancelled (no money moved).
    Raises ``CajaError``; returns ``{'state', 'balance'}``.
    """
    reason = str(reason or "").strip()[:255]
    if not reason:
        raise CajaError("Escriba el motivo de la anulación.", code="reason")
    notice = None
    with transaction.atomic():
        topup = (
            desk_topups()
            .select_for_update()
            .select_related("student__user")
            .filter(pk=topup_id)
            .first()
        )
        if topup is None:
            raise CajaError("Recarga no encontrada.", code="not_found", status=404)
        if topup.voided_at is not None:
            raise CajaError(
                f"La recarga {topup.receipt_folio} ya estaba anulada.",
                code="already_voided",
                status=409,
            )
        now = timezone.now()
        amount = cents(topup.amount)
        if topup.status == TopUpRequest.Status.PENDING:
            # Never reached Loyverse nor the wallet (waiting, failed or push off).
            if topup.loyverse_push_state == TopUpRequest.PushState.FAILED:
                raise CajaError(
                    "Esta recarga no se confirmó en Loyverse: revise en Loyverse si el saldo "
                    "sí se cargó y corríjalo con un ajuste en Cafetería.",
                    code="unconfirmed",
                    status=409,
                )
            _mark_voided(topup, actor, reason, now)
            topup.status = TopUpRequest.Status.FAILED
            topup.loyverse_push_state = TopUpRequest.PushState.NONE
            topup.save(update_fields=["status", "loyverse_push_state"])
            _audit("update", topup, actor, {"voided": True, "reason": reason, "money_moved": False})
            balance = getattr(getattr(topup.student, "cafeteria_balance", None), "balance", None)
            return {
                "state": "cancelled",
                "balance": None if balance is None else f"{cents(balance):.2f}",
            }
        if topup.status != TopUpRequest.Status.COMPLETED:
            raise CajaError("Esta recarga no se puede anular.", code="not_voidable", status=409)
        if topup.applied_via != TopUpRequest.AppliedVia.AUTO_POS:
            raise CajaError(
                "Esta recarga se aplicó a mano en Depósitos: corríjala con un ajuste en "
                "Cafetería y quítela también del POS.",
                code="manual",
                status=409,
            )
        cb = CafeteriaBalance.objects.select_for_update().filter(student=topup.student).first()
        if cb is None or cents(cb.balance) < amount:
            raise CajaError(
                "El saldo ya se usó; registre un ajuste en Cafetería.",
                code="already_spent",
                status=409,
            )
        written = push.write_points_locked(topup.student, cb, -amount, started=time.monotonic())
        if written["status"] == "wait":
            raise CajaError(
                f"No se pudo anular en este momento: {written['note']} Intente de nuevo en "
                "unos minutos.",
                code="busy",
                status=409,
            )
        if written["status"] == "failed":
            if written["reason"] == "below_zero":
                raise CajaError(
                    "El saldo ya se usó; registre un ajuste en Cafetería.",
                    code="already_spent",
                    status=409,
                )
            logger.error(
                "Void of desk top-up %s not confirmed: %s", topup.receipt_folio, written["note"]
            )
            notice = topup
            raise_after = CajaError(
                "Loyverse no confirmó la anulación. Revise el saldo en Loyverse; el equipo de "
                "cafetería recibió un aviso.",
                code="not_confirmed",
                status=502,
            )
        else:
            raise_after = None
            cb.balance = (cb.balance or Decimal("0")) - amount
            cb.last_synced = now
            cb.save(update_fields=["balance", "last_synced"])
            tx = CafeteriaTransaction.objects.create(
                student=topup.student,
                transaction_type=CafeteriaTransaction.TxType.ADJUSTMENT,
                amount=amount,
                description=f"Anulación de recarga en recepción · Folio {topup.receipt_folio}",
                loyverse_receipt_id=f"topup-desk-void-{topup.pk}",
                balance_after=cb.balance,
                date=now,
            )
            BalanceAdjustment.objects.create(
                student=topup.student,
                admin=actor,
                kind=BalanceAdjustment.Kind.ADJUSTMENT,
                amount=-amount,
                reason=f"Anulación {topup.receipt_folio}: {reason}",
                balance_after=cb.balance,
                transaction=tx,
            )
            _mark_voided(topup, actor, reason, now)
            _audit(
                "update",
                topup,
                actor,
                {
                    "voided": True,
                    "reason": reason,
                    "amount": f"{amount:.2f}",
                    "loyverse_before": f"{written['before']:.2f}",
                    "loyverse_after": f"{written['target']:.2f}",
                    "folio": topup.receipt_folio,
                },
                context="cafeteria.caja.void",
            )
            balance = cb.balance
            transaction.on_commit(lambda pk=topup.pk: notify_void(pk), robust=True)
    if raise_after is not None:
        push.notify_staff("failed", notice, None)
        raise raise_after
    return {"state": "voided", "balance": f"{cents(balance):.2f}"}


def _mark_voided(topup, actor, reason, now):
    topup.voided_at = now
    topup.voided_by = actor
    topup.void_reason = reason
    topup.save(update_fields=["voided_at", "voided_by", "void_reason"])


# ── MultiCobros (card and link only) ─────────────────────────────────────────


def verify_desk_topup(topup_id, *, actor) -> TopUpRequest:
    with transaction.atomic():
        topup = desk_topups().select_for_update().filter(pk=topup_id).first()
        if topup is None:
            raise CajaError("Recarga no encontrada.", code="not_found", status=404)
        if topup.desk_method == DESK.CASH:
            raise CajaError("El efectivo no se verifica en MultiCobros.", code="cash")
        if topup.desk_verified_at is not None:
            return topup
        if not topup.desk_needs_verification:
            raise CajaError(
                "Esta recarga no está pendiente de verificar.", code="not_due", status=409
            )
        topup.desk_verified_at = timezone.now()
        topup.desk_verified_by = actor
        topup.save(update_fields=["desk_verified_at", "desk_verified_by"])
        _audit(
            "update",
            topup,
            actor,
            {"verified": True, "folio": topup.receipt_folio},
            context="cafeteria.caja.verify",
        )
    return topup


# ── notices ──────────────────────────────────────────────────────────────────


def receipt_details(topup, balance=None) -> list[tuple[str, str]]:
    from apps.cafeteria.schedule import format_amount

    when = timezone.localtime(topup.created_at).strftime("%d/%m/%Y %H:%M")
    rows = [
        ("Folio", topup.receipt_folio or "—"),
        ("Alumno", topup.student.user.full_name),
        ("Monto", format_amount(topup.amount)),
        ("Forma de pago", method_label(topup.desk_method)),
    ]
    if topup.reference:
        rows.append(("Referencia", topup.reference))
    who = topup.received_by.full_name if topup.received_by_id else ""
    if who:
        rows.append(("Recibió", who))
    rows.append(("Fecha", when))
    if balance is not None:
        rows.append(("Saldo actual", format_amount(balance)))
    return rows


def notify_receipt(topup_id) -> int:
    """«Recibimos su recarga»: the family's receipt (or the staff member's, for
    a staff wallet). Best-effort; the money is already committed."""
    return _notify(topup_id, voided=False)


def notify_void(topup_id) -> int:
    return _notify(topup_id, voided=True)


def _notify(topup_id, *, voided: bool) -> int:
    from apps.accounts.family import family_notify_recipients
    from apps.cafeteria.schedule import format_amount
    from apps.portal.models import Notification
    from apps.portal.services import copy_to_family, notify

    try:
        topup = (
            desk_topups()
            .select_related("student__user", "received_by", "student__cafeteria_balance")
            .filter(pk=topup_id)
            .first()
        )
        if topup is None:
            return 0
        student = topup.student
        name = student.user.full_name
        balance = getattr(getattr(student, "cafeteria_balance", None), "balance", None)
        amount = format_amount(topup.amount)
        if voided:
            title = "Recarga anulada"
            message = (
                f"Se anuló la recarga {topup.receipt_folio} de {amount} para la cafetería "
                f"de {name}. Motivo: {topup.void_reason}."
            )
            intro = f"Se anuló una recarga de la cafetería de {student.user.first_name or name}."
            tone = "warning"
        else:
            title = "Recibimos su recarga"
            message = (
                f"Recibimos {amount} en la recepción del colegio para la cafetería de "
                f"{name} ({method_label(topup.desk_method).lower()}). Folio "
                f"{topup.receipt_folio}."
            )
            intro = (
                f"Recibimos su recarga para la cafetería de "
                f"{student.user.first_name or name}. El saldo ya está cargado: ya puede "
                "usarlo."
            )
            tone = "success"
        details = receipt_details(topup, balance)
        notified = 0
        for person in family_notify_recipients(student):
            notify(
                person,
                Notification.NotifType.PAYMENT,
                title,
                message,
                fanout=False,
                details=details,
                highlight=("Monto", amount),
                tone=tone,
                intro=intro,
            )
            notified += 1
        copy_to_family(student, Notification.NotifType.PAYMENT, title, message)
        return notified
    except Exception:  # noqa: BLE001
        logger.exception("Desk top-up notice failed for #%s", topup_id)
        return 0


def _audit(action, topup, actor, changes, *, context="cafeteria.caja"):
    from apps.core.audit import record

    record(action, topup, changes, actor=actor, context=context)
