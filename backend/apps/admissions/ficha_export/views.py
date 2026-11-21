"""
admissions/ficha_export/views.py — download endpoints of the ficha (Fase 3).

    GET /api/v1/admissions/register/<pk>/ficha/export/?fmt=xlsx|pdf
        Staff (admin, or staff with the «admisiones» area): Excel or PDF.
        The family: their own ficha, PDF only, with their ``X-Session-Token``
        and only once it was sent (another family's session: 404).
    GET /api/v1/admissions/register/fichas/export/?ids=1,2&fmt=xlsx|pdf
        Staff: a ZIP with up to 50 fichas.
    GET /api/v1/admissions/register/fichas/concentrado/?fmt=xlsx&<list filters>&ids=
        Staff: «Concentrado de fichas», one row per student (same ``q``,
        filters and ordering as the Inscripciones list).
    GET /api/v1/admissions/ficha/blank/?fmt=pdf|xlsx
        The blank form. The PDF is public (it holds no data); the Excel is
        for staff.

Health data follows ``ficha.can_access_medical`` (the family's own session,
or an admin once the family consented; never a staff account with only the
admisiones area). Every download of personal data is audited with
``record_export`` (which registration(s), which format, whether health data
went out) and throttled like the other exports (``admin-export``, 30/min).
"""

from __future__ import annotations

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from rest_framework import permissions, status
from rest_framework.exceptions import NotAuthenticated, NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import audit_context, record_export
from apps.core.exceptions import PayloadTooLarge, error_body
from apps.core.exporting import AdminExportMixin, collect_rows, parse_ids
from apps.core.exports import as_download, export_filename
from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit
from apps.core.throttling import SharedScopedRateThrottle

from .. import ficha
from ..models import Registration
from ..tokens import session_valid
from ..views import RegistrationAdminListView
from . import files
from .concentrado import concentrado_xlsx

AREA = "admisiones"
MSG_FMT = "Use xlsx o pdf."
MSG_FAMILY_PDF = "Su copia de la ficha se descarga en PDF."
MSG_NOT_SENT = "La copia de su ficha estará disponible cuando la envíe."
MSG_NO_IDS = "Elija al menos una ficha."
MSG_ZIP_CAP = f"Puede descargar hasta {files.ZIP_CAP} fichas a la vez. Elija menos fichas."
MSG_NOT_FOUND = "Ficha no encontrada."


def _fmt(request, allowed=files.FORMATS, default="pdf") -> str:
    fmt = (request.query_params.get("fmt") or default).strip().lower()
    if fmt not in allowed:
        raise ValidationError({"fmt": [MSG_FMT if len(allowed) > 1 else f"Use {allowed[0]}."]})
    return fmt


def _download(item: files.FichaFile) -> HttpResponse:
    response = HttpResponse(item.content, content_type=item.content_type)
    response["Cache-Control"] = "no-store"
    return as_download(response, item.filename)


def _staff(request, view) -> bool:
    return IsAdmin().has_permission(request, view)


def _registrations():
    return Registration.objects.select_related("privacy_notice_version").prefetch_related(
        "guardians"
    )


class FichaExportView(APIView):
    """GET register/<pk>/ficha/export/?fmt=xlsx|pdf: one ficha (staff or its family)."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "admin-export"
    admin_area = AREA

    def get(self, request, pk):
        fmt = _fmt(request)
        if _staff(request, self):
            reg = get_object_or_404(_registrations(), pk=pk)
            medical_ok = ficha.can_access_medical(request, reg)
            item = files.ficha_file(reg, fmt, medical_ok=medical_ok)
            record_export(
                "ficha",
                fmt,
                {"registration": reg.pk, "salud": medical_ok},
                1,
                request.user,
                context=f"export:ficha {reg.pk}",
            )
            return _download(item)
        token = ficha.session_token(request)
        if token:
            return self._family(request, pk, token, fmt)
        if request.user and request.user.is_authenticated:
            raise PermissionDenied()
        raise NotAuthenticated()

    def _family(self, request, pk, token, fmt):
        reg = _registrations().filter(pk=pk).first()
        # Same answer whether the ficha does not exist or is another family's.
        if reg is None or not session_valid(reg, token):
            raise NotFound(MSG_NOT_FOUND)
        if reg.status == Registration.Status.DRAFT:
            return Response(
                error_body(MSG_NOT_SENT, code="not_submitted"), status=status.HTTP_409_CONFLICT
            )
        if fmt != "pdf":
            raise ValidationError({"fmt": [MSG_FAMILY_PDF]})
        item = files.ficha_file(reg, "pdf", medical_ok=True)
        with audit_context(actor_label=f"familia:inscripción {reg.pk}"):
            record_export(
                "ficha",
                "pdf",
                {"registration": reg.pk, "salud": True, "copia": "familia"},
                1,
                None,
                context=f"export:ficha {reg.pk} (familia)",
            )
        return _download(item)


class FichasZipView(APIView):
    """GET register/fichas/export/?ids=…&fmt=xlsx|pdf: a ZIP of ≤ 50 fichas (staff)."""

    permission_classes = [IsAdmin]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "admin-export"
    admin_area = AREA

    def get(self, request):
        fmt = _fmt(request)
        ids = parse_ids(request)
        if not ids:
            raise ValidationError({"ids": [MSG_NO_IDS]})
        if len(ids) > files.ZIP_CAP:
            raise PayloadTooLarge(detail=MSG_ZIP_CAP)
        regs = list(
            _registrations()
            .filter(pk__in=ids)
            .order_by("child_last_name", "child_first_name", "pk")
        )
        if not regs:
            raise NotFound("No se encontraron esas fichas.")
        with_health = {reg.pk: ficha.can_access_medical(request, reg) for reg in regs}
        item = files.zip_fichas(regs, fmt, medical_ok=lambda reg: with_health[reg.pk])
        record_export(
            "fichas",
            f"zip-{fmt}",
            {
                "registrations": [reg.pk for reg in regs],
                "salud": sorted(pk for pk, ok in with_health.items() if ok),
            },
            len(regs),
            request.user,
        )
        return _download(item)


class FichaConcentradoView(AdminExportMixin, RegistrationAdminListView):
    """GET register/fichas/concentrado/?fmt=xlsx: «Concentrado de fichas».

    The Inscripciones list itself (``q``, filters, ``ordering``, ``ids``) with
    one wide row per student; health columns for admins only, filled for the
    families that consented.
    """

    admin_area = AREA
    export_formats = ("xlsx",)
    row_cap = 5_000

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related("privacy_notice_version")
            .prefetch_related("guardians")
        )

    def list(self, request, *args, **kwargs):
        fmt = _fmt(request, ("xlsx",), default="xlsx")
        qs = self.get_export_queryset()
        ids = parse_ids(request)
        if ids:
            qs = qs.filter(pk__in=ids)
        count, rows = collect_rows(qs, self.row_cap)
        include_health = ficha.is_admin_reader(request.user)
        payload = concentrado_xlsx(rows, include_health=include_health)
        filters = {k: v for k, v in request.query_params.lists() if k != "fmt"}
        filters["salud"] = include_health
        record_export("fichas-concentrado", fmt, filters, count, request.user)
        response = HttpResponse(payload, content_type=files.CONTENT_TYPES["xlsx"])
        response["Cache-Control"] = "no-store"
        return as_download(response, export_filename("concentrado-fichas", "xlsx"))


@method_decorator(ratelimit("ficha-blank", "30/m", key="ip", method="GET"), name="dispatch")
class BlankFichaView(APIView):
    """GET ficha/blank/?fmt=pdf|xlsx: the form with nothing filled in."""

    permission_classes = [permissions.AllowAny]
    admin_area = AREA

    def get(self, request):
        fmt = _fmt(request)
        staff = _staff(request, self)
        if fmt == "xlsx" and not staff:
            if request.user and request.user.is_authenticated:
                raise PermissionDenied()
            raise NotAuthenticated()
        if staff:
            record_export("ficha-en-blanco", fmt, {}, 0, request.user)
        return _download(files.blank_file(fmt))
