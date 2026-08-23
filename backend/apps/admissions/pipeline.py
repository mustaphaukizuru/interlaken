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

import secrets

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.permissions import IsAdmin

from .models import Registration, RegistrationDocument

REQUIRED_DOCS = [
    RegistrationDocument.DocType.BIRTH_CERT, RegistrationDocument.DocType.CURP_DOC, RegistrationDocument.DocType.PHOTO,
    RegistrationDocument.DocType.REPORT_CARD, RegistrationDocument.DocType.PROOF_ADDR, RegistrationDocument.DocType.VACCINATION,
]
DEFAULT_MISSING_DOCS_TEMPLATE = (
    'Hola {parent_name}:\n\nPara completar la inscripción de {child_name} nos falta recibir:\n{missing_list}\n\n'
    'Puede subirlos desde este enlace: {upload_url}\n\nGracias,\nAdmisiones Colegio Interlaken'
)
STATUS_ORDER = [Registration.Status.SUBMITTED, Registration.Status.REVIEWING, Registration.Status.APPROVED,
                Registration.Status.COMPLETE, Registration.Status.REJECTED]


def checklist(reg: Registration) -> dict:
    have = {d.doc_type: d for d in reg.documents.all()}
    items = []
    for dt in REQUIRED_DOCS:
        d = have.get(dt)
        state = 'missing' if d is None else ('verified' if d.is_verified else 'uploaded')
        items.append({'doc_type': dt, 'label': RegistrationDocument.DocType(dt).label, 'state': state})
    return {'items': items, 'missing': [i['label'] for i in items if i['state'] == 'missing'],
            'verified': sum(1 for i in items if i['state'] == 'verified'), 'required': len(REQUIRED_DOCS)}


def _card(reg: Registration) -> dict:
    c = checklist(reg)
    return {
        'id': reg.pk, 'child_name': f'{reg.child_first_name} {reg.child_last_name}', 'level': reg.level, 'grade_applying': reg.grade_applying,
        'parent_name': reg.parent1_name, 'parent_email': reg.parent1_email, 'parent_phone': reg.parent1_phone,
        'status': reg.status, 'submitted_at': reg.submitted_at.isoformat() if reg.submitted_at else None,
        'updated_at': reg.updated_at.isoformat(), 'docs_verified': c['verified'], 'docs_required': c['required'], 'missing': c['missing'],
        'student': getattr(getattr(reg, 'student_profile', None), 'pk', None),
    }


class PipelineView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        regs = Registration.objects.exclude(status=Registration.Status.DRAFT).prefetch_related('documents').order_by('-updated_at')
        columns = {s: [] for s in STATUS_ORDER}
        for r in regs:
            columns.setdefault(r.status, []).append(_card(r))
        return Response({'columns': [{'status': s, 'label': Registration.Status(s).label, 'cards': columns[s]} for s in STATUS_ORDER],
                         'templates': {'missing_docs': _template()}})


def _template() -> str:
    from apps.content.models import SiteSettings
    return SiteSettings.load().tpl_missing_docs or DEFAULT_MISSING_DOCS_TEMPLATE


def render_missing_docs(reg: Registration, template: str | None = None) -> tuple[str, list[str]]:
    c = checklist(reg)
    upload_url = f"{(settings.FRONTEND_URL or '').rstrip('/')}/inscripcion/documentos?token={reg.access_token}"
    text = (template or _template()).format(
        parent_name=reg.parent1_name, child_name=f'{reg.child_first_name} {reg.child_last_name}',
        missing_list='\n'.join(f'• {m}' for m in c['missing']) or '• (nada pendiente)', upload_url=upload_url)
    return text, c['missing']


class RequestDocsView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from apps.portal.services import send_email
        reg = get_object_or_404(Registration, pk=pk)
        text, missing = render_missing_docs(reg)
        if not missing:
            return Response({'detail': 'No falta ningún documento.'}, status=status.HTTP_400_BAD_REQUEST)
        send_email('Documentos pendientes para la inscripción', text, [reg.parent1_email], reply_to=settings.ADMISSIONS_EMAIL)
        record('update', reg, {'requested_docs': missing}, actor=request.user, context='admissions: solicitud de documentos')
        return Response({'sent_to': reg.parent1_email, 'missing': missing, 'text': text})


def _password() -> str:
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    return ''.join(secrets.choice(alphabet) for _ in range(10))


class ConvertView(APIView):
    """Registration → StudentProfile + family logins. Idempotent: a second call returns the existing student."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from apps.accounts.import_students import STUDENT_EMAIL_DOMAIN
        from apps.accounts.models import ParentProfile, StudentProfile, User
        reg = get_object_or_404(Registration, pk=pk)
        if reg.status not in (Registration.Status.APPROVED, Registration.Status.COMPLETE, Registration.Status.REVIEWING):
            return Response({'detail': 'Apruebe la solicitud antes de convertirla en alumno.'}, status=status.HTTP_400_BAD_REQUEST)
        existing = StudentProfile.objects.filter(registration=reg).first()
        if existing:
            return Response({'student': existing.pk, 'already': True, 'credentials': []})
        student_id = str(request.data.get('student_id') or '').strip() or f'{timezone.localdate().year % 100:02d}{reg.pk:04d}'
        if StudentProfile.objects.filter(student_id=student_id).exists():
            return Response({'student_id': ['Esa matrícula ya existe.']}, status=status.HTTP_400_BAD_REQUEST)
        grade = str(request.data.get('grade') or reg.grade_applying).strip()[:20]
        group = str(request.data.get('group') or '').strip()[:5]
        credentials = []
        with transaction.atomic():
            email = f'{student_id.lower()}@{STUDENT_EMAIL_DOMAIN}'
            su = User.objects.create_user(email=email, password=None, first_name=reg.child_first_name, last_name=reg.child_last_name, role=User.Role.STUDENT)
            su.set_unusable_password()
            su.save(update_fields=['password'])
            sp = StudentProfile.objects.create(
                user=su, student_id=student_id, grade=grade, group=group, enrollment_date=timezone.localdate(),
                birth_date=reg.child_dob, curp=reg.child_curp, emergency_name=reg.emergency_name, emergency_phone=reg.emergency_phone,
                emergency_rel=reg.emergency_rel, blood_type=reg.blood_type, allergies=reg.allergies, medical_notes=reg.medical_notes,
                registration=reg)
            sp.parents.add(su)
            for name, mail, phone in ((reg.parent1_name, reg.parent1_email, reg.parent1_phone), (reg.parent2_name, reg.parent2_email, reg.parent2_phone)):
                mail = (mail or '').strip().lower()
                if not mail:
                    continue
                parent = User.objects.filter(email__iexact=mail).first()
                created = False
                if parent is None:
                    first, _, last = (name or mail).strip().partition(' ')
                    parent = User.objects.create_user(email=mail, password=None, first_name=first, last_name=last, role=User.Role.PARENT)
                    pwd = _password()
                    parent.set_password(pwd)
                    parent.save(update_fields=['password'])
                    ParentProfile.objects.get_or_create(user=parent, defaults={'phone': phone or ''})
                    credentials.append({'email': mail, 'password': pwd, 'name': name})
                    created = True
                sp.parents.add(parent)
                if not created:
                    credentials.append({'email': mail, 'password': None, 'name': name})
            reg.status = Registration.Status.COMPLETE
            reg.save(update_fields=['status', 'updated_at'])
            record('create', sp, {'via': 'admissions.convert', 'registration': reg.pk, 'guardians': [c['email'] for c in credentials]},
                   actor=request.user, context='admissions: conversión a alumno')
        return Response({'student': sp.pk, 'student_id': student_id, 'credentials': credentials, 'already': False}, status=status.HTTP_201_CREATED)


class TemplatesView(APIView):
    """GET/PATCH /admissions/admin/templates/ — editable message templates (Ajustes)."""
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

