"""
payments/multicobros.py: staff work on Banorte operations, checked in MultiCobros.

Banorte answers only through the parent's browser, so some operations end
without a trustworthy answer: the parent closed the window after paying, the
checkout expired or was superseded by a new attempt, or the issuer timed out.
The card may have been charged while the wallet was not credited. Staff look
those up in MultiCobros (Analítica → Reportes → Transacciones Payworks 2) and
close them here:

- ``reconcile_approved``: MultiCobros shows the charge APPROVED. Settles the
  payment as a success through ``settlement.apply_event`` (locked, idempotent,
  credits the wallet once) and records the staff verification, so a later
  browser callback is a no-op. Never a manual balance adjustment: that left
  the payment soft-failed and a late approval would credit it a second time.
- ``reconcile_not_found``: no such charge in MultiCobros. Closes it for staff
  (stage ``not_found``) but keeps it a *soft* failure, so a genuine approval
  that still arrives is credited.

``review_reason`` is the shared rule of what needs that check, used by the
``banorte_pending_report`` email and the admin deposit log.

A browser-reported approval that WAS credited still has to be matched in
MultiCobros before the money goes into the POS: ``verify_approval`` is that
rule («Verificar en MultiCobros»), shared by the per-payment dialog
(``AdminBanorteVerifyView``) and the report upload
(``multicobros_report``), so the two can never drift. ``apply_verified``
is what both run once the verification has committed.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .gateways.base import PaymentEvent
from .models import BanorteCheckout, Payment

logger = logging.getLogger(__name__)

# Soft-fail stages that can hide a real charge: the window closed or was
# replaced without Banorte's answer, or the issuer did not answer in time.
# ``cancel`` (inside Banorte's window, before paying) and ``create_checkout``
# (never opened, or AUT-10) charge nothing; ``not_found`` was already checked.
NEEDS_CHECK_STAGES = frozenset({"expire", "supersede", "bank_timeout"})

_REFERENCIA_RE = re.compile(r"^\d{1,20}$")
_AUTH_RE = re.compile(r"^[A-Za-z0-9]{1,10}$")


class ReconcileError(ValueError):
    """A reconciliation the server refuses; ``status`` is the HTTP status."""

    def __init__(self, message: str, *, status: int = 400, code: str = "invalid"):
        super().__init__(message)
        self.status = status
        self.code = code


@dataclass
class ReconcileResult:
    payment: Payment
    detail: str  # 'settled' | 'closed' | 'already_processed'


def is_open_for_review(payment: Payment) -> bool:
    """Still unresolved: pending, or soft-failed (``not_found`` included, staff may
    find the charge later). Approved, declined and refunded payments are closed."""
    if payment.status in (Payment.Status.PENDING, Payment.Status.PROCESSING):
        return True
    return payment.is_soft_failed()


def can_reconcile(payment: Payment) -> bool:
    return (
        payment.gateway == Payment.Gateway.BANORTE
        and payment.banorte_checkout() is not None
        and is_open_for_review(payment)
    )


def review_reason(payment: Payment, checkout: BanorteCheckout, now=None) -> str | None:
    """Why staff must look this operation up in MultiCobros, or ``None``.

    A pending payment younger than the checkout TTL is a parent still paying;
    the expiry job turns it into ``expire`` once the window is over.
    """
    from .services import open_checkout_ttl_minutes

    now = now or timezone.now()
    if payment.status in (Payment.Status.PENDING, Payment.Status.PROCESSING):
        if checkout.last_error:
            return f"pendiente; respuesta no confiable: {checkout.last_error}"
        if payment.created_at > now - timedelta(minutes=open_checkout_ttl_minutes()):
            return None
        return "pendiente, sin respuesta de Banorte"
    if payment.status != Payment.Status.FAILED:
        return None
    stage = payment.failure_stage()
    if stage not in NEEDS_CHECK_STAGES:
        return None
    if stage == "bank_timeout":
        return "el banco emisor no respondió (Payworks T)"
    if stage == "supersede":
        return "reemplazado por un nuevo intento sin respuesta de Banorte (pudo haberse cobrado)"
    return "expiró sin respuesta de Banorte (el padre pudo cerrar la ventana tras pagar)"


def needs_review_q(now=None) -> Q:
    """``review_reason`` as a ``Payment`` filter (the deposit log's "Por revisar en
    MultiCobros"); ``test_multicobros`` keeps the two in step."""
    from .services import open_checkout_ttl_minutes

    now = now or timezone.now()
    cutoff = now - timedelta(minutes=open_checkout_ttl_minutes())
    still_open = Q(status__in=[Payment.Status.PENDING, Payment.Status.PROCESSING]) & (
        Q(created_at__lte=cutoff) | Q(banorte__last_error__gt="")
    )
    unanswered = Q(status=Payment.Status.FAILED, gateway_raw__stage__in=sorted(NEEDS_CHECK_STAGES))
    return Q(banorte__isnull=False) & (still_open | unanswered)


def parse_amount(value) -> Decimal | None:
    """The amount staff typed ("$1,234.50"), or ``None`` when it is not a finite
    number: ``Decimal`` also parses "NaN"/"sNaN"/"Infinity", and comparing an
    sNaN raises (a 500 on «Conciliar» and «Verificar»)."""
    try:
        amount = Decimal(str(value).strip().replace("$", "").replace(",", ""))
    except (InvalidOperation, AttributeError):
        return None
    return amount if amount.is_finite() else None


def _locked(payment_id):
    payment = Payment.objects.select_for_update().filter(pk=payment_id).first()
    if payment is None or payment.gateway != Payment.Gateway.BANORTE:
        raise ReconcileError("Pago no encontrado.", status=404, code="payment_not_found")
    checkout = BanorteCheckout.objects.select_for_update().filter(payment=payment).first()
    if checkout is None:
        raise ReconcileError(
            "Este pago no tiene operación Banorte.", status=404, code="payment_not_found"
        )
    return payment, checkout


def reconcile_approved(
    payment_id, *, referencia, codigo_aut, amount, note: str = "", actor
) -> ReconcileResult:
    """Settle a payment MultiCobros shows APPROVED (see the module docstring)."""
    from apps.core.audit import audit_context, record

    from .settlement import apply_event, notify_result

    referencia = str(referencia or "").strip()
    codigo_aut = str(codigo_aut or "").strip().upper()
    note = str(note or "").strip()[:500]
    if not _REFERENCIA_RE.match(referencia):
        raise ReconcileError(
            "Escriba la referencia Payworks tal como aparece en MultiCobros (solo dígitos).",
            code="invalid_reference",
        )
    if not _AUTH_RE.match(codigo_aut):
        raise ReconcileError(
            "Escriba el número de autorización de MultiCobros (letras y dígitos).",
            code="invalid_auth_code",
        )
    typed_amount = parse_amount(amount)

    notify_arg = None
    with audit_context(actor=actor, context="payments.banorte.reconcile"):
        with transaction.atomic():
            payment, checkout = _locked(payment_id)
            if payment.status == Payment.Status.SUCCESS:
                if checkout.referencia == referencia:
                    return ReconcileResult(payment, "already_processed")
                raise ReconcileError(
                    "Este pago ya está acreditado con otra referencia; no se concilia de nuevo.",
                    status=409,
                    code="already_settled",
                )
            if not is_open_for_review(payment):
                raise ReconcileError(
                    "Solo se concilian pagos pendientes, expirados, reemplazados, sin "
                    "respuesta del banco o marcados como no encontrados.",
                    status=409,
                    code="not_reconcilable",
                )
            if typed_amount is None or typed_amount != payment.amount:
                raise ReconcileError(
                    f"El monto no coincide con el del pago (${payment.amount:.2f}). "
                    "Si MultiCobros muestra otro monto, no lo concilie y avise a dirección.",
                    code="amount_mismatch",
                )
            if not checkout.is_live and getattr(settings, "PAYMENTS_LIVE", False):
                raise ReconcileError(
                    f"Es una operación de simulación (modo {checkout.mode}): no hubo cargo real.",
                    code="simulation",
                )
            clash = (
                BanorteCheckout.objects.filter(referencia=referencia)
                .exclude(pk=checkout.pk)
                .exclude(referencia="")
                .exists()
            )
            if clash:
                raise ReconcileError(
                    "Esa referencia ya pertenece a otro pago.", status=409, code="reference_in_use"
                )

            previous = {
                "status": payment.status,
                "stage": payment.failure_stage(),
                "resultado_payw": checkout.resultado_payw,
            }
            now = timezone.now()
            checkout.resultado_payw = BanorteCheckout.Result.APPROVED
            checkout.referencia = referencia
            checkout.codigo_aut = codigo_aut
            checkout.result_at = checkout.result_at or now
            # Staff read the operation in MultiCobros: that IS the verification.
            checkout.verified_at = now
            checkout.verified_by = actor
            checkout.key_material = ""  # final: no later answer needs decrypting
            checkout.save()

            raw = {
                "multicobros": {
                    "referencia": referencia,
                    "codigo_aut": codigo_aut,
                    "amount": f"{typed_amount:.2f}",
                    "note": note,
                    "staff_id": getattr(actor, "pk", None),
                    "at": now.isoformat(),
                },
                "previous": payment.gateway_raw if isinstance(payment.gateway_raw, dict) else {},
            }
            _, _, notify_arg = apply_event(
                PaymentEvent(
                    payment.pk,
                    "success",
                    checkout.control_number,
                    raw,
                    reference=referencia,
                )
            )
            record(
                "update",
                payment,
                {
                    "banorte_reconciled": "approved",
                    "referencia": referencia,
                    "codigo_aut": codigo_aut,
                    "amount": f"{payment.amount:.2f}",
                    "previous": previous,
                    "note": note,
                },
                actor=actor,
                context="payments.banorte.reconcile",
            )
    notify_result(notify_arg)
    payment.refresh_from_db()
    return ReconcileResult(payment, "settled")


def reconcile_not_found(payment_id, *, note: str, actor) -> ReconcileResult:
    """Close an operation staff did not find in MultiCobros (still soft: see the docstring)."""
    from apps.cafeteria.services import fail_online_topup
    from apps.core.audit import audit_context, record

    note = str(note or "").strip()[:500]
    if not note:
        raise ReconcileError(
            "Escriba una nota: qué buscó en MultiCobros y qué encontró.", code="note_required"
        )

    with audit_context(actor=actor, context="payments.banorte.reconcile"):
        with transaction.atomic():
            payment, _checkout = _locked(payment_id)
            if not is_open_for_review(payment):
                raise ReconcileError(
                    "Este pago ya tiene un resultado final; no se puede marcar como no encontrado.",
                    status=409,
                    code="not_reconcilable",
                )
            if payment.failure_stage() == "not_found":
                return ReconcileResult(payment, "already_processed")
            previous = {"status": payment.status, "stage": payment.failure_stage()}
            raw = dict(payment.gateway_raw if isinstance(payment.gateway_raw, dict) else {})
            raw["staff_note"] = note
            payment.gateway_raw = raw
            # The AES key stays: a genuine answer that still arrives decrypts and
            # is credited (``not_found`` is a soft stage).
            payment.mark_failed(f"No aparece en MultiCobros: {note}", stage="not_found")
            fail_online_topup(payment)
            record(
                "update",
                payment,
                {"banorte_reconciled": "not_found", "previous": previous, "note": note},
                actor=actor,
                context="payments.banorte.reconcile",
            )
    if previous["stage"] == "bank_timeout":
        # That family was told «el banco no confirmó: no vuelva a pagar, le
        # avisaremos» (``notify_topup_result``): tell them it was not charged.
        try:
            from apps.cafeteria.services import notify_topup_not_charged

            notify_topup_not_charged(payment)
        except Exception:  # a notice never undoes the reconciliation
            logger.exception("not-charged notice failed for payment %s", payment.pk)
    return ReconcileResult(payment, "closed")


# ── Verificar en MultiCobros ─────────────────────────────────


def checkout_for_verify(pk):
    """The checkout of payment ``pk``, row-locked for «Verificar en MultiCobros».

    Locks the checkout and its payment only. ``verified_by`` is empty until
    someone verifies, so it is a LEFT JOIN, and PostgreSQL refuses FOR UPDATE
    on the nullable side of an outer join: until 2026-11-18 every verification
    was a 500 in production (SQLite, which the tests use, ignores row locks).
    """
    return (
        BanorteCheckout.objects.select_for_update(of=("self", "payment"))
        .select_related("payment", "verified_by")
        .filter(payment_id=pk)
    )


class VerifyError(ValueError):
    """A verification the server refuses. ``status`` is the HTTP status; a
    ``code`` of ``None`` answers without one (the dialog's oldest message)."""

    def __init__(self, message: str, *, status: int = 400, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


@dataclass
class VerifyResult:
    checkout: BanorteCheckout
    payment: Payment
    newly_verified: bool  # False: it was already verified (idempotent)


def same_auth_code(ours, theirs) -> bool:
    """Payworks authorization codes compared as MultiCobros shows them: case,
    spaces and leading zeros ignored (a spreadsheet drops "012345"'s zero)."""

    def norm(value):
        return str(value or "").strip().upper().lstrip("0")

    return norm(ours) == norm(theirs)


def verify_approval(
    payment_id, *, referencia, amount, actor, codigo_aut=None, via: str = ""
) -> VerifyResult:
    """«Verificar en MultiCobros»: staff saw this credited approval in MultiCobros.

    Under the ``checkout_for_verify`` row lock: only an approved (Payworks A),
    credited (SUCCESS) operation is verified, and only when the referencia and
    the amount MultiCobros shows equal ours (and the authorization code, when
    the caller read one and we stored one). Sets ``verified_at``/``verified_by``
    and audits it once; already verified is a no-op (``newly_verified=False``).
    Raises ``VerifyError`` (nothing written) otherwise. Moves no money: the
    caller runs ``apply_verified`` after this has committed.
    """
    from apps.core.audit import record

    referencia = str(referencia or "").strip()
    amount = parse_amount(amount)
    with transaction.atomic():
        checkout = checkout_for_verify(payment_id).first()
        if checkout is None:
            raise VerifyError("Pago no encontrado.", status=404, code="payment_not_found")
        payment = checkout.payment
        if checkout.verified_at is not None:
            return VerifyResult(checkout, payment, False)
        if checkout.resultado_payw != BanorteCheckout.Result.APPROVED:
            raise VerifyError("Solo se verifican operaciones aprobadas.")
        if payment.status != Payment.Status.SUCCESS:
            raise VerifyError(
                "Solo se verifican pagos acreditados (este está "
                f"«{payment.get_status_display()}»).",
                code="not_success",
            )
        if not referencia or referencia != checkout.referencia:
            raise VerifyError(
                "La referencia no coincide con la de este pago. Revise que buscó el "
                "número de control correcto en MultiCobros.",
                code="reference_mismatch",
            )
        if amount is None or amount != payment.amount:
            raise VerifyError(
                f"El monto no coincide con el del pago (${payment.amount:.2f}). "
                "No lo cargue en el POS y avise a dirección.",
                code="amount_mismatch",
            )
        if (
            codigo_aut is not None
            and checkout.codigo_aut
            and not same_auth_code(checkout.codigo_aut, codigo_aut)
        ):
            raise VerifyError(
                "El número de autorización no coincide con el de este pago. "
                "No lo cargue en el POS y avise a dirección.",
                code="auth_code_mismatch",
            )
        checkout.verified_at = timezone.now()
        checkout.verified_by = actor
        checkout.save(update_fields=["verified_at", "verified_by"])
        changes = {
            "banorte_verified": True,
            "referencia": checkout.referencia,
            "amount": f"{payment.amount:.2f}",
        }
        if via:
            changes["via"] = via
        record("update", payment, changes, actor=actor, context="payments.banorte.verify")
    return VerifyResult(checkout, payment, True)


def apply_verified(payment, *, quick_read: bool = False) -> dict:
    """After a verification committed: apply the top-up now when Loyverse already
    holds it (``cafeteria.services.apply_after_verification``, the POS mirror's
    own path). Never raises: a failure leaves it for the next sync
    (``pos_unknown``). ``quick_read`` reads Loyverse in one short attempt (the
    report upload applies many in one request)."""
    applied = {"apply_state": "not_applicable", "balance": None}
    if payment.status == Payment.Status.SUCCESS and payment.related_topup_id:
        from apps.cafeteria.services import apply_after_verification

        try:
            if quick_read:
                applied = apply_after_verification(payment, quick_read=True)
            else:
                applied = apply_after_verification(payment)
        except Exception:  # noqa: BLE001 (the verification itself stands)
            logger.exception("apply after verification failed payment=%s", payment.pk)
            applied = {"apply_state": "pos_unknown", "balance": None}
    return applied


def forget_badges(user) -> None:
    """«Por verificar» just changed: the console refetches the badges now, so
    the 30 s cache of whoever verified must not answer the old count."""
    from django.core.cache import cache

    from apps.core.badges import BADGE_CACHE_KEY

    cache.delete(BADGE_CACHE_KEY.format(pk=getattr(user, "pk", 0)))


# ── POS and refunds ──────────────────────────────────────────


def online_topups_awaiting_staff():
    """Real-money (PRD) online top-ups staff still have to work: paid and waiting
    to be loaded into the Loyverse POS and applied (scheduled mode), or credited
    locally and still to verify in MultiCobros and/or load into the POS."""
    from apps.cafeteria.models import TopUpRequest

    return TopUpRequest.objects.filter(
        Q(status=TopUpRequest.Status.PAID)
        | Q(status=TopUpRequest.Status.COMPLETED, pos_loaded_at__isnull=True),
        method=TopUpRequest.Method.ONLINE,
        payments__status=Payment.Status.SUCCESS,
        payments__banorte__mode="PRD",
    ).distinct()


def paid_topups_awaiting_verification():
    """PAID card top-ups whose real (PRD) approval staff have not matched in
    MultiCobros yet: nothing puts them in the wallet until someone verifies
    them, not even the POS mirror. The console's «Por verificar» badge and the
    dashboard card count these; same rule as ``Payment.needs_bank_verification``."""
    from apps.cafeteria.services import paid_topups_pending

    return (
        paid_topups_pending()
        .filter(
            payments__status=Payment.Status.SUCCESS,
            payments__banorte__mode="PRD",
            payments__banorte__resultado_payw=BanorteCheckout.Result.APPROVED,
            payments__banorte__verified_at__isnull=True,
        )
        .distinct()
    )


def simulated_topup_ids():
    """``TopUpRequest`` ids paid in a Payworks simulation (subquery): never loaded into the POS."""
    return (
        BanorteCheckout.objects.exclude(mode="PRD")
        .filter(payment__related_topup__isnull=False)
        .values("payment__related_topup_id")
    )


_TOPUP_REF_RE = re.compile(r"^topup-payment-(\d+)$")


def card_payment_for_transaction(tx) -> Payment | None:
    """The card payment behind an online top-up ledger row (``topup-payment-<id>``)."""
    m = _TOPUP_REF_RE.match(getattr(tx, "loyverse_receipt_id", "") or "")
    if not m:
        return None
    return Payment.objects.select_related("banorte").filter(pk=int(m.group(1))).first()


def needs_bank_refund(payment: Payment | None) -> bool:
    """Reversing this top-up in the wallet leaves a real card charge to refund in MultiCobros."""
    return bool(
        payment is not None
        and payment.status == Payment.Status.SUCCESS
        and not payment.is_simulation()
    )
