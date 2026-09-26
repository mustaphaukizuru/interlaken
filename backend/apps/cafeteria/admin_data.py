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

    class Meta:
        model = TopUpRequest
        fields: list[str] = []

    def filter_needs_pos(self, qs, name, value):
        """Paid online, credited locally, not yet loaded into the POS (refunds excluded)."""
        if not value:
            return qs
        from apps.payments.models import Payment

        return (
            qs.filter(
                method=TopUpRequest.Method.ONLINE,
                status=TopUpRequest.Status.COMPLETED,
                pos_loaded_at__isnull=True,
            )
            .exclude(payments__status=Payment.Status.REFUNDED)
            .distinct()
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


def _first_payment(topup):
    if not hasattr(topup, "_cached_payment"):
        topup._cached_payment = next(iter(topup.payments.all()), None)
    return topup._cached_payment


def _pos_state(topup) -> str:
    if topup.pos_unload_needed_at and not topup.pos_unloaded_at:
        return "Quitar del POS"
    if topup.pos_unloaded_at:
        return "Quitado del POS"
    if topup.pos_loaded_at:
        return "En POS"
    if topup.method == TopUpRequest.Method.ONLINE and topup.status == TopUpRequest.Status.COMPLETED:
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


def build_adjustment_spec(*, notify: bool = True, mirror: bool = True) -> ImportSpec:
    """``matricula, monto, motivo`` → one audited ``adjust_balance`` per row.

    The dry-run is the commit's own check: the student must exist, the amount
    must be non-zero and at most $10,000, and the resulting balance must not
    be negative (``adjust_balance`` re-checks under the row lock at commit).
    A student appears once per file (in-file duplicates block). An identical
    adjustment in the last 24 h is flagged as a possible re-upload.
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
        if student.status != StudentProfile.Status.ACTIVE:
            row.warn(f"El alumno está en estado «{student.get_status_display()}».")
        motive = str(data.get("motivo") or "").strip().lower()
        if (student.pk, amount, motive) in recent():
            row.warn("Ya existe un ajuste igual en las últimas 24 h (¿archivo repetido?).")

    def create(data, actor):
        student = StudentProfile.objects.select_related("user").get(pk=data["alumno_id"])
        return services.adjust_balance(
            student, data["monto"], data["motivo"], admin=actor, notify=notify, mirror=mirror
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
        create=create,
        key_of=lambda data: data.get("matricula") or "",
        max_rows=ADJUSTMENT_MAX_ROWS,
    )


ADJUSTMENT_TEMPLATE_URL = "/api/v1/cafeteria/admin/balances/import/template/"


class AdminAdjustmentImportView(ImportView):
    """POST .../admin/balances/import/  multipart ``file`` + ``dry_run`` + ``notify`` + ``mirror``.

    ``notify`` (default on) tells the families; ``mirror`` (default on) makes
    the best-effort Loyverse points push of ``adjust_balance``. Cap 500 rows.
    """

    template_url = ADJUSTMENT_TEMPLATE_URL

    def get_spec(self):
        data = self.request.data
        return build_adjustment_spec(
            notify=truthy(data.get("notify"), True), mirror=truthy(data.get("mirror"), True)
        )


class AdminAdjustmentTemplateView(ImportTemplateView):
    """GET .../admin/balances/import/template/?fmt=csv|xlsx"""

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
    export_spec = TRANSACTION_EXPORT


class AdminAdjustmentListView(DateRangeMixin, AdminListMixin, generics.ListAPIView):
    """GET .../admin/adjustments/?student=&kind=&from=&to=&ordering= (manual trail, paginated)."""

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
    """GET .../admin/topups/?q=&status=&method=&student=&from=&to=&needs_pos=&needs_unload=&ordering=

    Every ``TopUpRequest`` (office + online) with its linked gateway payment.
    ``needs_pos=1`` is the POS load queue, ``needs_unload=1`` the post-refund
    unload queue.
    """

    serializer_class = TopUpLogSerializer
    filterset_class = TopUpFilter
    ordering = TOPUP_ORDERING
    default_ordering = "-created_at"
    date_field = "created_at"
    search_text_fields = ("student__user__first_name", "student__user__last_name", "payment_ref")
    search_code_fields = ("student__student_id", "student__loyverse_profile__customer_code")

    def get_queryset(self):
        from apps.payments.models import Payment

        return TopUpRequest.objects.select_related(
            "student__user", "pos_loaded_by", "pos_unloaded_by"
        ).prefetch_related(
            # Explicit ordered Prefetch: the serializer takes the FIRST row as
            # "the" payment; a plain .order_by() would drop the cache (N+1).
            models.Prefetch("payments", queryset=Payment.objects.order_by("-created_at"))
        )


class AdminTopUpExportView(AdminExportMixin, AdminTopUpLogView):
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
    if topup.status != TopUpRequest.Status.COMPLETED:
        raise BulkSkip("aún no está acreditada en el saldo local")
    payment = next(iter(topup.payments.all()), None)
    if payment is not None and payment.status == Payment.Status.REFUNDED:
        raise BulkSkip("fue reembolsada; no se carga en el POS")
    if topup.pos_loaded_at is not None:
        raise BulkSkip("ya estaba marcada como cargada")


def _pos_loaded_handler(topup, payload, actor):
    _pos_loaded_plan(topup, payload)
    topup.pos_loaded_at = timezone.now()
    topup.pos_loaded_by = actor
    topup.save(update_fields=["pos_loaded_at", "pos_loaded_by"])
    return {"pos_loaded": True}


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
    )
}


class AdminTopUpBulkView(AdminBulkView):
    """POST .../admin/topups/bulk/  ``apply`` (office + pending), ``pos_loaded``, ``pos_unloaded``.

    ``apply`` answers with ``total``: the MXN the processed rows credit (the
    dry-run's total is what the confirm dialog shows before any money moves).
    """

    entity = TOPUP_ENTITY
    list_view_class = AdminTopUpLogView
    actions = TOPUP_ACTIONS

    def get_queryset(self):
        from apps.payments.models import Payment

        return TopUpRequest.objects.select_related("student__user").prefetch_related(
            models.Prefetch("payments", queryset=Payment.objects.order_by("-created_at"))
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
        if result.get("action") == "apply":
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
    export_spec = CUSTOMER_EXPORT


# ── reconciliation ────────────────────────────────────────
def reconcile_row(student, remote=None, error=None) -> dict:
    """Local wallet vs Loyverse points for one student (read-only, never writes)."""
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
    }
    if remote is not None:
        row["drift"] = local - remote
        row["in_sync"] = local == remote
    return row


def live_reconcile_row(student) -> dict:
    try:
        remote = services.get_balance_from_customer(
            services.get_customer_by_id(student.loyverse_id)
        )
    except services.LoyverseError as exc:
        return reconcile_row(student, error=str(exc))
    return reconcile_row(student, remote)


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

    Linked, active students: local ledger vs live Loyverse points (one read
    per row of the page). ``total`` is the matching roster (drives the
    pager); ``count`` stays the rows returned after ``only=drift`` (which
    filters within the page, as before). Legacy ``limit``/``offset`` still
    work for one release.
    """

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

    @staticmethod
    def _int(value, default):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        params = request.query_params
        next_url = previous_url = None
        if "limit" in params or "offset" in params:
            limit = max(1, min(self._int(params.get("limit"), 50), 200))
            offset = max(0, self._int(params.get("offset"), 0))
            total = qs.count()
            students = list(qs[offset : offset + limit])
        else:
            students = list(self.paginate_queryset(qs) or [])
            paginator = self.paginator
            total = paginator.page.paginator.count
            limit = paginator.get_page_size(request) or paginator.page_size
            offset = (paginator.page.number - 1) * limit
            next_url, previous_url = paginator.get_next_link(), paginator.get_previous_link()
        rows = [serialize_reconcile_row(live_reconcile_row(s)) for s in students]
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


def _read_remote(student) -> Decimal:
    try:
        return services.get_balance_from_customer(services.get_customer_by_id(student.loyverse_id))
    except services.LoyverseError as exc:
        raise ValueError(f"No se pudo leer el saldo en Loyverse: {exc}") from None


def _fix_delta(student) -> tuple[Decimal, Decimal, Decimal]:
    if not student.loyverse_id:
        raise BulkSkip("no está vinculado a Loyverse")
    remote = _read_remote(student)
    balance = _safe_balance(student)
    local = Decimal(str(balance.balance if balance is not None else 0))
    delta = remote - local
    if delta == 0:
        raise BulkSkip("ya estaba sincronizado")
    if remote < 0:
        raise ValueError(f"Loyverse reporta un saldo negativo (${remote:.2f}); revise en el POS.")
    return local, remote, delta


def _fix_plan(student, payload):
    _fix_delta(student)


def _fix_handler(student, payload, actor):
    local, remote, delta = _fix_delta(student)
    # notify=False, mirror=False: the documented reconcile mode (the ledger is
    # being SET TO Loyverse; pushing back is circular; not news for families).
    services.adjust_balance(
        student,
        delta,
        reason=f"Reconciliación con Loyverse (local ${local:.2f} → ${remote:.2f})",
        admin=actor,
        notify=False,
        mirror=False,
    )
    return {"local": str(local), "loyverse": str(remote), "delta": str(delta)}


class AdminReconcileBulkView(AdminBulkView):
    """POST .../admin/reconcile/bulk/  ``fix`` for the selected rows only.

    Each row reads Loyverse live, so the call is capped at 50 ids and "select
    all matching" is not offered (it would be one remote read per student).
    """

    entity = "cafeteria.reconcile"
    max_ids = RECONCILE_MAX_IDS
    actions = {
        "fix": BulkAction(
            name="fix",
            label_es="Corregir",
            handler=_fix_handler,
            plan=_fix_plan,
            side_effects="none",
        )
    }

    def get_queryset(self):
        return StudentProfile.objects.select_related("user", "cafeteria_balance")

    def post(self, request):
        if request.data.get("all_matching"):
            raise ValidationError(
                {"all_matching": ["Seleccione las filas a corregir (máximo 50 por vez)."]}
            )
        return super().post(request)
