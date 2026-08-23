"""
admissions/exports.py — CSV exports for the Admisiones console (BACKLOG P1-H3).

Every export is audit-logged (who exported what, with which filter) so personal
data leaving the system is traceable (LFPDPPP).
"""
import csv

from django.http import HttpResponse
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.exports import as_download, export_filename, fmt_dt
from apps.core.permissions import IsAdmin

from .models import PreRegistration, Registration


def _csv():
    resp = HttpResponse(content_type='text/csv; charset=utf-8')
    resp.write('﻿')
    return resp, csv.writer(resp)


class PreRegistrationExportView(APIView):
    """GET /api/v1/admissions/pre-register/export/?status=&search="""
    permission_classes = [IsAdmin]

    def get(self, request):
        qs = PreRegistration.objects.all().order_by('-created_at')
        p = request.query_params
        if p.get('status') in PreRegistration.Status.values:
            qs = qs.filter(status=p['status'])
        q = (p.get('search') or '').strip()
        if q:
            from django.db.models import Q
            qs = qs.filter(Q(child_first_name__icontains=q) | Q(child_last_name__icontains=q)
                           | Q(parent_name__icontains=q) | Q(parent_email__icontains=q))
        resp, w = _csv()
        w.writerow(['Fecha', 'Alumno', 'Nacimiento', 'Nivel', 'Grado', 'Ciclo', 'Tutor', 'Correo', 'Teléfono',
                    'Parentesco', 'Cómo nos conoció', 'Desea visita', 'Estado', 'Notas'])
        rows = list(qs[:5000])
        for r in rows:
            w.writerow([fmt_dt(r.created_at), f'{r.child_first_name} {r.child_last_name}', r.child_dob, r.get_level_display(),
                        r.grade_applying, r.cycle, r.parent_name, r.parent_email, r.parent_phone, r.relationship,
                        r.referral_source, 'Sí' if r.wants_visit else 'No', r.get_status_display(), r.notes])
        if rows:
            record('update', rows[0], {'export': 'pre-registros', 'rows': len(rows), 'filters': dict(p)},
                   actor=request.user, context='admissions.export')
        return as_download(resp, export_filename('pre-registros'))


class RegistrationExportView(APIView):
    """GET /api/v1/admissions/register/export/?status="""
    permission_classes = [IsAdmin]

    def get(self, request):
        qs = Registration.objects.all().order_by('-created_at')
        p = request.query_params
        if p.get('status') in Registration.Status.values:
            qs = qs.filter(status=p['status'])
        resp, w = _csv()
        w.writerow(['Creada', 'Enviada', 'Alumno', 'Nacimiento', 'Nivel', 'Grado', 'Ciclo',
                    'Tutor 1', 'Correo', 'Teléfono', 'Estado', 'Documentos aprobados'])
        rows = list(qs.prefetch_related('documents')[:5000])
        for r in rows:
            approved = sum(1 for d in r.documents.all() if d.is_verified)
            w.writerow([fmt_dt(r.created_at), fmt_dt(r.submitted_at), f'{r.child_first_name} {r.child_last_name}',
                        r.child_dob, r.level, r.grade_applying, r.cycle, r.parent1_name, r.parent1_email,
                        r.parent1_phone, r.get_status_display(), f'{approved}/{len(r.documents.all())}'])
        if rows:
            record('update', rows[0], {'export': 'inscripciones', 'rows': len(rows), 'filters': dict(p)},
                   actor=request.user, context='admissions.export')
        return as_download(resp, export_filename('inscripciones'))
