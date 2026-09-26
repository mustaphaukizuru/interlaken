"""
admissions/exports.py — CSV / XLSX / PDF exports of the Admisiones lists (Data Ops C3).

Each export view subclasses the GET-only twin of its list, so ``q``, the
FilterSet filters and ``ordering`` are the list's own code (never duplicated),
and ``?ids=1,2,3`` exports the selected rows. Every download is audited with
``record_export`` (``object_type='export:pre-registros'`` /
``'export:inscripciones'``) so personal data leaving the system is traceable
(LFPDPPP). The inscripciones export carries NO medical fields.
"""

from apps.core.exporting import AdminExportMixin, Col, ExportSpec

from .serializers import child_full_name
from .views import PreRegistrationAdminListView, RegistrationAdminListView


def _docs_approved(reg) -> str:
    docs = reg.documents.all()  # prefetched by the list queryset
    return f"{sum(1 for d in docs if d.is_verified)}/{len(docs)}"


PREREGISTRATION_EXPORT = ExportSpec(
    filename_prefix="pre-registros",
    audit_entity="pre-registros",
    title="Pre-registros",
    sheet_title="Pre-registros",
    columns=[
        Col("created_at", "Fecha", width=17, fmt="datetime"),
        Col("child", "Alumno", getter=child_full_name, width=28),
        Col("child_dob", "Nacimiento", width=12, fmt="date"),
        Col("level", "Nivel", getter=lambda r: r.get_level_display(), width=12),
        Col("grade_applying", "Grado", width=16),
        Col("cycle", "Ciclo", width=11),
        Col("parent_name", "Tutor", width=26),
        Col("parent_email", "Correo", width=28),
        Col("parent_phone", "Teléfono", width=15),
        Col("relationship", "Parentesco", width=13),
        Col("referral_source", "Cómo nos conoció", width=18),
        Col("wants_visit", "Desea visita", width=8, fmt="bool"),
        Col("status", "Estado", getter=lambda r: r.get_status_display(), width=13),
        Col("notes", "Notas", width=30),
    ],
)

REGISTRATION_EXPORT = ExportSpec(
    filename_prefix="inscripciones",
    audit_entity="inscripciones",
    title="Inscripciones",
    sheet_title="Inscripciones",
    columns=[
        Col("created_at", "Creada", width=17, fmt="datetime"),
        Col("submitted_at", "Enviada", width=17, fmt="datetime"),
        Col("child", "Alumno", getter=child_full_name, width=28),
        Col("child_dob", "Nacimiento", width=12, fmt="date"),
        Col("child_curp", "CURP", width=20),
        Col("level", "Nivel", width=12),
        Col("grade_applying", "Grado", width=16),
        Col("cycle", "Ciclo", width=11),
        Col("parent1_name", "Tutor 1", width=26),
        Col("parent1_email", "Correo", width=28),
        Col("parent1_phone", "Teléfono", width=15),
        Col("parent2_name", "Tutor 2", width=24),
        Col("parent2_email", "Correo 2", width=26),
        Col("status", "Estado", getter=lambda r: r.get_status_display(), width=15),
        Col("docs", "Documentos aprobados", getter=_docs_approved, width=10, fmt="text"),
    ],
)


class PreRegistrationExportView(AdminExportMixin, PreRegistrationAdminListView):
    """GET /api/v1/admissions/pre-register/export/?fmt=csv|xlsx|pdf

    Same ``q``, filters (status, level, cycle, wants_visit, from, to) and
    ``ordering`` as the list, plus ``ids``.
    """

    export_spec = PREREGISTRATION_EXPORT


class RegistrationExportView(AdminExportMixin, RegistrationAdminListView):
    """GET /api/v1/admissions/register/export/?fmt=csv|xlsx|pdf

    Same ``q``, filters (status, level, cycle, documents_pending, from, to)
    and ``ordering`` as the list, plus ``ids``.
    """

    export_spec = REGISTRATION_EXPORT
