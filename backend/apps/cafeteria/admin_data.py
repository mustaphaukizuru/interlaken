"""
cafeteria/admin_data.py: the admin Cafetería lists on the Data Ops contracts (Phase 6).

Every admin list of the Cafetería console lives here, on the shared contracts
of ``apps.core``: ``AdminListMixin`` (``q``, whitelisted ``ordering`` with the
``-pk`` tiebreak, FilterSet, ``page_size`` ≤ 100), an export sibling per list
(``AdminExportMixin``: CSV / XLSX / PDF honouring the same filters, audited),
the bulk endpoints (``AdminBulkView``) and the "Ajuste masivo" import
(``ImportView``). The per-row money work goes through the existing services
(``adjust_balance``, ``add_points_to_customer``) so the ledger invariants
(no negative balance, idempotent top-up reference, one ``BalanceAdjustment``
per movement, audit rows) are the ones the single-row endpoints already keep.

Endpoints (all under ``/api/v1/cafeteria/admin/``, ``IsAdmin``):

* ``balances/`` (+ ``export/``, ``bulk/`` sync | set_threshold, ``import/`` and
  ``import/template/`` for the ajuste masivo)
* ``transactions/`` (+ ``export/``): every student's ledger
* ``adjustments/``: the manual adjustment / refund trail (per-student console)
* ``topups/`` (+ ``export/``, ``bulk/`` apply | pos_loaded | pos_unloaded)
* ``low-balance/`` (+ ``export/``)
* ``customers/`` (+ ``export/``)
* ``reconcile/`` (+ ``export/``, ``bulk/`` fix)

Tests never reach Loyverse: every remote call goes through
``apps.cafeteria.services`` (patched in the tests; the token is blank there).
"""

from __future__ import annotations

import dataclasses
import hashlib
import logging
from datetime import timedelta
from decimal import Decimal

import django_filters
from django.db import models
from django.db.models import Count, Q, Sum
from django.utils import timezone
from django_filters.widgets import BooleanWidget
from rest_framework import generics, serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.models import StudentProfile
from apps.core.audit import record_export
from apps.core.bulk import AdminBulkView, BulkAction, BulkSkip
from apps.core.exceptions import error_response
from apps.core.exporting import (
    AdminExportMixin,
    Col,
    ExportSpec,
    collect_rows,
    parse_fmt,
    parse_ids,
    render_export,
)
from apps.core.importing import (
    ImportCol,
    ImportSpec,
    ImportTemplateView,
    ImportView,
    parse_decimal,
    truthy,
)
from apps.core.listing import (
    AdminListMixin,
    ListPagination,
    apply_date_range,
    search_lookup,
    split_terms,
)
from apps.core.matricula import normalize_matricula, search_key
from apps.core.throttling import SharedScopedRateThrottle
from apps.core.transitions import assert_transition

from . import services
from .models import (
    BalanceAdjustment,
    CafeteriaBalance,
    CafeteriaTransaction,
    LoyverseProfile,
    TopUpRequest,
    UnmatchedReceipt,
)
from .serializers import (
    BalanceAdjustmentSerializer,
    CafeteriaBalanceSerializer,
    CafeteriaTransactionSerializer,
    LowBalanceThresholdSerializer,
    LoyverseCustomerSerializer,
    TopUpLogSerializer,
)

logger = logging.getLogger(__name__)

STUDENT_NAME = ("student__user__last_name", "student__user__first_name")


# ── search ────────────────────────────────────────────────
def terms_q(raw: str, *, text=(), codes=(), extra=None) -> Q | None:
    """AND over the typed terms of an OR over ``text`` and ``codes`` fields.

    ``text`` fields match the term as typed (names, descriptions, emails);
    ``codes`` fields match the matrícula key too, so the Loyverse spelling
    ``ci09932`` and the stored digits ``09932`` find the same student
    (``apps.core.matricula.search_key``). ``extra(term)`` adds an OR clause
    (a subquery for guardian emails, which would duplicate rows as a join).
    """
    combined = None
    for term in split_terms(raw):
        key = search_key(term)
        q = Q()
        for field in text:
            q |= Q(**{search_lookup(field): term})
        for field in codes:
            q |= Q(**{search_lookup(field): key})
            if key != term:
                q |= Q(**{search_lookup(field): term})
        extra_q = extra(term) if extra is not None else None
        if extra_q is not None:
            q |= extra_q
        combined = q if combined is None else combined & q
    return combined


class CodeSearchMixin:
    """``AdminListMixin.apply_search`` with text/code fields and an ``extra`` hook."""

    search_text_fields: tuple[str, ...] = ()
    search_code_fields: tuple[str, ...] = ()

    def search_extra(self, term: str) -> Q | None:
        return None

    def apply_search(self, qs):
        q = terms_q(
            self.get_search_term(),
            text=self.search_text_fields,
            codes=self.search_code_fields,
            extra=self.search_extra,
        )
        return qs.filter(q) if q is not None else qs


class DateRangeMixin:
    """``?from=&to=`` (inclusive ISO dates) as aware bounds on ``date_field``."""

    date_field: str = ""

    def apply_filterset(self, qs):
        qs = super().apply_filterset(qs)
        if self.date_field:
            params = self.request.query_params
            qs = apply_date_range(qs, self.date_field, params.get("from"), params.get("to"))
        return qs


def guardian_email_q(student_field: str):
    """``student_field in (students whose guardian email contains term)`` as a subquery."""

    def extra(term: str) -> Q:
        ids = StudentProfile.objects.filter(**{search_lookup("parents__email"): term}).values("pk")
        return Q(**{f"{student_field}__in": ids})

    return extra


def loyverse_code(student) -> str:
    """The matrícula as Loyverse spells it (``ci09932``); ``student_id`` otherwise."""
    profile = getattr(student, "loyverse_profile", None)
    if profile is not None and profile.customer_code:
        return profile.customer_code
    return student.student_id


def _safe_balance(student):
    try:
        return student.cafeteria_balance
    except CafeteriaBalance.DoesNotExist:
        return None


# ── filters ───────────────────────────────────────────────
class BalanceFilter(django_filters.FilterSet):
    """``grade``, ``group``, ``status`` (student lifecycle), ``low_balance``, ``unlinked``."""

    grade = django_filters.CharFilter(field_name="student__grade")
    group = django_filters.CharFilter(field_name="student__group", lookup_expr="iexact")
    status = django_filters.ChoiceFilter(
        field_name="student__status", choices=StudentProfile.Status.choices
    )
    low_balance = django_filters.BooleanFilter(method="filter_low_balance", widget=BooleanWidget)
    unlinked = django_filters.BooleanFilter(method="filter_unlinked", widget=BooleanWidget)

    class Meta:
        model = CafeteriaBalance
        fields: list[str] = []

    def filter_low_balance(self, qs, name, value):
        if value is None:
            return qs
        low = Q(balance__lte=models.F("low_balance_threshold"))
        return qs.filter(low) if value else qs.exclude(low)

    def filter_unlinked(self, qs, name, value):
        if value is None:
            return qs
        return qs.filter(student__loyverse_id="") if value else qs.exclude(student__loyverse_id="")


class StudentFilter(django_filters.FilterSet):
    grade = django_filters.CharFilter(field_name="grade")
    group = django_filters.CharFilter(field_name="group", lookup_expr="iexact")

    class Meta:
        model = StudentProfile
        fields: list[str] = []


class TransactionFilter(django_filters.FilterSet):
    type = django_filters.ChoiceFilter(
        field_name="transaction_type", choices=CafeteriaTransaction.TxType.choices
    )
    student = django_filters.NumberFilter(field_name="student_id")

    class Meta:
        model = CafeteriaTransaction
        fields: list[str] = []


class AdjustmentFilter(django_filters.FilterSet):
    student = django_filters.NumberFilter(field_name="student_id")
    kind = django_filters.ChoiceFilter(choices=BalanceAdjustment.Kind.choices)

    class Meta:
        model = BalanceAdjustment
        fields: list[str] = []


class TopUpFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=TopUpRequest.Status.choices)
    method = django_filters.ChoiceFilter(choices=TopUpRequest.Method.choices)
    student = django_filters.NumberFilter(field_name="student_id")
    needs_pos = django_filters.BooleanFilter(method="filter_needs_pos", widget=BooleanWidget)
    needs_unload = django_filters.BooleanFilter(method="filter_needs_unload", widget=BooleanWidget)
    needs_review = django_filters.BooleanFilter(method="filter_needs_review", widget=BooleanWidget)
    needs_apply = django_filters.BooleanFilter(method="filter_needs_apply", widget=BooleanWidget)
    applied_on = django_filters.DateFilter(method="filter_applied_on")

    class Meta:
        model = TopUpRequest
        fields: list[str] = []

    def filter_applied_on(self, qs, name, value):
        """Card top-ups that reached the wallet on ``value`` (school day): the
        "Aplicadas hoy" list staff check against what they typed into the POS."""
        if not value:
            return qs
        from apps.core.listing import day_end_exclusive, day_start

        return qs.filter(
            method=TopUpRequest.Method.ONLINE,
            applied_at__gte=day_start(value),
            applied_at__lt=day_end_exclusive(value),
        ).exclude(applied_via=TopUpRequest.AppliedVia.INSTANT)

    def filter_needs_apply(self, qs, name, value):
        """Paid online top-ups waiting to be loaded into the POS and applied
        (scheduled apply mode); refunded payments excluded."""
        if not value:
            return qs
        return qs.filter(pk__in=services.paid_topups_pending().values("pk"))

    def filter_needs_pos(self, qs, name, value):
        """Paid online, credited locally, not yet loaded into the POS (refunds and
        Payworks simulations excluded: a simulated approval moved no money)."""
        if not value:
            return qs
        from apps.payments.models import Payment
        from apps.payments.multicobros import simulated_topup_ids

        return (
            qs.filter(
                method=TopUpRequest.Method.ONLINE,
                status=TopUpRequest.Status.COMPLETED,
                pos_loaded_at__isnull=True,
            )
            .exclude(payments__status=Payment.Status.REFUNDED)
            .exclude(pk__in=simulated_topup_ids())
            .distinct()
        )

    def filter_needs_review(self, qs, name, value):
        """Card attempts staff must look up in MultiCobros ("Conciliar con MultiCobros")."""
        if not value:
            return qs
        from apps.payments.models import Payment
        from apps.payments.multicobros import needs_review_q

        return qs.filter(
            pk__in=Payment.objects.filter(needs_review_q()).values("related_topup_id")
        )

    def filter_needs_unload(self, qs, name, value):
        """Loaded into the POS, then refunded: staff must remove the credit."""
        if not value:
            return qs
        return qs.filter(pos_unload_needed_at__isnull=False, pos_unloaded_at__isnull=True)


class CustomerFilter(django_filters.FilterSet):
    """``kind`` (student|staff|test|other, or ``nonstudent``) and ``missing``."""

    kind = django_filters.CharFilter(method="filter_kind")
    missing = django_filters.BooleanFilter(method="filter_missing", widget=BooleanWidget)

    class Meta:
        model = LoyverseProfile
        fields: list[str] = []

    def filter_kind(self, qs, name, value):
        value = (value or "").strip()
        if value == "nonstudent":
            return qs.exclude(kind=LoyverseProfile.Kind.STUDENT)
        if value in LoyverseProfile.Kind.values:
            return qs.filter(kind=value)
        return qs  # an unknown kind shows the whole store (old behaviour)

    def filter_missing(self, qs, name, value):
        if value is None:
            return qs
        return qs.filter(missing_since__isnull=not value)


# ── ordering whitelists (docs/API-LISTING.md; the frontend sortKeys match) ──
BALANCE_ORDERING = {
    "student": STUDENT_NAME,
    "grade": ("student__grade", "student__group"),
    "balance": "balance",
    "last_synced": "last_synced",
    "threshold": "low_balance_threshold",
}
TRANSACTION_ORDERING = {
    "date": "date",
    "amount": "amount",
    "type": "transaction_type",
    "balance": "balance_after",
    "student": STUDENT_NAME,
}
ADJUSTMENT_ORDERING = {"date": "created_at", "amount": "amount", "kind": "kind"}
TOPUP_ORDERING = {
    "created_at": "created_at",
    "apply_due_at": "apply_due_at",
    "applied_at": "applied_at",
    "amount": "amount",
    "status": "status",
    "method": "method",
    "student": STUDENT_NAME,
}
LOW_BALANCE_ORDERING = BALANCE_ORDERING
CUSTOMER_ORDERING = {
    "name": "name",
    "code": "customer_code",
    "kind": "kind",
    "points": "total_points",
    "visits": "total_visits",
    "spent": "total_spent",
    "last_visit": "last_visit",
}
RECONCILE_ORDERING = {
    "student": ("user__last_name", "user__first_name"),
    "matricula": "student_id",
    "grade": ("grade", "group"),
    "local_balance": "cafeteria_balance__balance",
}


# ── export specs ──────────────────────────────────────────
def _balance_cols() -> list[Col]:
    return [
        Col("student__user__full_name", "Alumno", width=30),
        Col("student__student_id", "Matrícula", width=12, fmt="text"),
        Col(
            "loyverse_code", "Código Loyverse", getter=lambda b: loyverse_code(b.student), width=14
        ),
        Col("student__grade", "Grado", width=14),
        Col("student__group", "Grupo", width=6),
        Col("status", "Estado", getter=lambda b: b.student.get_status_display(), width=14),
        Col("balance", "Saldo", width=11, fmt="money"),
        Col("low_balance_threshold", "Umbral", width=10, fmt="money"),
        Col("is_low_balance", "Saldo bajo", width=10, fmt="bool"),
        Col("last_synced", "Últ. sinc.", width=17, fmt="datetime"),
    ]


BALANCE_EXPORT = ExportSpec(
    filename_prefix="saldos_cafeteria",
    columns=_balance_cols(),
    audit_entity="cafeteria.balances",
    title="Saldos de cafetería",
    sheet_title="Saldos",
)
LOW_BALANCE_EXPORT = ExportSpec(
    filename_prefix="saldo_bajo_cafeteria",
    columns=_balance_cols(),
    audit_entity="cafeteria.low_balance",
    title="Saldo bajo en cafetería",
    sheet_title="Saldo bajo",
)
TRANSACTION_EXPORT = ExportSpec(
    filename_prefix="movimientos_cafeteria",
    columns=[
        Col("date", "Fecha", width=17, fmt="datetime"),
        Col("student__user__full_name", "Alumno", width=28),
        Col("student__student_id", "Matrícula", width=12, fmt="text"),
        Col(
            "transaction_type", "Tipo", getter=lambda t: t.get_transaction_type_display(), width=11
        ),
        Col("description", "Descripción", width=34),
        Col("amount", "Monto", width=11, fmt="money"),
        Col("balance_after", "Saldo", width=11, fmt="money"),
        Col("loyverse_receipt_id", "Recibo", width=22, fmt="text"),
    ],
    audit_entity="cafeteria.transactions",
    title="Movimientos de cafetería",
    sheet_title="Movimientos",
)


def _loyverse_code(topup) -> str:
    profile = getattr(topup.student, "loyverse_profile", None)
    return (profile.customer_code if profile else "") or ""


def _first_payment(topup):
    if not hasattr(topup, "_cached_payment"):
        topup._cached_payment = next(iter(topup.payments.all()), None)
    return topup._cached_payment


def _pos_state(topup) -> str:
    if topup.status == TopUpRequest.Status.PAID:
        return "Por cargar y aplicar"
    if topup.pos_unload_needed_at and not topup.pos_unloaded_at:
        return "Quitar del POS"
    if topup.pos_unloaded_at:
        return "Quitado del POS"
    if topup.pos_loaded_at:
        return "En POS"
    if topup.method == TopUpRequest.Method.ONLINE and topup.status == TopUpRequest.Status.COMPLETED:
        payment = _first_payment(topup)
        if payment is not None and payment.is_simulation():
            return "Simulación (no cargar)"
        return "Pendiente POS"
    return ""


TOPUP_EXPORT = ExportSpec(
    filename_prefix="depositos_cafeteria",
    columns=[
        Col("created_at", "Fecha", width=17, fmt="datetime"),
        Col("student__user__full_name", "Alumno", width=28),
        Col("student__student_id", "Matrícula", width=12, fmt="text"),
        Col("amount", "Monto", width=11, fmt="money"),
        Col("method", "Método", getter=lambda t: t.get_method_display(), width=14),
        Col("status", "Estado", getter=lambda t: t.get_status_display(), width=12),
        Col(
            "gateway",
            "Pasarela",
            getter=lambda t: (_first_payment(t).gateway if _first_payment(t) else ""),
            width=14,
        ),
        Col(
            "reference",
            "Referencia",
            getter=lambda t: t.payment_ref
            or ((_first_payment(t).gateway_tx_id or "") if _first_payment(t) else ""),
            width=22,
            fmt="text",
        ),
        Col("pos", "POS", getter=_pos_state, width=14),
        Col("processed_at", "Procesada", width=17, fmt="datetime"),
        Col(
            "folio",
            "Folio",
            getter=lambda t: (str(_first_payment(t).pk) if _first_payment(t) else ""),
            width=9,
            fmt="text",
        ),
        Col(
            "loyverse_code",
            "Cliente Loyverse",
            getter=lambda t: _loyverse_code(t),
            width=14,
            fmt="text",
        ),
        Col("apply_due_at", "Se aplica", width=17, fmt="datetime"),
        Col("applied_at", "Aplicada", width=17, fmt="datetime"),
        Col(
            "applied_via",
            "Aplicada por",
            getter=lambda t: t.get_applied_via_display() if t.applied_via else "",
            width=18,
        ),
    ],
    audit_entity="cafeteria.topups",
    title="Depósitos de cafetería",
    sheet_title="Depósitos",
)
CUSTOMER_EXPORT = ExportSpec(
    filename_prefix="clientes_loyverse",
    columns=[
        Col("name", "Nombre", width=28),
        Col("customer_code", "Código", width=12, fmt="text"),
        Col("kind", "Tipo", getter=lambda c: c.get_kind_display(), width=10),
        Col("email", "Correo", width=26),
        Col("phone_number", "Teléfono", width=14, fmt="text"),
        Col("total_points", "Saldo", width=11, fmt="money"),
        Col("total_visits", "Visitas", width=8, fmt="int"),
        Col("total_spent", "Gasto total", width=12, fmt="money"),
        Col("last_visit", "Última visita", width=17, fmt="datetime"),
        Col(
            "student",
            "Alumno",
            getter=lambda c: c.student.user.full_name if c.student_id else "",
            width=26,
        ),
        Col(
            "missing",
            "En Loyverse",
            getter=lambda c: "Eliminado" if c.missing_since else "Activo",
            width=11,
        ),
    ],
    audit_entity="cafeteria.customers",
    title="Clientes de Loyverse",
    sheet_title="Clientes",
)
RECONCILE_EXPORT = ExportSpec(
    filename_prefix="reconciliacion_cafeteria",
    columns=[
        Col("student_name", "Alumno", width=28),
        Col("student_code", "Matrícula", width=12, fmt="text"),
        Col("local_balance", "Saldo local", width=12, fmt="money"),
        Col("loyverse_balance", "Loyverse", width=12, fmt="money"),
        Col("drift", "Diferencia", width=12, fmt="money"),
        Col(
            "estado",
            "Estado",
            getter=lambda r: (
                "Error" if r["error"] else ("En orden" if r["in_sync"] else "Diferencia")
            ),
            width=11,
        ),
        Col("error", "Detalle", width=30),
    ],
    audit_entity="cafeteria.reconcile",
    title="Reconciliación con Loyverse",
    sheet_title="Reconciliación",
)


# ── balances ──────────────────────────────────────────────
class AdminBalancesView(CodeSearchMixin, AdminListMixin, generics.ListAPIView):
    """GET /api/v1/cafeteria/admin/balances/?q=&grade=&group=&status=&low_balance=&unlinked=&ordering=

    ``q`` searches the whole roster server-side: student names, the canonical
    matrícula and the Loyverse code (``09932`` and ``ci09932`` find the same
    wallet) and guardian emails. Default order: student name.
    """
    admin_area = 'cafeteria'

    serializer_class = CafeteriaBalanceSerializer
    filterset_class = BalanceFilter
    ordering = BALANCE_ORDERING
    default_ordering = STUDENT_NAME
    search_text_fields = ("student__user__first_name", "student__user__last_name")
    search_code_fields = ("student__student_id", "student__loyverse_profile__customer_code")

    def search_extra(self, term):
        return guardian_email_q("student")(term)

    def get_queryset(self):
        return CafeteriaBalance.objects.select_related("student__user", "student__loyverse_profile")


class AdminBalancesExportView(AdminExportMixin, AdminBalancesView):
    """GET .../admin/balances/export/?fmt=csv|xlsx|pdf&ids=&…same filters…"""
    admin_area = 'cafeteria'

    export_spec = BALANCE_EXPORT


def _sync_plan(balance, payload):
    if not balance.student.loyverse_id:
        raise BulkSkip("el alumno no está vinculado a Loyverse")


def _sync_handler(balance, payload, actor):
    _sync_plan(balance, payload)
    was_seeded = balance.last_synced is not None
    try:
        new_balance = services.sync_student_balance(balance.student)
    except services.LoyverseError as exc:
        raise ValueError(f"Loyverse: {exc}") from None
    return {"seeded": not was_seeded, "balance": str(new_balance)}


def _sync_after(balances, payload, actor):
    """One receipts poll for the whole batch (the per-row seed is local-first)."""
    try:
        services.sync_purchases()
    except Exception:  # a failed poll never undoes the seeded rows
        logger.exception("bulk sync: sync_purchases failed")


def _threshold_value(payload) -> Decimal:
    return Decimal(str(payload.get("threshold"))).quantize(Decimal("0.01"))


def _threshold_plan(balance, payload):
    if balance.low_balance_threshold == _threshold_value(payload):
        raise BulkSkip("ya tiene ese umbral")


def _threshold_handler(balance, payload, actor):
    _threshold_plan(balance, payload)
    old = balance.low_balance_threshold
    balance.low_balance_threshold = _threshold_value(payload)
    balance.save(update_fields=["low_balance_threshold"])
    return {"low_balance_threshold": [str(old), str(balance.low_balance_threshold)]}


BALANCE_ACTIONS = {
    a.name: a
    for a in (
        BulkAction(
            name="sync",
            label_es="Sincronizar",
            handler=_sync_handler,
            plan=_sync_plan,
            side_effects="batched",
            after=_sync_after,
        ),
        BulkAction(
            name="set_threshold",
            label_es="Cambiar umbral",
            handler=_threshold_handler,
            plan=_threshold_plan,
            side_effects="none",
        ),
    )
}


class AdminBalancesBulkView(AdminBulkView):
    """POST .../admin/balances/bulk/  actions ``sync`` and ``set_threshold`` (payload.threshold)."""
    admin_area = 'cafeteria'

    entity = "cafeteria.cafeteriabalance"
    list_view_class = AdminBalancesView
    actions = BALANCE_ACTIONS

    def get_queryset(self):
        return CafeteriaBalance.objects.select_related("student__user")

    def post(self, request):
        if request.data.get("action") == "set_threshold":
            payload = request.data.get("payload") or {}
            threshold = payload.get("threshold") if isinstance(payload, dict) else None
            LowBalanceThresholdSerializer(data={"threshold": threshold}).is_valid(
                raise_exception=True
            )
        return super().post(request)


# ── ajuste masivo (import, C4) ────────────────────────────
ADJUSTMENT_MAX_ROWS = 500
ADJUSTMENT_MAX_AMOUNT = Decimal("10000.00")
DUPLICATE_WINDOW = timedelta(hours=24)


def _parse_matricula(value) -> str:
    code = normalize_matricula(str(value or ""))
    if not code:
        raise ValueError("vacía")
    return code


def _max_len(limit):
    def check(value, data):
        return f"máximo {limit} caracteres" if len(str(value or "")) > limit else None

    return check


def adjustment_reference(file_hash: str, student_pk: int) -> str:
    """Ledger key of one ajuste masivo row: the same file (byte for byte) can
    credit or debit each student once, however many times it is committed."""
    return f"adjust-tx-imp-{file_hash[:24]}-{student_pk}"


def _store_points() -> dict[str, Decimal]:
    """Loyverse points per customer id for the debit guard: one store-wide
    fetch (2 pages), else the profile snapshots the POS mirror refreshes."""
    try:
        return {
            c.get("id"): services.get_balance_from_customer(c)
            for c in services.get_all_customers()
        }
    except services.LoyverseError as exc:
        logger.warning("ajuste masivo: Loyverse unreachable (%s); using profile snapshots", exc)
        return dict(
            LoyverseProfile.objects.filter(missing_since__isnull=True).values_list(
                "loyverse_id", "total_points"
            )
        )


def build_adjustment_spec(*, notify: bool = True, file_hash: str = "") -> ImportSpec:
    """``matricula, monto, motivo`` → one audited ``adjust_balance`` per row.

    The dry-run is the commit's own check: the student must exist, the amount
    must be non-zero and at most $10,000, the resulting balance must not be
    negative and a debit must pass ``check_pos_debit`` (``adjust_balance``
    re-checks both under the row lock at commit). A student appears once per
    file (in-file duplicates block). An identical adjustment in the last 24 h
    is flagged as a possible re-upload.

    ``file_hash`` (sha256 of the uploaded bytes) keys every row in the ledger
    (``adjustment_reference``): committing the same file again skips the rows
    already applied (``omitir``) instead of doubling them. Loyverse is read once
    per request, before any row lock, and families are notified only after the
    import transaction commits.
    """
    cache: dict = {}

    def roster() -> dict[str, StudentProfile]:
        if "roster" not in cache:
            cache["roster"] = {
                s.student_id: s
                for s in StudentProfile.objects.select_related("user", "cafeteria_balance")
            }
        return cache["roster"]

    def recent() -> set[tuple[int, Decimal, str]]:
        if "recent" not in cache:
            since = timezone.now() - DUPLICATE_WINDOW
            cache["recent"] = {
                (a.student_id, a.amount, (a.reason or "").strip().lower())
                for a in BalanceAdjustment.objects.filter(
                    kind=BalanceAdjustment.Kind.ADJUSTMENT, created_at__gte=since
                ).only("student_id", "amount", "reason")
            }
        return cache["recent"]

    def points_for(student):
        if not student.loyverse_id:
            return None
        if "points" not in cache:
            cache["points"] = _store_points()
        value = cache["points"].get(student.loyverse_id)
        return None if value is None else Decimal(str(value))

    def validate_row(data, row):
        if row.errors:
            return
        student = roster().get(data["matricula"])
        if student is None:
            row.error(f'Matrícula {data["matricula"]}: no existe ningún alumno con esa matrícula.')
            return
        amount = data["monto"]
        if amount == 0:
            row.error("Monto: no puede ser cero.")
        elif abs(amount) > ADJUSTMENT_MAX_AMOUNT:
            row.error(f"Monto: el máximo por ajuste es ${ADJUSTMENT_MAX_AMOUNT:,.2f}.")
        balance = _safe_balance(student)
        current = balance.balance if balance is not None else Decimal("0.00")
        resulting = current + amount
        data["alumno_id"] = student.pk
        data["alumno"] = student.user.full_name
        data["saldo_actual"] = current
        data["saldo_resultante"] = resulting
        if resulting < 0:
            row.error(
                f"El ajuste dejaría el saldo en ${resulting:,.2f}; no se permite un saldo "
                f"negativo (saldo actual ${current:,.2f})."
            )
        elif amount < 0:
            try:
                services.check_pos_debit(student, resulting, points_for(student))
            except services.PosDebitBlocked as exc:
                row.error(str(exc))
        if student.status != StudentProfile.Status.ACTIVE:
            row.warn(f"El alumno está en estado «{student.get_status_display()}».")
        motive = str(data.get("motivo") or "").strip().lower()
        if (student.pk, amount, motive) in recent():
            row.warn("Ya existe un ajuste igual en las últimas 24 h (¿archivo repetido?).")

    def already_applied(data, instance):
        if not file_hash or not data.get("alumno_id"):
            return None
        ref = adjustment_reference(file_hash, data["alumno_id"])
        if CafeteriaTransaction.objects.filter(loyverse_receipt_id=ref).exists():
            return "Ya aplicado: este mismo archivo se importó antes; la fila se omite."
        return None

    def create(data, actor):
        student = StudentProfile.objects.select_related("user").get(pk=data["alumno_id"])
        return services.adjust_balance(
            student,
            data["monto"],
            data["motivo"],
            admin=actor,
            notify=notify,
            reference=adjustment_reference(file_hash, student.pk) if file_hash else "",
            # The points the dry-run checked: no network call under the import's
            # transaction (and its row locks). adjust_balance re-checks them.
            pos_points=points_for(student) if data["monto"] < 0 else None,
        )

    return ImportSpec(
        entity="ajustes_cafeteria",
        label="Ajuste masivo de saldos",
        columns=[
            ImportCol(
                "matricula",
                ("matrícula", "codigo", "código", "codigo_loyverse", "student_id", "alumno"),
                required=True,
                parse=_parse_matricula,
                example="09932",
            ),
            ImportCol(
                "monto",
                ("importe", "cantidad", "amount", "ajuste"),
                required=True,
                parse=parse_decimal,
                example="150.00",
            ),
            ImportCol(
                "motivo",
                ("razon", "razón", "reason", "concepto"),
                required=True,
                validators=(_max_len(500),),
                example="Beca de alimentos de septiembre",
            ),
        ],
        dedupe_keys=[("matricula",)],
        validate_row=validate_row,
        # Every row is new (crear); db_match only exists so skip_reason can
        # turn a row this file already applied into "omitir".
        db_match=lambda data: None,
        skip_reason=already_applied,
        create=create,
        key_of=lambda data: data.get("matricula") or "",
        max_rows=ADJUSTMENT_MAX_ROWS,
    )


ADJUSTMENT_TEMPLATE_URL = "/api/v1/cafeteria/admin/balances/import/template/"


class AdminAdjustmentImportView(ImportView):
    """POST .../admin/balances/import/  multipart ``file`` + ``dry_run`` + ``notify``.

    ``notify`` (default on) tells the families, after the import commits.
    Re-committing the same file skips the rows it already applied. Cap 500
    rows. (``mirror`` is no longer read: Loyverse points cannot be written.)
    """
    admin_area = 'cafeteria'

    template_url = ADJUSTMENT_TEMPLATE_URL

    def get_spec(self):
        data = self.request.data
        return build_adjustment_spec(
            notify=truthy(data.get("notify"), True), file_hash=self._file_hash()
        )

    def _file_hash(self) -> str:
        upload = self.request.FILES.get("file")
        if upload is None:
            return ""
        digest = hashlib.sha256()
        for chunk in upload.chunks():
            digest.update(chunk)
        upload.seek(0)
        return digest.hexdigest()


class AdminAdjustmentTemplateView(ImportTemplateView):
    """GET .../admin/balances/import/template/?fmt=csv|xlsx"""
    admin_area = 'cafeteria'

    spec = build_adjustment_spec()


# ── transactions + adjustments ────────────────────────────
class AdminTransactionSerializer(CafeteriaTransactionSerializer):
    student_name = serializers.CharField(source="student.user.full_name", read_only=True)
    student_code = serializers.CharField(source="student.student_id", read_only=True)
    loyverse_code = serializers.SerializerMethodField()
    type_display = serializers.CharField(source="get_transaction_type_display", read_only=True)

    class Meta(CafeteriaTransactionSerializer.Meta):
        fields = CafeteriaTransactionSerializer.Meta.fields + [
            "student_name",
            "student_code",
            "loyverse_code",
            "type_display",
        ]

    def get_loyverse_code(self, obj):
        return loyverse_code(obj.student)


class AdminTransactionListView(
    DateRangeMixin, CodeSearchMixin, AdminListMixin, generics.ListAPIView
):
    """GET .../admin/transactions/?q=&type=&student=&from=&to=&ordering=

    Every student's ledger. ``q`` over student names, matrícula / Código
    Loyverse, description and receipt id. Refunds stay a single-row action
    (``admin/refund/<tx>/``, type-to-confirm in the console).
    """
    admin_area = 'cafeteria'

    serializer_class = AdminTransactionSerializer
    filterset_class = TransactionFilter
    ordering = TRANSACTION_ORDERING
    default_ordering = "-date"
    date_field = "date"
    search_text_fields = (
        "student__user__first_name",
        "student__user__last_name",
        "description",
        "loyverse_receipt_id",
    )
    search_code_fields = ("student__student_id", "student__loyverse_profile__customer_code")

    def get_queryset(self):
        return CafeteriaTransaction.objects.select_related(
            "student__user", "student__loyverse_profile"
        )


class AdminTransactionExportView(AdminExportMixin, AdminTransactionListView):
    admin_area = 'cafeteria'
    export_spec = TRANSACTION_EXPORT


class AdminAdjustmentListView(DateRangeMixin, AdminListMixin, generics.ListAPIView):
    """GET .../admin/adjustments/?student=&kind=&from=&to=&ordering= (manual trail, paginated)."""
    admin_area = 'cafeteria'

    serializer_class = BalanceAdjustmentSerializer
    filterset_class = AdjustmentFilter
    ordering = ADJUSTMENT_ORDERING
    default_ordering = "-created_at"
    date_field = "created_at"
    search_fields = ("reason",)

    def get_queryset(self):
        return BalanceAdjustment.objects.select_related("admin")


# ── top-ups log ───────────────────────────────────────────
class AdminTopUpLogView(DateRangeMixin, CodeSearchMixin, AdminListMixin, generics.ListAPIView):
    """GET .../admin/topups/?q=&status=&method=&student=&from=&to=&ordering=
    &needs_pos=&needs_unload=&needs_review=

    Every ``TopUpRequest`` (office + online) with its linked gateway payment.
    ``needs_pos=1`` is the POS load queue, ``needs_unload=1`` the post-refund
    unload queue, ``needs_review=1`` the card attempts to check in MultiCobros.
    """
    admin_area = 'cafeteria'

    serializer_class = TopUpLogSerializer
    filterset_class = TopUpFilter
    ordering = TOPUP_ORDERING
    default_ordering = "-created_at"
    date_field = "created_at"
    search_text_fields = ("student__user__first_name", "student__user__last_name", "payment_ref")
    search_code_fields = ("student__student_id", "student__loyverse_profile__customer_code")

    def search_extra(self, term):
        # The folio on the family's comprobante (and in its WhatsApp message)
        # is the payment id: "Folio 123" / "PAGO123" finds that top-up.
        from apps.payments.models import Payment

        raw = str(term).strip().lower()
        if raw.strip(":#") in ("folio", "pago", ""):
            # "folio 123" is split into two terms: the label matches anything.
            return Q(pk__isnull=False)
        for prefix in ("folio", "pago", "#"):
            raw = raw.removeprefix(prefix)
        digits = raw.strip(" :#-")
        # Matrículas are zero-padded (09932); payment ids never start with 0.
        if not digits.isdigit() or digits.startswith("0") or len(digits) > 9:
            return None
        # Subquery, not a join: a top-up with two attempts would list twice.
        return Q(pk__in=Payment.objects.filter(pk=int(digits)).values("related_topup_id"))

    def get_queryset(self):
        from apps.payments.models import Payment

        return TopUpRequest.objects.select_related(
            "student__user", "student__loyverse_profile", "student__cafeteria_balance",
            "pos_loaded_by", "pos_unloaded_by", "applied_by",
        ).prefetch_related(
            # Explicit ordered Prefetch: the serializer takes the FIRST row as
            # "the" payment; a plain .order_by() would drop the cache (N+1).
            models.Prefetch(
                "payments",
                queryset=Payment.objects.select_related("banorte__verified_by").order_by(
                    "-created_at"
                ),
            )
        )


class AdminTopUpExportView(AdminExportMixin, AdminTopUpLogView):
    admin_area = 'cafeteria'
    export_spec = TOPUP_EXPORT


TOPUP_ENTITY = "cafeteria.topuprequest"


def _apply_plan(topup, payload):
    if topup.method != TopUpRequest.Method.OFFICE:
        raise BulkSkip("es una recarga en línea (se acredita sola al confirmarse el pago)")
    assert_transition(TOPUP_ENTITY, topup.status, TopUpRequest.Status.COMPLETED)
    if topup.amount is None or topup.amount <= 0:
        raise ValueError("El monto de la recarga debe ser positivo.")
    if not topup.student.loyverse_id:
        raise ValueError("Alumno sin ID de Loyverse configurado.")


def _apply_handler(topup, payload, actor):
    _apply_plan(topup, payload)
    # Same credit as the single-row apply: the stable reference makes it
    # idempotent (a second apply of the same request is a ledger no-op).
    services.add_points_to_customer(
        loyverse_customer_id=topup.student.loyverse_id,
        points=topup.amount,
        note=f"Recarga en caja — #{topup.id}",
        reference=f"topup-request-{topup.id}",
    )
    topup.status = TopUpRequest.Status.COMPLETED
    topup.processed_at = timezone.now()
    topup.save(update_fields=["status", "processed_at"])
    return {"status": ["pending", "completed"], "amount": str(topup.amount)}


def _pos_loaded_plan(topup, payload):
    from apps.payments.models import Payment

    if topup.method != TopUpRequest.Method.ONLINE:
        raise BulkSkip("no es una recarga en línea")
    if topup.status == TopUpRequest.Status.PAID:
        raise BulkSkip("está pagada y pendiente de aplicar: use «Aplicar (ya cargadas en POS)»")
    if topup.status != TopUpRequest.Status.COMPLETED:
        raise BulkSkip("aún no está acreditada en el saldo local")
    payment = next(iter(topup.payments.all()), None)
    if payment is not None and payment.status == Payment.Status.REFUNDED:
        raise BulkSkip("fue reembolsada; no se carga en el POS")
    if topup.pos_loaded_at is not None:
        raise BulkSkip("ya estaba marcada como cargada")
    if payment is not None and payment.is_simulation():
        raise BulkSkip(
            "es una operación de simulación de Banorte (sin cargo real); no se carga en el POS"
        )
    if payment is not None and payment.needs_bank_verification():
        raise BulkSkip("falta verificar la operación en MultiCobros")


def _pos_loaded_handler(topup, payload, actor):
    _pos_loaded_plan(topup, payload)
    topup.pos_loaded_at = timezone.now()
    topup.pos_loaded_by = actor
    topup.save(update_fields=["pos_loaded_at", "pos_loaded_by"])
    return {"pos_loaded": True}


def _apply_paid_plan(topup, payload):
    if topup.method != TopUpRequest.Method.ONLINE or topup.status != TopUpRequest.Status.PAID:
        raise BulkSkip("no es una recarga en línea pagada pendiente de aplicar")
    payment = next(iter(topup.payments.all()), None)
    if payment is None or payment.status != "success":
        raise BulkSkip("su pago no está aprobado (o fue devuelto)")
    if payment.needs_bank_verification():
        raise BulkSkip("falta verificar la operación en MultiCobros")


def _apply_paid_handler(topup, payload, actor):
    _apply_paid_plan(topup, payload)
    try:
        tx, balance = services.apply_paid_topup(topup, actor=actor)
    except services.TopUpApplyError as exc:
        if exc.code in ("already_applied", "not_paid"):
            raise BulkSkip(str(exc)) from exc
        raise
    return {"status": ["paid", "completed"], "amount": str(topup.amount),
            "transaction": tx.pk, "balance": str(balance)}


def _pos_unloaded_plan(topup, payload):
    if topup.pos_unload_needed_at is None:
        raise BulkSkip("no está en la cola de quitar del POS")
    if topup.pos_unloaded_at is not None:
        raise BulkSkip("ya estaba marcada como quitada")


def _pos_unloaded_handler(topup, payload, actor):
    _pos_unloaded_plan(topup, payload)
    topup.pos_unloaded_at = timezone.now()
    topup.pos_unloaded_by = actor
    topup.save(update_fields=["pos_unloaded_at", "pos_unloaded_by"])
    return {"pos_unloaded": True}


TOPUP_ACTIONS = {
    a.name: a
    for a in (
        BulkAction(
            name="apply",
            label_es="Aplicar",
            handler=_apply_handler,
            plan=_apply_plan,
            side_effects="per_row",
        ),
        BulkAction(
            name="pos_loaded",
            label_es="Marcar cargadas en POS",
            handler=_pos_loaded_handler,
            plan=_pos_loaded_plan,
            side_effects="none",
        ),
        BulkAction(
            name="pos_unloaded",
            label_es="Marcar quitadas del POS",
            handler=_pos_unloaded_handler,
            plan=_pos_unloaded_plan,
            side_effects="none",
        ),
        BulkAction(
            name="apply_paid",
            label_es="Aplicar (ya cargadas en POS)",
            handler=_apply_paid_handler,
            plan=_apply_paid_plan,
            side_effects="per_row",
        ),
    )
}


class AdminTopUpBulkView(AdminBulkView):
    """POST .../admin/topups/bulk/  ``apply`` (office + pending), ``pos_loaded``, ``pos_unloaded``.

    ``apply`` answers with ``total``: the MXN the processed rows credit (the
    dry-run's total is what the confirm dialog shows before any money moves).
    """
    admin_area = 'cafeteria'

    entity = TOPUP_ENTITY
    list_view_class = AdminTopUpLogView
    actions = TOPUP_ACTIONS

    def get_queryset(self):
        from apps.payments.models import Payment

        return TopUpRequest.objects.select_related("student__user").prefetch_related(
            models.Prefetch(
                "payments",
                queryset=Payment.objects.select_related("banorte__verified_by").order_by(
                    "-created_at"
                ),
            )
        )

    def matching_ids(self, request, filters):
        ids = super().matching_ids(request, filters)
        self._ids = ids
        return ids

    def post(self, request):
        raw = request.data.get("ids") if hasattr(request.data, "get") else None
        self._ids = [int(i) for i in (raw or []) if str(i).isdigit()]
        response = super().post(request)
        result = response.data
        if result.get("action") in ("apply", "apply_paid"):
            bad = {r["id"] for r in result["failed"]} | {r["id"] for r in result["skipped"]}
            done = [i for i in dict.fromkeys(self._ids) if i not in bad]
            total = TopUpRequest.objects.filter(pk__in=done).aggregate(t=Sum("amount"))["t"]
            result["total"] = f'{(total or Decimal("0")):.2f}'
        return response


# ── low balance ───────────────────────────────────────────
class AdminLowBalanceView(CodeSearchMixin, AdminListMixin, generics.ListAPIView):
    """GET .../admin/low-balance/?q=&grade=&group=&ordering=

    Active students at/below their threshold with a movement in the last 30
    days (``services.low_balance_queryset``: same rule as the dashboard and
    the weekly alert). Lowest balance first.
    """
    admin_area = 'cafeteria'

    serializer_class = CafeteriaBalanceSerializer
    filterset_class = BalanceFilter
    ordering = LOW_BALANCE_ORDERING
    default_ordering = "balance"
    search_text_fields = AdminBalancesView.search_text_fields
    search_code_fields = AdminBalancesView.search_code_fields

    def search_extra(self, term):
        return guardian_email_q("student")(term)

    def get_queryset(self):
        return services.low_balance_queryset().select_related(
            "student__user", "student__loyverse_profile"
        )


class AdminLowBalanceExportView(AdminExportMixin, AdminLowBalanceView):
    admin_area = 'cafeteria'
    export_spec = LOW_BALANCE_EXPORT


# ── Loyverse customers ────────────────────────────────────
class CustomersPagination(ListPagination):
    page_size = 50


class AdminLoyverseCustomersView(CodeSearchMixin, AdminListMixin, generics.ListAPIView):
    """GET .../admin/customers/?q=&kind=&missing=&ordering=&page=&page_size=

    The whole Loyverse store, one row per card (pupils, staff meals, the
    school's own and test cards). Adds ``summary`` (cards per kind + missing)
    to the list envelope. ``page_size`` is honoured (default 50).
    """
    admin_area = 'cafeteria'

    serializer_class = LoyverseCustomerSerializer
    filterset_class = CustomerFilter
    pagination_class = CustomersPagination
    ordering = CUSTOMER_ORDERING
    default_ordering = ("kind", "-last_visit", "name")
    search_text_fields = ("name", "email")
    search_code_fields = ("customer_code", "student__student_id")

    def get_queryset(self):
        return LoyverseProfile.objects.select_related("student__user")

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(qs)
        rows = list(page if page is not None else qs)
        counts = dict(
            UnmatchedReceipt.objects.filter(customer_id__in=[r.loyverse_id for r in rows])
            .values_list("customer_id")
            .annotate(n=Count("id"))
            .values_list("customer_id", "n")
        )
        data = self.get_serializer(rows, many=True, context={"receipt_counts": counts}).data
        response = self.get_paginated_response(data)
        summary = dict.fromkeys(LoyverseProfile.Kind.values, 0)
        summary.update(
            dict(
                LoyverseProfile.objects.values_list("kind")
                .annotate(n=Count("id"))
                .values_list("kind", "n")
            )
        )
        summary["missing"] = LoyverseProfile.objects.filter(missing_since__isnull=False).count()
        response.data["summary"] = summary
        return response

    def get_serializer(self, *args, **kwargs):
        context = kwargs.pop("context", None)
        serializer_context = self.get_serializer_context()
        if context:
            serializer_context.update(context)
        return self.get_serializer_class()(*args, context=serializer_context, **kwargs)


class AdminLoyverseCustomersExportView(AdminExportMixin, AdminLoyverseCustomersView):
    admin_area = 'cafeteria'
    export_spec = CUSTOMER_EXPORT


# ── reconciliation ────────────────────────────────────────
def reconcile_row(student, remote=None, error=None, pos_queue=None) -> dict:
    """Local wallet vs Loyverse points for one student (read-only, never writes).

    ``pos_queue`` is why Corregir will leave this row alone (money in transit
    in the POS load/unload queues), or ``None``."""
    balance = _safe_balance(student)
    local = Decimal(str(balance.balance if balance is not None else 0))
    row = {
        "student_id": student.id,
        "student_name": student.user.full_name,
        "student_code": student.student_id,
        "loyverse_code": loyverse_code(student),
        "loyverse_id": student.loyverse_id,
        "local_balance": local,
        "loyverse_balance": remote,
        "drift": None,
        "in_sync": False,
        "error": error,
        "pos_queue": pos_queue,
    }
    if remote is not None:
        row["drift"] = local - remote
        row["in_sync"] = local == remote
    return row


def reconcile_rows(students, points, *, error=None) -> list[dict]:
    """Rows for ``students`` against ``points`` (customer id → points, from ONE
    store-wide fetch). ``error`` marks every row when that fetch failed."""
    queue = services.pos_queue_reasons([s.id for s in students])
    rows = []
    for student in students:
        remote = points.get(student.loyverse_id)
        if error:
            row_error = error
        elif remote is None:
            row_error = "El cliente no existe en Loyverse."
        else:
            row_error = None
        rows.append(reconcile_row(student, remote, row_error, queue.get(student.id)))
    return rows


def store_points() -> tuple[dict, str | None]:
    """``({customer_id: points}, None)``, or ``({}, message)`` when Loyverse fails."""
    try:
        customers = services.get_all_customers()
    except services.LoyverseError:
        logger.exception("Reconciliation: Loyverse customer list failed")
        return {}, "No se pudo leer Loyverse; intente de nuevo en unos minutos."
    return {c.get("id"): services.get_balance_from_customer(c) for c in customers}, None


def _money(value):
    return None if value is None else str(value)


def serialize_reconcile_row(row: dict) -> dict:
    return {
        **row,
        "local_balance": _money(row["local_balance"]),
        "loyverse_balance": _money(row["loyverse_balance"]),
        "drift": _money(row["drift"]),
    }


class AdminReconcileView(CodeSearchMixin, AdminListMixin, generics.ListAPIView):
    """GET .../admin/reconcile/?q=&grade=&group=&ordering=&page=&page_size=&only=drift

    Linked, active students: local ledger vs live Loyverse points. One
    store-wide customer fetch per request (2 pages of 250), never one Loyverse
    read per row: a 100-row page of serial reads blew the 60 s worker budget. ``total`` is the matching roster (drives the
    pager); ``count`` stays the rows returned after ``only=drift`` (which
    filters within the page, as before). ``offset``/``limit``/``has_more``
    describe the page; the legacy ``limit``/``offset`` query params were
    removed in Data Ops Phase 10 (``page``/``page_size`` only).
    """
    admin_area = 'cafeteria'

    filterset_class = StudentFilter
    ordering = RECONCILE_ORDERING
    default_ordering = ("user__last_name", "user__first_name")
    search_text_fields = ("user__first_name", "user__last_name")
    search_code_fields = ("student_id", "loyverse_profile__customer_code")

    def get_queryset(self):
        return (
            StudentProfile.objects.filter(is_active=True)
            .exclude(loyverse_id="")
            .select_related("user", "loyverse_profile", "cafeteria_balance")
        )

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        params = request.query_params
        students = list(self.paginate_queryset(qs) or [])
        paginator = self.paginator
        total = paginator.page.paginator.count
        limit = paginator.get_page_size(request) or paginator.page_size
        offset = (paginator.page.number - 1) * limit
        next_url, previous_url = paginator.get_next_link(), paginator.get_previous_link()
        points, error = store_points()
        rows = [serialize_reconcile_row(r) for r in reconcile_rows(students, points, error=error)]
        if params.get("only") == "drift":
            rows = [r for r in rows if not r["in_sync"]]
        checked = len(students)
        return Response(
            {
                "count": len(rows),
                "next": next_url,
                "previous": previous_url,
                "drift_count": sum(1 for r in rows if not r["in_sync"]),
                "checked": checked,
                "total": total,
                "offset": offset,
                "limit": limit,
                "has_more": offset + checked < total,
                "results": rows,
            }
        )


class AdminReconcileExportView(AdminReconcileView):
    """GET .../admin/reconcile/export/?fmt=&ids=&…filters…

    One full customer fetch (``get_all_customers``, 250 per page) instead of
    one Loyverse read per row, so a whole-roster file stays inside the
    request budget. Audited like every export.
    """
    admin_area = 'cafeteria'

    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "admin-export"
    pagination_class = None

    def list(self, request, *args, **kwargs):
        fmt = parse_fmt(request)
        qs = self.filter_queryset(self.get_queryset())
        ids = parse_ids(request)
        if ids:
            qs = qs.filter(pk__in=ids)
        count, students = collect_rows(qs, RECONCILE_EXPORT.cap_for(fmt))
        try:
            customers = services.get_all_customers()
        except services.LoyverseError as exc:
            return error_response(f"No se pudo conectar con Loyverse: {exc}", 502)
        points = {c.get("id"): services.get_balance_from_customer(c) for c in customers}
        rows = []
        for student in students:
            remote = points.get(student.loyverse_id)
            rows.append(
                reconcile_row(
                    student,
                    remote,
                    None if remote is not None else "El cliente no existe en Loyverse.",
                )
            )
        if params_only_drift(request):
            rows = [r for r in rows if not r["in_sync"]]
        response = render_export(rows, RECONCILE_EXPORT, fmt)
        filters = {k: v for k, v in request.query_params.lists() if k != "fmt"}
        record_export(RECONCILE_EXPORT.audit_entity, fmt, filters, len(rows), request.user)
        return response


def params_only_drift(request) -> bool:
    return request.query_params.get("only") == "drift"


RECONCILE_MAX_IDS = 50


class _FixSnapshot:
    """What one Corregir request decides from: every selected wallet's balance,
    read FIRST, then Loyverse points from one store-wide fetch. The handler
    re-reads the balance under the row lock and refuses if it moved since (a
    purchase landed, another admin fixed it): never a delta computed from a
    stale balance, never a Loyverse read inside the bulk transaction."""

    def __init__(self, ids):
        self.balances = dict(
            CafeteriaBalance.objects.filter(student_id__in=ids).values_list("student_id", "balance")
        )
        self.points, self.error = store_points()

    def remote(self, student) -> Decimal:
        if not student.loyverse_id:
            raise BulkSkip("no está vinculado a Loyverse")
        if self.error:
            raise ValueError(self.error)
        remote = self.points.get(student.loyverse_id)
        if remote is None:
            raise BulkSkip("el cliente no existe en Loyverse")
        return Decimal(str(remote))

    def plan(self, student, payload):
        remote = self.remote(student)
        if remote < 0:
            raise ValueError(f"Loyverse reporta un saldo negativo (${remote:.2f}); revise en el POS.")
        reason = services.pos_queue_reasons([student.id]).get(student.id)
        if reason:
            raise BulkSkip(f"el alumno {reason}")
        local = Decimal(str(self.balances.get(student.id) or 0))
        if remote == local:
            raise BulkSkip("ya estaba sincronizado")

    def handler(self, student, payload, actor):
        remote = self.remote(student)
        reason = services.pos_queue_reasons([student.id]).get(student.id)
        if reason:
            raise BulkSkip(f"el alumno {reason}")
        expected = self.balances.get(student.id)
        adj = services.reconcile_to_loyverse(
            student, remote, expected_balance=expected, admin=actor
        )
        if adj is None:
            raise BulkSkip("ya estaba sincronizado")
        local = Decimal(str(adj.balance_after)) - Decimal(str(adj.amount))
        return {"local": str(local), "loyverse": str(remote), "delta": str(adj.amount)}


def _fix_unbound(*_args):  # replaced per request by AdminReconcileBulkView.get_action
    raise RuntimeError("Corregir needs a per-request snapshot")


class AdminReconcileBulkView(AdminBulkView):
    """POST .../admin/reconcile/bulk/  ``fix`` for the selected rows only.

    One store-wide Loyverse fetch per request (``_FixSnapshot``), taken after
    the selected balances, before the bulk transaction. Capped at 50 ids and
    "select all matching" is not offered: Corregir is a reviewed, per-row act.
    """
    admin_area = 'cafeteria'

    entity = "cafeteria.reconcile"
    max_ids = RECONCILE_MAX_IDS
    actions = {
        "fix": BulkAction(
            name="fix",
            label_es="Corregir",
            handler=_fix_unbound,
            plan=_fix_unbound,
            side_effects="none",
        )
    }

    def get_queryset(self):
        return StudentProfile.objects.select_related("user", "cafeteria_balance")

    def get_action(self, name: str) -> BulkAction:
        action = super().get_action(name)
        raw = self.request.data.get("ids")
        ids = [i for i in raw if isinstance(i, int)] if isinstance(raw, list) else []
        snapshot = _FixSnapshot(ids)
        return dataclasses.replace(action, handler=snapshot.handler, plan=snapshot.plan)

    def post(self, request):
        if request.data.get("all_matching"):
            raise ValidationError(
                {"all_matching": ["Seleccione las filas a corregir (máximo 50 por vez)."]}
            )
        return super().post(request)
