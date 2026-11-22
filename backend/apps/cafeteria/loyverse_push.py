"""
cafeteria/loyverse_push.py: the app writes a paid card top-up into Loyverse.

Until 2026-11-21 every card top-up waited for staff to type it into the
Loyverse POS (07:30 each school day) because spec R1 said ``total_points``
could not be written. A live test that day showed it can: ``POST /customers``
with the customer's ``id`` sets the points balance. Two facts from that test
shape everything here: the value is ABSOLUTE (two decimals), not an amount to
add, so a top-up is read, add, write back; and fields missing from the body
are CLEARED, so the body is always the full record just read
(``services.customer_write_body``). The till spends the new balance at once.

``settings.CAFETERIA_TOPUP_LOYVERSE_PUSH`` picks when:

- ``off`` (default): nothing is written; the scheduled flow is unchanged.
- ``verified``: right after «Verificar en MultiCobros», and by the 5-minute
  cron for anything verified in bulk.
- ``instant``: on approval for amounts up to
  ``CAFETERIA_TOPUP_PUSH_UNVERIFIED_MAX``; larger ones wait for the
  verification. Banorte's result reaches us through the parent's browser
  without an integrity check (docs/BANORTE-INTEGRATION.md), so the cap bounds
  what a forged approval could put on a card before staff verify it.

The rules (each one pinned in ``test_loyverse_push.py``):

1. Real money only: ``PAYMENTS_LIVE`` on, a successful payment, never a
   Payworks simulation, never a refunded one.
2. Write only when Loyverse and the wallet agree to the cent. The API has no
   atomic increment, so "they agree" is the proof that no sale or POS load is
   in flight. Any difference is ``waiting``, retried by the cron, and handed
   to the staff (``failed``) after ``MAX_ATTEMPTS``.
3. Locks first (the top-up row, then the wallet: the order every money path
   uses), then the Loyverse read as late as possible, the write, a re-read.
   The receipts webhook and the POS mirror wait on those locks, so neither
   sees Loyverse half-way.
4. The wallet is credited only when the re-read shows exactly the new
   balance. Anything else (a rejected write, a timeout, another figure) is
   ``failed``: never written again automatically, the staff are told, and it
   stays in «Por aplicar». If Loyverse does hold the money, the POS mirror
   finds the exact gap and applies it, so no outcome loses or doubles money.
5. A sale of the same student that reached Loyverse between our read and our
   write (~0.3 s) would be overwritten. Right after a write the receipts of
   that moment are checked; a suspect marks the top-up ``check``, the staff
   are told, and the POS mirror leaves the student alone until Loyverse and
   the wallet agree again (``resolve_checks``).
"""

from __future__ import annotations

import logging
import time
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.cafeteria import services
from apps.cafeteria.services import LoyverseError

logger = logging.getLogger(__name__)

MODES = ("off", "verified", "instant")
CENT = Decimal("0.01")
# A ``waiting`` top-up is retried by the 5-minute cron this many times (~2 h)
# before it is handed to the staff as ``failed``.
MAX_ATTEMPTS = 24
# From taking the locks to sending the write. Past it the read is too old to
# trust (a slow Loyverse), so nothing is written and the cron tries again.
WRITE_DEADLINE_SECONDS = 6
# How far before our read a receipt can be and still be a suspect.
CHECK_WINDOW_SECONDS = 30
# Where the staff fix things (the console's «Por aplicar»).
QUEUE_PATH = services.PAID_QUEUE_PATH
QUEUE_WHERE = services.PAID_QUEUE_WHERE


def push_mode() -> str:
    """``'off'``, ``'verified'`` or ``'instant'``; anything else is off."""
    mode = str(getattr(settings, "CAFETERIA_TOPUP_LOYVERSE_PUSH", "off") or "").strip().lower()
    return mode if mode in MODES else "off"


def unverified_max() -> Decimal:
    """``instant`` mode: the largest approval written before it is verified.
    Unset means the top-up maximum itself (school, 2026-11-22: every card
    top-up loads at once); a malformed value means nothing unverified loads."""
    from apps.cafeteria.serializers import topup_max_amount

    raw = getattr(settings, "CAFETERIA_TOPUP_PUSH_UNVERIFIED_MAX", None)
    if raw in (None, ""):
        return topup_max_amount()
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")
    return max(value, Decimal("0")).quantize(CENT)


def is_enabled() -> bool:
    """Writing into Loyverse is on, and payments move real money."""
    return push_mode() != "off" and bool(getattr(settings, "PAYMENTS_LIVE", False))


def effective_mode() -> str:
    """What families are promised: the mode when enabled, else ``'off'``."""
    return push_mode() if is_enabled() else "off"


def _cents(value) -> Decimal:
    try:
        return Decimal(str(value if value is not None else 0)).quantize(CENT)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def _final_states():
    from apps.cafeteria.models import TopUpRequest

    S = TopUpRequest.PushState
    return (S.PUSHED, S.CHECK, S.FAILED)


def ineligible_reason(payment, topup) -> str:
    """``''`` when this top-up may be written into Loyverse now, else why not."""
    from apps.cafeteria.models import TopUpRequest
    from apps.payments.models import Payment

    mode = push_mode()
    if mode == "off":
        return "off"
    if not getattr(settings, "PAYMENTS_LIVE", False):
        return "not_live"
    if payment is None or topup is None:
        return "not_a_topup"
    if topup.method != TopUpRequest.Method.ONLINE or topup.status != TopUpRequest.Status.PAID:
        return "not_paid"
    if payment.status != Payment.Status.SUCCESS:
        return "not_approved"
    if payment.is_simulation():
        return "simulation"
    if payment.needs_bank_verification():
        if mode != "instant":
            return "needs_verification"
        if _cents(payment.amount) > unverified_max():
            return "over_unverified_max"
    if topup.loyverse_push_state in _final_states():
        return "already_written"
    if _cents(payment.amount) <= 0:
        return "no_amount"
    return ""


def will_load(topup) -> bool:
    """Will the app write this PAID top-up into Loyverse by itself (now or on
    the 5-minute pass)? What the console and the 07:05 list tell the staff:
    when True they must NOT type it into the POS (a manual load on top of the
    app's would put the money on the card twice); only a ``failed`` one, or
    one still waiting for «Verificar», is theirs."""
    from apps.cafeteria.models import TopUpRequest

    if topup is None or not is_enabled():
        return False
    if not isinstance(topup, TopUpRequest):
        topup = TopUpRequest.objects.filter(pk=topup).first()
        if topup is None:
            return False
    if not topup.student.loyverse_id:
        return False
    return ineligible_reason(services._paid_payment(topup), topup) == ""


def needs_manual_load(topup) -> bool:
    """The app gave up on this PAID top-up (``failed``): staff load it by hand."""
    from apps.cafeteria.models import TopUpRequest

    return (
        is_enabled()
        and topup.status == TopUpRequest.Status.PAID
        and topup.loyverse_push_state == TopUpRequest.PushState.FAILED
    )


def _result(state, *, reason="", balance=None) -> dict:
    return {
        "state": state,
        "reason": reason,
        "balance": None if balance is None else f"{_cents(balance):.2f}",
    }


def _wait_reason(student, cb) -> str:
    """Why this wallet cannot take a write right now ('' when it can)."""
    if cb is None or cb.last_synced is None:
        return "El monedero del alumno aún no tiene saldo inicial en la app."
    reasons = services.pos_queue_reasons([student.id], include_paid=False)
    if student.id in reasons:
        return f"El alumno {reasons[student.id]}."
    return ""


def _save_push(topup, state, note, now, *, attempted=True):
    topup.loyverse_push_state = state
    topup.loyverse_push_note = str(note or "")[:255]
    fields = ["loyverse_push_state", "loyverse_push_note"]
    if attempted:
        topup.loyverse_push_at = now
        topup.loyverse_push_attempts = (topup.loyverse_push_attempts or 0) + 1
        fields += ["loyverse_push_at", "loyverse_push_attempts"]
    topup.save(update_fields=fields)


def push_topup(payment, *, actor=None, at_payment: bool = False) -> dict:
    """Write one paid card top-up into Loyverse and credit the wallet.

    Returns ``{'state', 'reason', 'balance'}`` where ``state`` is ``pushed``
    (credited; ``balance`` is the new wallet figure), ``waiting`` (retried by
    the cron), ``failed`` (left to the staff), or ``skipped`` (not eligible,
    ``reason`` says why; nothing recorded). Loyverse trouble never raises: it
    is recorded on the top-up.

    ``at_payment``: written seconds after the approval (``instant`` mode). The
    family then gets ONE message, «Recarga de cafetería lista» (payment
    received and already spendable), and the usual payment notice skips
    itself (``services.notify_topup_result``); otherwise «Recarga aplicada».
    """
    from apps.cafeteria.models import CafeteriaBalance, TopUpRequest
    from apps.core.audit import record
    from apps.payments.models import Payment

    S = TopUpRequest.PushState
    if push_mode() == "off":
        return _result("skipped", reason="off")
    payment = (
        Payment.objects.select_related("banorte", "related_topup__student__user")
        .filter(pk=getattr(payment, "pk", None))
        .first()
    )
    topup = payment.related_topup if payment is not None else None
    reason = ineligible_reason(payment, topup)
    if reason:
        return _result("skipped", reason=reason)

    student = topup.student
    after_commit = []
    with transaction.atomic():
        # Lock order everywhere: top-up rows, then the wallet.
        topup = (
            TopUpRequest.objects.select_for_update()
            .select_related("student__user")
            .get(pk=topup.pk)
        )
        # Read, not locked: settlement locks the payment before the top-up.
        payment = services._paid_payment(topup)
        if payment is not None:
            payment = Payment.objects.select_related("banorte").get(pk=payment.pk)
        reason = ineligible_reason(payment, topup)
        if reason:
            return _result("skipped", reason=reason)
        now = timezone.now()
        started = time.monotonic()

        if not student.loyverse_id:
            _save_push(topup, S.FAILED, "El alumno no tiene tarjeta de Loyverse vinculada.", now)
            after_commit.append(("failed", topup, payment))
            outcome = _result("failed", reason="not_linked")
        else:
            cb = CafeteriaBalance.objects.select_for_update().filter(student=student).first()
            wait = _wait_reason(student, cb)
            customer = None
            if not wait:
                try:
                    with services._guard_read_budget():
                        customer = services.get_customer_by_id(student.loyverse_id)
                except LoyverseError:
                    wait = "No se pudo leer el saldo en Loyverse."
            if not wait and customer.get("deleted_at"):
                _save_push(topup, S.FAILED, "La tarjeta del alumno está borrada en Loyverse.", now)
                after_commit.append(("failed", topup, payment))
                outcome = _result("failed", reason="customer_deleted")
            elif wait:
                outcome = _record_wait(topup, payment, wait, now, after_commit)
            else:
                before = _cents(services.get_balance_from_customer(customer))
                local = _cents(cb.balance)
                if before != local:
                    outcome = _record_wait(
                        topup,
                        payment,
                        f"Loyverse tiene ${before:,.2f} y la app ${local:,.2f}; se carga "
                        "cuando coincidan.",
                        now,
                        after_commit,
                    )
                elif time.monotonic() - started > WRITE_DEADLINE_SECONDS:
                    outcome = _record_wait(
                        topup, payment, "Loyverse respondió lento.", now, after_commit
                    )
                else:
                    outcome = _write_and_credit(
                        topup, payment, cb, customer, before, now, actor, after_commit, record
                    )

    for kind, *args in after_commit:
        if kind == "family":
            family_notice = notify_paid_and_loaded if at_payment else services.notify_topup_applied
            transaction.on_commit(lambda f=family_notice, a=args: f(*a), robust=True)
        elif kind == "check":
            transaction.on_commit(lambda a=args: _check_overlap(*a), robust=True)
        else:
            transaction.on_commit(lambda k=kind, a=args: notify_staff(k, *a), robust=True)
    return outcome


def _record_wait(topup, payment, note, now, after_commit) -> dict:
    from apps.cafeteria.models import TopUpRequest

    S = TopUpRequest.PushState
    if (topup.loyverse_push_attempts or 0) + 1 >= MAX_ATTEMPTS:
        _save_push(topup, S.FAILED, f"Sin cargar tras varios intentos. {note}", now)
        after_commit.append(("failed", topup, payment))
        return _result("failed", reason="gave_up")
    _save_push(topup, S.WAITING, note, now)
    return _result("waiting", reason=note)


def _write_and_credit(topup, payment, cb, customer, before, now, actor, after_commit, record):
    """Under the locks, with Loyverse == wallet == ``before``: write, re-read,
    credit only on an exact match."""
    from apps.cafeteria.models import TopUpRequest

    S = TopUpRequest.PushState
    student = topup.student
    amount = _cents(payment.amount)
    target = before + amount
    read_at = timezone.now()
    write_error = ""
    try:
        services.set_customer_points(customer, target)
    except LoyverseError as exc:
        write_error = str(exc)[:80]
    try:
        with services._guard_read_budget():
            after = _cents(
                services.get_balance_from_customer(services.get_customer_by_id(student.loyverse_id))
            )
    except LoyverseError:
        after = None

    if after != target:
        seen = "no se pudo leer" if after is None else f"${after:,.2f}"
        note = (
            f"No se confirmó la carga: Loyverse tenía ${before:,.2f}, se escribió "
            f"${target:,.2f} y ahora muestra {seen}."
            + (f" Error: {write_error}" if write_error else "")
        )
        _save_push(topup, S.FAILED, note, now)
        logger.error("Loyverse push of top-up #%s not confirmed: %s", topup.pk, note)
        after_commit.append(("failed", topup, payment))
        return _result("failed", reason="not_confirmed")

    tx = services._credit_topup_locked(
        topup,
        payment,
        cb,
        via=TopUpRequest.AppliedVia.AUTO_POS,
        actor=actor,
        pos_loaded=True,
        now=now,
    )
    if tx is None:
        # Already credited (the unique reference): Loyverse now holds it
        # twice. Never expected (the top-up was locked PAID); hand it over.
        note = (
            f"Ya estaba abonada en la app y la app la cargó en Loyverse: quite "
            f"${amount:,.2f} del saldo en Loyverse."
        )
        _save_push(topup, S.FAILED, note, now)
        logger.error("Loyverse push of top-up #%s doubled an existing credit.", topup.pk)
        after_commit.append(("failed", topup, payment))
        return _result("failed", reason="already_credited")

    _save_push(topup, S.PUSHED, f"Loyverse ${before:,.2f} → ${target:,.2f}.", now)
    record(
        "update",
        topup,
        {
            "status": ["paid", "completed"],
            "amount": f"{amount:.2f}",
            "applied_via": TopUpRequest.AppliedVia.AUTO_POS,
            "loyverse_before": f"{before:.2f}",
            "loyverse_after": f"{target:.2f}",
            "payment": payment.pk,
            "verified": not payment.needs_bank_verification(),
        },
        actor=actor,
        context="cafeteria.topup.loyverse_push",
    )
    logger.info(
        "Top-up #%s written into Loyverse for %s: $%s → $%s.", topup.pk, student, before, target
    )
    after_commit.append(("family", topup, cb.balance))
    after_commit.append(("check", topup.pk, read_at))
    return _result("pushed", balance=cb.balance)


def _check_overlap(topup_id, read_at) -> bool:
    """After a write: did a sale of this student reach Loyverse around it?

    A receipt with points spent, created by Loyverse's server from
    ``CHECK_WINDOW_SECONDS`` before our read until now, that the wallet had
    not recorded when we read, may have been overwritten (the API has no
    compare-and-set). Marks the top-up ``check`` and tells the staff. Returns
    True when it found one. Best-effort: a failed lookup is only logged.
    """
    from apps.cafeteria.models import CafeteriaTransaction, TopUpRequest

    topup = TopUpRequest.objects.select_related("student__user").filter(pk=topup_id).first()
    if topup is None or not topup.student.loyverse_id:
        return False
    try:
        receipts = services.get_receipts(
            since=services._loyverse_ts(read_at - timedelta(seconds=CHECK_WINDOW_SECONDS)),
            max_pages=2,
        )
    except LoyverseError as exc:
        logger.warning("Overlap check of top-up #%s skipped: %s", topup_id, exc)
        return False
    known_before = set(
        CafeteriaTransaction.objects.filter(
            student=topup.student, recorded_at__lt=read_at
        ).values_list("loyverse_receipt_id", flat=True)
    )
    suspects = []
    for receipt in receipts:
        if receipt.get("customer_id") != topup.student.loyverse_id:
            continue
        number = str(receipt.get("receipt_number") or "")
        created = parse_datetime(str(receipt.get("created_at") or ""))
        spent = services._points_spent(receipt)
        if not number or number in known_before or spent <= 0 or created is None:
            continue
        if created >= read_at - timedelta(seconds=CHECK_WINDOW_SECONDS):
            suspects.append((number, spent))
    if not suspects:
        return False
    total = sum((s for _, s in suspects), Decimal("0"))
    note = (
        f'Una compra de ${total:,.2f} (recibo {", ".join(n for n, _ in suspects)}) coincidió '
        "con la carga. Revise que el saldo en Loyverse sea igual al de la app."
    )
    TopUpRequest.objects.filter(pk=topup.pk).update(
        loyverse_push_state=TopUpRequest.PushState.CHECK, loyverse_push_note=note[:255]
    )
    topup.loyverse_push_note = note[:255]
    logger.warning("Top-up #%s: %s", topup.pk, note)
    notify_staff("check", topup, services._paid_payment(topup))
    return True


def resolve_checks() -> int:
    """Close ``check`` top-ups whose card agrees with the wallet again (staff
    fixed it, or the sale landed after the write after all). Returns how many."""
    from apps.cafeteria.models import CafeteriaBalance, TopUpRequest

    resolved = 0
    for topup in TopUpRequest.objects.filter(
        loyverse_push_state=TopUpRequest.PushState.CHECK
    ).select_related("student"):
        student = topup.student
        if not student.loyverse_id:
            continue
        try:
            points = _cents(
                services.get_balance_from_customer(services.get_customer_by_id(student.loyverse_id))
            )
        except LoyverseError:
            continue
        balance = (
            CafeteriaBalance.objects.filter(student=student)
            .values_list("balance", flat=True)
            .first()
        )
        if balance is not None and points == _cents(balance):
            TopUpRequest.objects.filter(pk=topup.pk).update(
                loyverse_push_state=TopUpRequest.PushState.PUSHED,
                loyverse_push_note=f"Revisada: Loyverse y la app coinciden (${points:,.2f}).",
            )
            resolved += 1
    return resolved


def push_due_topups(*, limit: int = 200, budget_seconds: int = 90) -> dict:
    """The cron's pass: write every eligible paid top-up not written yet.

    Runs before the POS mirror in the 5-minute tick. Picks PAID card top-ups
    never tried or ``waiting``, oldest first, within ``limit`` and a time
    budget, and closes ``check`` ones that agree again.
    """
    from apps.cafeteria.models import TopUpRequest

    counts = {
        "enabled": is_enabled(),
        "pushed": 0,
        "waiting": 0,
        "failed": 0,
        "skipped": 0,
        "resolved": 0,
    }
    if not counts["enabled"]:
        return counts
    counts["resolved"] = resolve_checks()
    started = time.monotonic()
    S = TopUpRequest.PushState
    due = (
        services.paid_topups_pending()
        .filter(loyverse_push_state__in=[S.NONE, S.WAITING])
        .order_by("processed_at", "pk")[:limit]
    )
    for topup in due:
        if time.monotonic() - started > budget_seconds:
            break
        payment = services._paid_payment(topup)
        try:
            outcome = push_topup(payment) if payment is not None else _result("skipped")
        except Exception:  # noqa: BLE001 (one bad row never stops the pass)
            logger.exception("Loyverse push of top-up #%s crashed", topup.pk)
            outcome = _result("failed")
        counts[outcome["state"]] = counts.get(outcome["state"], 0) + 1
    logger.info("push_due_topups: %s", counts)
    return counts


def push_after_payment(payment_id) -> None:
    """``instant`` mode, right after a card approval commits. Never raises:
    whatever does not go now is the cron's (or the 07:30 load's)."""
    if push_mode() != "instant" or not is_enabled():
        return
    from apps.payments.models import Payment

    payment = Payment.objects.filter(pk=payment_id).first()
    if payment is None:
        return
    try:
        push_topup(payment, at_payment=True)
    except Exception:  # noqa: BLE001
        logger.exception("Loyverse push after payment #%s crashed; the cron retries.", payment_id)


# ── Notices ──────────────────────────────────────────────────────────────────


def notify_paid_and_loaded(topup, balance) -> int:
    """``instant`` mode: the one message the family gets when the app wrote
    the top-up into Loyverse seconds after the approval. Replaces both «Pago
    de recarga recibido» (the payment notice skips itself) and «Recarga
    aplicada». Best-effort. Returns the number of guardians notified."""
    from apps.accounts.family import family_notify_recipients
    from apps.cafeteria.schedule import format_amount
    from apps.portal.models import Notification
    from apps.portal.services import copy_to_family, notify

    try:
        payment = services._paid_payment(topup)
        student = topup.student
        name = student.user.full_name
        amount = format_amount(payment.amount if payment is not None else topup.amount)
        title = "Recarga de cafetería lista"
        folio = f" Folio: {payment.pk}." if payment is not None else ""
        message = (
            f"Recibimos su pago de {amount} para la cafetería de {name} y el saldo ya "
            f"está cargado en la cafetería: ya puede usarlo. Saldo actual: "
            f"{format_amount(balance)}.{folio}"
        )
        details = [("Alumno", name), ("Saldo actual", format_amount(balance))]
        if payment is not None:
            details.append(("Folio", str(payment.pk)))
        notified = 0
        for parent in family_notify_recipients(student):
            notify(
                parent,
                Notification.NotifType.PAYMENT,
                title,
                message,
                fanout=False,
                details=details,
                highlight=("Monto pagado", amount),
                tone="success",
                intro=(
                    f"Recibimos su pago para la cafetería de "
                    f"{student.user.first_name or name}. El saldo ya está cargado en la "
                    f"cafetería: ya puede usarlo."
                ),
            )
            notified += 1
        copy_to_family(student, Notification.NotifType.PAYMENT, title, message)
        return notified
    except Exception:  # noqa: BLE001 (the credit is already committed)
        logger.exception("Paid-and-loaded notice failed for top-up #%s", topup.pk)
        return 0


def notify_staff(kind, topup, payment) -> int:
    """Tell the cafetería staff that a top-up needs them: ``failed`` (load it
    by hand) or ``check`` (a sale coincided). Best-effort. Returns how many
    people were told."""
    from apps.cafeteria.schedule import format_amount
    from apps.portal.emailing import EmailContent, portal_url
    from apps.portal.models import Notification
    from apps.portal.services import notify, send_email

    try:
        name = topup.student.user.full_name
        amount = format_amount(payment.amount if payment is not None else topup.amount)
        if kind == "check":
            title = f"Revisar en Loyverse: {name}, {amount}"
            intro = "La app cargó esta recarga en Loyverse, pero una compra coincidió con la carga."
            todo = (
                f"Revise el saldo de {name} en Loyverse: debe ser igual al saldo de la app. "
                "Si Loyverse muestra de más, quite la diferencia en Loyverse."
            )
        else:
            title = f"Cargar a mano: {name}, {amount}"
            intro = "La app no pudo cargar esta recarga en Loyverse."
            todo = (
                f"Cárguela en el POS como siempre y aplíquela en {QUEUE_WHERE}. "
                "Antes, revise en Loyverse que no esté ya cargada."
            )
        message = "\n\n".join(filter(None, [intro, topup.loyverse_push_note, todo]))
        people = services.cafeteria_staff()
        for person in people:
            notify(
                person, Notification.NotifType.CAFETERIA, title, message, email=False, fanout=False
            )
        emails = [p.email for p in people if p.email]
        if emails:
            details = [("Alumno", name), ("Monto", amount)]
            if payment is not None:
                details.append(("Folio", str(payment.pk)))
            send_email(
                f"Interlaken: {title}",
                message,
                emails,
                content=EmailContent(
                    title=title,
                    intro=intro,
                    category="Cafetería",
                    tone="warning",
                    details=details,
                    paragraphs=[p for p in (topup.loyverse_push_note, todo) if p],
                    cta_label="Abrir «Por aplicar»",
                    cta_url=portal_url(QUEUE_PATH),
                    link_fallback=False,
                    reason="Aviso interno de la consola del Colegio Interlaken.",
                ),
            )
        return len(people)
    except Exception:  # noqa: BLE001 (a notice never undoes the money work)
        logger.exception("Staff notice (%s) for top-up #%s failed", kind, topup.pk)
        return 0
