"""
accounts/exports.py — CSV / XLSX / PDF export of the Alumnos roster (Data Ops C3).

``GET /api/v1/accounts/admin/students/export/?fmt=csv|xlsx|pdf&ids=…`` is the
roster list itself with another renderer (``AdminExportMixin`` over
``StudentListView``): the same ``q``, filters (``estado``, ``nivel``, ``grado``,
``grupo``, ``acceso``, ``vinculado``, …) and ``ordering`` the admin is looking
at, or only the selected rows with ``?ids=``. Audited with ``record_export``.

No medical field (blood type, allergies, notes) and no CURP / emergency
contact is ever exported from the roster: the file is a directory, not the
student's file (LFPDPPP minimisation; the full file stays in the portal).
"""

from __future__ import annotations

from django.db.models import Count, IntegerField, OuterRef, Subquery
from django.db.models.functions import Coalesce

from apps.core.exporting import AdminExportMixin, Col, ExportSpec
from apps.core.permissions import IsAdmin

from .models import StudentProfile
from .views import StudentListView

STATUS_LABEL = dict(StudentProfile.Status.choices)


def _loyverse_code(s):
    profile = getattr(s, "loyverse_profile", None)
    if profile is not None and profile.customer_code:
        return profile.customer_code
    return s.student_id


STUDENTS_EXPORT = ExportSpec(
    filename_prefix="alumnos",
    title="Directorio de alumnos",
    sheet_title="Alumnos",
    audit_entity="students",
    columns=[
        Col("name", "Alumno", lambda s: s.user.full_name, width=30),
        Col("student_id", "Matrícula", width=12, fmt="text"),
        Col("loyverse_code", "Código Loyverse", _loyverse_code, width=14, fmt="text"),
        Col("grade", "Grado", width=14),
        Col("group", "Grupo", width=7),
        Col("status", "Estado", lambda s: STATUS_LABEL.get(s.status, s.status), width=15),
        Col("email", "Correo", lambda s: s.user.email, width=32),
        Col("guardians", "Tutores", lambda s: getattr(s, "guardians_count", 0), width=8, fmt="int"),
        Col(
            "balance",
            "Saldo cafetería",
            lambda s: getattr(s, "balance", None),
            width=14,
            fmt="money",
        ),
        Col("linked", "Vinculado a Loyverse", lambda s: bool(s.loyverse_id), width=10, fmt="bool"),
        Col("enrollment_date", "Fecha de ingreso", width=13, fmt="date"),
        Col("last_login", "Último acceso", lambda s: s.user.last_login, width=17, fmt="datetime"),
    ],
)


class AdminStudentExportView(AdminExportMixin, StudentListView):
    """GET /api/v1/accounts/admin/students/export/ — admin only, audited, throttled."""

    permission_classes = [IsAdmin]
    export_spec = STUDENTS_EXPORT

    def get_export_queryset(self):
        # A correlated subquery (not a JOIN + GROUP BY) keeps the export at one
        # SELECT and leaves the wallet annotation of the roster untouched.
        through = StudentProfile.parents.through
        guardians = (
            through.objects.filter(studentprofile_id=OuterRef("pk"))
            .order_by()
            .values("studentprofile_id")
            .annotate(n=Count("pk"))
            .values("n")
        )
        return (
            super()
            .get_export_queryset()
            .annotate(guardians_count=Coalesce(Subquery(guardians, output_field=IntegerField()), 0))
        )
