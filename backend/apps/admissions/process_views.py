"""
admissions/process_views.py — the Expediente API (Fase 5). Area «admisiones»
(``IsAdmin``); the visit card also opens to «visitas».

    GET    admin/cases/                         list (filters, counts per stage, next action)
    POST   admin/cases/                         «Nuevo prospecto» (?dry_run=1: duplicates only)
    GET    admin/cases/<pk>/                    the full case
    PATCH  admin/cases/<pk>/<stage>/            informes | visita | examen | documentacion
    POST   admin/cases/<pk>/move/ | close/ | reopen/
    POST   admin/cases/<pk>/actions/<action>/   send-costs | send-visit-link | send-ficha-link |
                                                send-exam-date | send-exam-result
    GET    admin/cases/<pk>/discounts/          POST create; PATCH/DELETE …/<id>/
    GET    admin/cases/<pk>/payments/           POST create; PATCH/DELETE …/<id>/
    POST   admin/cases/<pk>/enroll/             «Marcar como inscrito»
    GET    admin/cases/templates/               PATCH: the message templates
    GET    admin/exams/?from=&to=               exams of a week
    GET    cuotas/<level>.pdf                   public «Cuotas por nivel» (no personal data)
    GET    admin/cuotas/<level>.pdf             the same, staff preview (never cached)
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import django_filters
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import generics, permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.exceptions import error_body
from apps.core.filtersets import parse_bool_param
from apps.core.listing import AdminListMixin, apply_date_range, search_q
from apps.core.permissions import IsAdmin
from apps.core.transitions import TransitionError, transition_code

from . import cuotas_pdf, process, process_messages
from .models import AdmissionDiscount, EnrollmentPayment, PreRegistration, Registration
from .process_serializers import (
    STAGE_SERIALIZERS,
    ActionSerializer,
    CloseSerializer,
    DiscountSerializer,
    EnrollSerializer,
    MoveSerializer,
    PaymentSerializer,
    ProspectSerializer,
    ReopenSerializer,
    VoidSerializer,
    case_detail,
    case_row,
)

AREA = "admisiones"


def conflict(exc: process.CaseConflict) -> Response:
    return Response(
        error_body(exc.message, code=exc.code, **exc.extra), status=status.HTTP_409_CONFLICT
    )


def transition_failed(exc: TransitionError) -> Response:
    """A refused stage move as ``{detail, code}`` (DRF would answer a bare list)."""
    detail = exc.detail[0] if isinstance(exc.detail, list) and exc.detail else exc.detail
    return Response(
        error_body(str(detail), code=transition_code(exc) or "not_allowed"),
        status=status.HTTP_400_BAD_REQUEST,
    )


def case_queryset():
    from apps.bookings.models import Booking

    return PreRegistration.objects.prefetch_related(
        Prefetch("bookings", queryset=Booking.objects.select_related("slot")),
        Prefetch(
            "registrations",
            queryset=Registration.objects.select_related("student_profile").prefetch_related(
                "documents"
            ),
        ),
        "discounts__created_by",
        "enrollment_payments__recorded_by",
    )


def load_case(pk) -> PreRegistration:
    return get_object_or_404(case_queryset(), pk=pk)


def detail_response(pk, request, *, status_code=status.HTTP_200_OK) -> Response:
    return Response(case_detail(load_case(pk), user=request.user), status=status_code)


# ── list ──────────────────────────────────────────────────────────────────
class CaseFilter(django_filters.FilterSet):
    """``stage`` (one or a comma list), ``closed``, ``level``, ``cycle``,
    ``closed_outcome``; ``from``/``to`` on ``created_at``."""

    stage = django_filters.CharFilter(method="filter_stage")
    closed = django_filters.BooleanFilter(method="filter_closed")
    level = django_filters.ChoiceFilter(choices=PreRegistration.Level.choices)
    cycle = django_filters.CharFilter(field_name="cycle")
    closed_outcome = django_filters.ChoiceFilter(choices=PreRegistration.ClosedOutcome.choices[1:])

    class Meta:
        model = PreRegistration
        fields = ["stage", "closed", "level", "cycle", "closed_outcome"]

    def filter_stage(self, qs, _name, value):
        wanted = [v for v in (x.strip() for x in str(value).split(",")) if v]
        bad = [v for v in wanted if v not in PreRegistration.Stage.values]
        if bad:
            raise ValidationError({"stage": [f"Etapa desconocida: {bad[0]}."]})
        return qs.filter(stage__in=wanted) if wanted else qs

    def filter_closed(self, qs, _name, value):
        if value is None:
            return qs
        if value:
            return qs.filter(stage=PreRegistration.Stage.CERRADO)
        return qs.exclude(stage=PreRegistration.Stage.CERRADO)

    def filter_queryset(self, queryset):
        qs = super().filter_queryset(queryset)
        return apply_date_range(qs, "created_at", self.data.get("from"), self.data.get("to"))


CASE_ORDERING = {
    "created_at": "created_at",
    "updated_at": "updated_at",
    "stage_changed_at": "stage_changed_at",  # oldest first = waiting longest
    "child": ("child_last_name", "child_first_name"),
    "exam_at": "exam_at",
    "stage": "stage",
}
SEARCH_FIELDS = (
    "child_first_name",
    "child_last_name",
    "parent_name",
    "parent_email",
    "parent_phone",
    "previous_school",
)


class CaseListCreateView(AdminListMixin, generics.ListAPIView):
    admin_area = AREA
    permission_classes = [IsAdmin]
    search_fields = SEARCH_FIELDS
    ordering = CASE_ORDERING
    default_ordering = "-created_at"
    filterset_class = CaseFilter

    def get_queryset(self):
        return case_queryset()

    def stage_counts(self) -> dict:
        params = self.request.query_params.copy()
        for key in ("stage", "closed", "page", "page_size", "ordering"):
            params.pop(key, None)
        fs = CaseFilter(params, queryset=PreRegistration.objects.all(), request=self.request)
        if not fs.is_valid():
            raise ValidationError(fs.errors)
        qs = fs.qs
        q = search_q(self.search_fields, self.get_search_term())
        if q is not None:
            qs = qs.filter(q)
        counts = dict(qs.order_by().values_list("stage").annotate(n=Count("id")))
        return {s: counts.get(s, 0) for s in PreRegistration.Stage.values}

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(qs)
        rows = [case_row(lead) for lead in (page if page is not None else qs)]
        response = (
            self.get_paginated_response(rows) if page is not None else Response({"results": rows})
        )
        response.data["counts"] = self.stage_counts()
        response.data["stages"] = [{"key": k, "label": v} for k, v in PreRegistration.Stage.choices]
        return response

    def post(self, request):
        ser = ProspectSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        duplicates = process.find_duplicates(
            phone=data["parent_phone"], email=data.get("parent_email", "")
        )
        dupes = [case_row(d) for d in duplicates]
        if parse_bool_param(request.query_params.get("dry_run")):
            return Response({"created": False, "duplicates": dupes})
        lead = ser.save()
        record(
            "create",
            lead,
            {
                "via": "expediente: nuevo prospecto",
                "stage": lead.stage,
                "duplicates": [d.pk for d in duplicates],
            },
            actor=request.user,
            context=f"{process.CASE_CONTEXT}: nuevo prospecto",
        )
        body = case_detail(load_case(lead.pk), user=request.user)
        body["duplicates"] = dupes
        return Response(body, status=status.HTTP_201_CREATED)


class CaseDetailView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        return detail_response(pk, request)


# ── stage cards ───────────────────────────────────────────────────────────
STAGE_UPDATERS = {
    "informes": process.update_informes,
    "visita": process.update_visita,
    "examen": process.update_examen,
    "documentacion": process.update_documentacion,
}


def patch_stage(request, pk, stage):
    if stage not in STAGE_UPDATERS:
        raise Http404("Etapa desconocida.")
    with transaction.atomic():
        lead = get_object_or_404(PreRegistration.objects.select_for_update(), pk=pk)
        ser = STAGE_SERIALIZERS[stage](data=request.data, context={"lead": lead})
        ser.is_valid(raise_exception=True)
        try:
            STAGE_UPDATERS[stage](lead, dict(ser.validated_data), actor=request.user)
        except process.CaseConflict as exc:
            transaction.set_rollback(True)
            return conflict(exc)
        except TransitionError as exc:
            transaction.set_rollback(True)
            return transition_failed(exc)
    return detail_response(pk, request)


class CaseStageView(APIView):
    """PATCH admin/cases/<pk>/<stage>/ for informes, examen and documentacion."""

    admin_area = AREA
    permission_classes = [IsAdmin]

    def patch(self, request, pk, stage):
        if stage == "visita":
            raise Http404("Etapa desconocida.")  # routed to CaseVisitStageView
        return patch_stage(request, pk, stage)


class CaseVisitStageView(APIView):
    """PATCH admin/cases/<pk>/visita/: the visit outcome stays with «visitas» too."""

    admin_area = (AREA, "visitas")
    permission_classes = [IsAdmin]

    def patch(self, request, pk):
        return patch_stage(request, pk, "visita")


class CaseMoveView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]
    op = "move"

    def post(self, request, pk):
        serializer = {"move": MoveSerializer, "close": CloseSerializer, "reopen": ReopenSerializer}[
            self.op
        ]
        ser = serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        with transaction.atomic():
            lead = get_object_or_404(PreRegistration.objects.select_for_update(), pk=pk)
            try:
                if self.op == "move":
                    process.move_case(lead, d["stage"], actor=request.user, note=d.get("note", ""))
                elif self.op == "close":
                    process.close_case(lead, d["outcome"], d["reason"], actor=request.user)
                else:
                    process.reopen_case(
                        lead, actor=request.user, note=d["note"], stage=d.get("stage", "")
                    )
            except process.CaseConflict as exc:
                return conflict(exc)
            except TransitionError as exc:
                transaction.set_rollback(True)
                return transition_failed(exc)
        return detail_response(pk, request)


class CaseCloseView(CaseMoveView):
    op = "close"


class CaseReopenView(CaseMoveView):
    op = "reopen"


# ── actions ───────────────────────────────────────────────────────────────
class CaseActionView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]

    def post(self, request, pk, action):
        fn = process_messages.ACTIONS.get(action)
        if fn is None:
            raise Http404("Acción desconocida.")
        ser = ActionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        kwargs = {"channel": ser.validated_data.get("channel") or None}
        if action == "send-ficha-link":
            kwargs["override"] = ser.validated_data.get("override", False)
        lead = get_object_or_404(PreRegistration, pk=pk)
        try:
            out = fn(lead, request.user, **kwargs)
        except process.CaseConflict as exc:
            return conflict(exc)
        out["case"] = case_row(load_case(pk))
        return Response(out)


# ── discounts and payments ────────────────────────────────────────────────
class _RecordListView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]
    model = None
    serializer_class = None
    related = ""
    user_field = ""
    context = ""

    def get(self, request, pk):
        lead = get_object_or_404(PreRegistration, pk=pk)
        qs = getattr(lead, self.related).all()
        if not parse_bool_param(request.query_params.get("include_voided")):
            qs = qs.filter(voided_at__isnull=True)
        return Response({"results": self.serializer_class(qs, many=True).data})

    def post(self, request, pk):
        with transaction.atomic():
            lead = get_object_or_404(PreRegistration.objects.select_for_update(), pk=pk)
            if lead.stage == PreRegistration.Stage.CERRADO:
                return conflict(process.CaseConflict(process.MSG_CLOSED, code="closed"))
            ser = self.serializer_class(data=request.data)
            ser.is_valid(raise_exception=True)
            obj = ser.save(pre_registration=lead, **{self.user_field: request.user})
            record(
                "create",
                obj,
                {"case": lead.pk, "summary": ser.data["summary"]},
                actor=request.user,
                context=self.context,
            )
        return Response(self.serializer_class(obj).data, status=status.HTTP_201_CREATED)


class _RecordDetailView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]
    model = None
    serializer_class = None
    context = ""
    void_reason_required = False

    def get_object(self, pk, item):
        return get_object_or_404(
            self.model.objects.select_for_update().select_related("pre_registration"),
            pk=item,
            pre_registration_id=pk,
            voided_at__isnull=True,
        )

    def patch(self, request, pk, item):
        with transaction.atomic():
            obj = self.get_object(pk, item)
            before = self.serializer_class(obj).data
            ser = self.serializer_class(obj, data=request.data, partial=True)
            ser.is_valid(raise_exception=True)
            obj = ser.save()
            after = self.serializer_class(obj).data
            diff = {
                k: [before[k], after[k]]
                for k in after
                if k not in ("updated_at", "summary", "months") and before.get(k) != after[k]
            }
            if diff:
                diff["case"] = pk
                record("update", obj, diff, actor=request.user, context=self.context)
        return Response(after)

    def delete(self, request, pk, item):
        ser = VoidSerializer(data=request.data or {})
        ser.is_valid(raise_exception=True)
        reason = " ".join(ser.validated_data.get("reason", "").split())
        if self.void_reason_required and not reason:
            raise ValidationError({"reason": ["Indique por qué se anula el registro."]})
        with transaction.atomic():
            obj = self.get_object(pk, item)
            obj.voided_at = timezone.now()
            obj.void_reason = reason[:300]
            obj.save(update_fields=["voided_at", "void_reason", "updated_at"])
            record(
                "delete",
                obj,
                {
                    "case": pk,
                    "voided": True,
                    "reason": obj.void_reason,
                    "summary": self.serializer_class(obj).data["summary"],
                },
                actor=request.user,
                context=self.context,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class DiscountListView(_RecordListView):
    model = AdmissionDiscount
    serializer_class = DiscountSerializer
    related = "discounts"
    user_field = "created_by"
    context = f"{process.CASE_CONTEXT}: beca o descuento"


class DiscountDetailView(_RecordDetailView):
    model = AdmissionDiscount
    serializer_class = DiscountSerializer
    context = f"{process.CASE_CONTEXT}: beca o descuento"


class PaymentListView(_RecordListView):
    model = EnrollmentPayment
    serializer_class = PaymentSerializer
    related = "enrollment_payments"
    user_field = "recorded_by"
    context = f"{process.CASE_CONTEXT}: pago de inscripción"


class PaymentDetailView(_RecordDetailView):
    model = EnrollmentPayment
    serializer_class = PaymentSerializer
    context = f"{process.CASE_CONTEXT}: pago de inscripción"
    void_reason_required = True


# ── «Marcar como inscrito» ────────────────────────────────────────────────
class CaseEnrollView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from .convert import ConvertError

        get_object_or_404(PreRegistration, pk=pk)
        ser = EnrollSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        try:
            result = process.enroll_case(
                pk,
                request.user,
                student_id=d["student_id"],
                grade=d["grade"],
                group=d["group"],
                override_documents=d["override_documents"],
                override_reason=d["override_reason"],
            )
        except process.GatesNotMet as exc:
            return Response(
                error_body(
                    "Faltan requisitos para marcar como inscrito.", code="gates", gates=exc.gates
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        except process.CaseConflict as exc:
            return conflict(exc)
        except ConvertError as exc:
            return Response(exc.body, status=exc.status_code)
        body = {"already": result.already, "case": case_detail(load_case(pk), user=request.user)}
        if result.convert is not None:
            # ``already`` here: the student existed (converted earlier in the pipeline).
            body.update(result.convert.as_dict())
        return Response(
            body, status=status.HTTP_200_OK if result.already else status.HTTP_201_CREATED
        )


# ── templates ─────────────────────────────────────────────────────────────
class CaseTemplatesView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(process_messages.templates_payload())

    def patch(self, request):
        if not isinstance(request.data, dict):
            raise ValidationError({"detail": ["Envíe un objeto {plantilla: texto}."]})
        return Response(process_messages.save_templates(dict(request.data), request.user))


# ── exams week ────────────────────────────────────────────────────────────
class ExamsView(APIView):
    """GET admin/exams/?from=YYYY-MM-DD&to=YYYY-MM-DD (default: this Monday to Sunday)."""

    admin_area = AREA
    permission_classes = [IsAdmin]
    MAX_DAYS = 62

    @staticmethod
    def _date(request, name):
        raw = (request.query_params.get(name) or "").strip()
        if not raw:
            return None
        try:
            value = parse_date(raw)
        except ValueError:
            value = None
        if value is None:
            raise ValidationError({name: ["Fecha no válida (AAAA-MM-DD)."]})
        return value

    def get(self, request):
        today = timezone.localdate()
        start, end = self._date(request, "from"), self._date(request, "to")
        start = start or (today - timedelta(days=today.weekday()))
        end = end or (start + timedelta(days=6))
        if end < start:
            raise ValidationError({"to": ["La fecha final debe ser después de la inicial."]})
        if (end - start).days > self.MAX_DAYS:
            raise ValidationError({"to": [f"Consulte a lo más {self.MAX_DAYS} días."]})
        tz = timezone.get_current_timezone()
        lo = timezone.make_aware(datetime.combine(start, time.min), tz)
        hi = timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min), tz)
        leads = (
            PreRegistration.objects.filter(exam_at__gte=lo, exam_at__lt=hi)
            .exclude(Q(stage=PreRegistration.Stage.CERRADO) & ~Q(closed_outcome="no_aceptado"))
            .order_by("exam_at", "pk")
        )
        days = {start + timedelta(days=i): [] for i in range((end - start).days + 1)}
        for lead in leads:
            local = timezone.localtime(lead.exam_at)
            days.setdefault(local.date(), []).append(
                {
                    "case": lead.pk,
                    "child_name": f"{lead.child_first_name} {lead.child_last_name}".strip(),
                    "parent_name": lead.parent_name,
                    "parent_phone": lead.parent_phone,
                    "grade_applying": lead.grade_applying,
                    "level": lead.level,
                    "exam_at": lead.exam_at,
                    "time": local.strftime("%H:%M"),
                    "exam_notes": lead.exam_notes,
                    "exam_results_at": lead.exam_results_at,
                    "result": lead.exam_result,
                    "stage": lead.stage,
                    "date_sent_at": lead.exam_date_sent_at,
                }
            )
        return Response(
            {
                "from": start.isoformat(),
                "to": end.isoformat(),
                "days": [
                    {"date": d.isoformat(), "exams": items} for d, items in sorted(days.items())
                ],
            }
        )


# ── «Cuotas por nivel» PDF ────────────────────────────────────────────────
def _pdf_response(levels, name: str, *, cache_seconds: int) -> HttpResponse:
    data = cuotas_pdf.render_cuotas_pdf(levels, use_cache=cache_seconds > 0)
    resp = HttpResponse(data, content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="cuotas-{name}.pdf"'
    resp["Cache-Control"] = f"public, max-age={cache_seconds}" if cache_seconds else "no-store"
    return resp


class CuotasPdfView(APIView):
    """Public: the costs sheet the Informes message links to (no personal data)."""

    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []

    def get(self, request, level):
        levels = cuotas_pdf.levels_for(level)
        if levels is None:
            raise Http404("Nivel desconocido.")
        return _pdf_response(levels, level, cache_seconds=cuotas_pdf.CACHE_TTL)


class CuotasPdfPreviewView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]

    def get(self, request, level):
        levels = cuotas_pdf.levels_for(level)
        if levels is None:
            raise Http404("Nivel desconocido.")
        return _pdf_response(levels, level, cache_seconds=0)
