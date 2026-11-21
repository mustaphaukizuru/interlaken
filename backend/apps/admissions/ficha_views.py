"""
admissions/ficha_views.py — the ficha de inscripción API (Fase 1).

    GET   /api/v1/admissions/ficha/schema/                 public: steps, fields, choices, rules
    GET   /api/v1/admissions/register/<pk>/ficha/           every section + completeness
    PATCH /api/v1/admissions/register/<pk>/ficha/<section>/ save one step (draft, format rules)
    POST  /api/v1/admissions/register/resume/               «continuar mi ficha» by email

The public start is ``POST /register/`` with the step-0 body and the submit is
``POST /register/<pk>/submit/`` (``views.py``). Families act with the session
token (``X-Session-Token``) the start or the invite exchange returned; staff
with their login (``authorize_registration``: admin, or staff holding the
admisiones area). A family edits only while the ficha is a draft; staff edit
anytime, audited. Health data: the family's own session, or an admin once the
family consented; never a staff account with only the admisiones area.
"""

from __future__ import annotations

from functools import partial

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.http import Http404
from django.utils.decorators import method_decorator
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import error_body
from apps.core.ratelimit import ratelimit

from . import ficha
from .ficha_schema import PATCH_SECTIONS, schema_json
from .models import Registration
from .views import _is_staff, authorize_registration

MSG_NOT_DRAFT = (
    "Esta ficha ya fue enviada y ya no se puede modificar. Si necesita corregir "
    "algún dato, responda al correo de confirmación o llame a admisiones."
)
MSG_MEDICAL = (
    "Los datos de salud solo los puede ver o editar la familia, o la dirección "
    "cuando la familia lo autorizó."
)


class FichaSchemaView(APIView):
    """GET /api/v1/admissions/ficha/schema/ — the form as data (single source)."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(schema_json(public_start_enabled=ficha.public_start_enabled()))


class FichaView(APIView):
    """GET /api/v1/admissions/register/<pk>/ficha/ — all sections + completeness."""

    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        reg = authorize_registration(request, pk)
        return Response(
            ficha.ficha_payload(
                reg, is_staff=_is_staff(request), medical_ok=ficha.can_access_medical(request, reg)
            )
        )


@method_decorator(
    ratelimit("registration-ficha", "60/m", key="ip", method="PATCH"), name="dispatch"
)
class FichaSectionView(APIView):
    """PATCH /api/v1/admissions/register/<pk>/ficha/<section>/ — save one step.

    Format rules only (a draft may be incomplete); returns the stored section
    and the completeness map. 400 ``{field: [message]}`` on a format error,
    409 when a family edits a sent ficha, 403 for health data without access.
    """

    permission_classes = [permissions.AllowAny]

    def patch(self, request, pk, section):
        reg = authorize_registration(request, pk)
        if section not in PATCH_SECTIONS:
            raise Http404("Sección desconocida.")
        staff = _is_staff(request)
        if not staff and reg.status != Registration.Status.DRAFT:
            return Response(
                error_body(MSG_NOT_DRAFT, code="not_draft"), status=status.HTTP_409_CONFLICT
            )
        medical_ok = ficha.can_access_medical(request, reg)
        if section == "salud" and not medical_ok:
            return Response(
                error_body(MSG_MEDICAL, code="medical_forbidden"), status=status.HTTP_403_FORBIDDEN
            )
        guardians = ficha.save_section(
            reg, section, request.data, is_staff=staff, actor=request.user if staff else None
        )
        values = ficha.all_values(reg, guardians)
        data = ficha.json_section(values[section])
        return Response(
            {
                "section": section,
                "data": data,
                "completeness": ficha.completeness(values),
                "status": reg.status,
                "ficha_version": reg.ficha_version,
                "updated_at": reg.updated_at,
            }
        )


# Each call emails a fresh link: keep it slow for one IP.
@method_decorator(ratelimit("registration-resume", "3/m", key="ip", method="POST"), name="dispatch")
class RegistrationResumeView(APIView):
    """POST /api/v1/admissions/register/resume/ ``{email}`` — «continuar mi ficha».

    Always the same 200 answer, whether or not a draft exists for that email
    (no enumeration). When drafts exist (newest 3), each gets a fresh
    single-use invite, emailed from a background thread so the response time
    does not tell either.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = str(request.data.get("email") or "").strip()
        try:
            validate_email(email)
        except DjangoValidationError:
            return Response({"email": [ficha.MSG_EMAIL]}, status=status.HTTP_400_BAD_REQUEST)
        jobs = ficha.resume_drafts(email)
        if jobs:
            from apps.portal import services as portal_services

            portal_services.run_in_background(
                partial(ficha.send_resume_links, jobs), name="admissions-resume"
            )
        return Response({"detail": ficha.RESUME_MESSAGE})
