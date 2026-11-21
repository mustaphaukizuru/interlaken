"""
Admissions pipeline (BACKLOG P4-1).

GET  /admissions/admin/pipeline/                 kanban: registrations grouped by status
                                                 with document checklist per card
POST /admissions/admin/register/<pk>/request-docs/  email the family the missing
                                                 documents (template editable in Ajustes:
                                                 SiteSettings.tpl_missing_docs)
POST /admissions/admin/register/<pk>/convert/    one click: StudentProfile + student
                                                 login + guardian accounts (parent1/2),
                                                 marks the registration COMPLETE, returns
                                                 the new student and the passwords delivery
                                                 texts for the admin to send (no self-service
                                                 reset, decision 2026-08-22)
"""
from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin

from .models import Registration
from .required_docs import active_catalog, build_checklist, prefetch_checklist

DEFAULT_MISSING_DOCS_TEMPLATE = (
    'Hola {parent_name}:\n\nPara completar la inscripción de {child_name} nos falta recibir:\n{missing_list}\n\n'
    'Puede subirlos desde este enlace: {upload_url}\n\nGracias,\nAdmisiones Colegio Interlaken'
)
STATUS_ORDER = [Registration.Status.SUBMITTED, Registration.Status.REVIEWING, Registration.Status.APPROVED,
                Registration.Status.COMPLETE, Registration.Status.REJECTED]


def checklist(reg: Registration, docs=None) -> dict:
    """The registration's documents for its level (Fase 4: the list edited in
    Admisiones → Documentos, ``required_docs.build_checklist``), in the shape
    the pipeline, the bulk «Solicitar documentos» and the email use:
    ``missing`` (missing, then «por corregir» with the reason), ``verified``
    (approved, delivered on paper or the sent ficha) and ``required`` (the
    level's documents minus «No aplica»). Pass ``docs=active_catalog()`` when
    building many."""
    c = build_checklist(reg, docs=docs, staff=False)
    return {'items': c['items'], 'missing': c['missing'], 'verified': c['counts']['done'],
            'required': c['counts']['total'], 'complete': c['complete']}


def _card(reg: Registration, docs=None) -> dict:
    c = checklist(reg, docs)
    return {
        'id': reg.pk, 'child_name': f'{reg.child_first_name} {reg.child_last_name}', 'level': reg.level, 'grade_applying': reg.grade_applying,
        'parent_name': reg.parent1_name, 'parent_email': reg.parent1_email, 'parent_phone': reg.parent1_phone,
        'status': reg.status, 'submitted_at': reg.submitted_at.isoformat() if reg.submitted_at else None,
        'updated_at': reg.updated_at.isoformat(), 'docs_verified': c['verified'], 'docs_required': c['required'], 'missing': c['missing'],
        'student': getattr(getattr(reg, 'student_profile', None), 'pk', None),
    }


# Completed registrations stay on the board this long; older ones live in the
# Inscripciones list ("Ver todos"). Data Ops Phase 4: the board was unbounded.
COMPLETE_WINDOW_DAYS = 90


class PipelineView(APIView):
    """GET /admissions/admin/pipeline/ — kanban of the non-terminal statuses plus
    the last ``COMPLETE_WINDOW_DAYS`` days of *complete*. ``?all=1`` lifts the
    window (the board then shows every completed registration)."""
    admin_area = 'admisiones'
    permission_classes = [IsAdmin]

    def get(self, request):
        show_all = str(request.query_params.get('all') or '').lower() in ('1', 'true', 'si', 'sí')
        regs = Registration.objects.exclude(status=Registration.Status.DRAFT)
        complete_since = None
        if not show_all:
            complete_since = timezone.now() - timedelta(days=COMPLETE_WINDOW_DAYS)
            regs = regs.exclude(status=Registration.Status.COMPLETE, updated_at__lt=complete_since)
        regs = prefetch_checklist(regs.select_related('student_profile')).order_by('-updated_at')
        docs = active_catalog()
        columns = {s: [] for s in STATUS_ORDER}
        for r in regs:
            columns.setdefault(r.status, []).append(_card(r, docs))
        return Response({'columns': [{'status': s, 'label': Registration.Status(s).label, 'cards': columns[s]} for s in STATUS_ORDER],
                         'bounded': not show_all,
                         'complete_window_days': None if show_all else COMPLETE_WINDOW_DAYS,
                         'complete_since': complete_since.isoformat() if complete_since else None,
                         'templates': {'missing_docs': _template()}})


def _template() -> str:
    from apps.content.models import SiteSettings
    return SiteSettings.load().tpl_missing_docs or DEFAULT_MISSING_DOCS_TEMPLATE


def documents_upload_url(reg: Registration, raw_token: str) -> str:
    """Link the family can redeem on /inscripcion/documentos (needs rid + a fresh
    single-use invite token; the persistent access_token UUID is NOT redeemable)."""
    return f"{(settings.FRONTEND_URL or '').rstrip('/')}/inscripcion/documentos?rid={reg.id}&token={raw_token}"


def render_missing_docs(reg: Registration, template: str | None = None, upload_url: str | None = None) -> tuple[str, list[str]]:
    """Render the missing-documents message. ``upload_url`` is injected by the
    sender (RequestDocsView issues the invite); the template preview shown in
    the pipeline uses a placeholder so previewing never rotates a family's link."""
    c = checklist(reg)
    upload_url = upload_url or f"{(settings.FRONTEND_URL or '').rstrip('/')}/inscripcion/documentos?rid={reg.id}&token=…"
    text = (template or _template()).format(
        parent_name=reg.parent1_name, child_name=f'{reg.child_first_name} {reg.child_last_name}',
        missing_list='\n'.join(f'• {m}' for m in c['missing']) or '• (nada pendiente)', upload_url=upload_url)
    return text, c['missing']


class RequestDocsView(APIView):
    admin_area = 'admisiones'
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from .services import request_missing_documents
        reg = get_object_or_404(Registration, pk=pk)
        out = request_missing_documents(reg, request.user)
        if not out['missing']:
            return Response({'detail': 'No falta ningún documento.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'sent_to': out['sent_to'], 'missing': out['missing'], 'text': out['text']})


def _password() -> str:
    from .convert import password
    return password()


class ConvertView(APIView):
    """Registration → StudentProfile + family logins. Idempotent: a second call returns the existing student.

    Only an APPROVED inscripción converts here. The conversion itself lives in
    ``admissions.convert.convert_registration`` (Fase 5: «Marcar como inscrito»
    in the Expediente runs the same service); see its docstring for the row
    lock and the guardian-linking rules."""
    admin_area = 'admisiones'
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from .convert import ConvertError, convert_registration

        get_object_or_404(Registration, pk=pk)
        try:
            result = convert_registration(
                pk, request.user, student_id=request.data.get('student_id') or '',
                grade=request.data.get('grade') or '', group=request.data.get('group') or '')
        except ConvertError as exc:
            return Response(exc.body, status=exc.status_code)
        return Response(result.as_dict(), status=status.HTTP_200_OK if result.already else status.HTTP_201_CREATED)


class TemplatesView(APIView):
    """GET/PATCH /admissions/admin/templates/ — editable message templates (Ajustes)."""
    admin_area = 'admisiones'
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response({'missing_docs': _template(), 'default_missing_docs': DEFAULT_MISSING_DOCS_TEMPLATE,
                         'placeholders': ['{parent_name}', '{child_name}', '{missing_list}', '{upload_url}']})

    def patch(self, request):
        from apps.content.models import SiteSettings
        tpl = str(request.data.get('missing_docs') or '')[:4000]
        try:
            tpl.format(parent_name='', child_name='', missing_list='', upload_url='')
        except (KeyError, IndexError, ValueError):
            return Response({'missing_docs': ['Solo puede usar {parent_name}, {child_name}, {missing_list} y {upload_url}.']}, status=status.HTTP_400_BAD_REQUEST)
        s = SiteSettings.load()
        s.tpl_missing_docs = tpl
        s.save()
        return Response({'missing_docs': _template()})

