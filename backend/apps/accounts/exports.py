"""
accounts/exports.py — CSV roster export for the admin Alumnos list.

Mirrors the cafetería export pattern (apps/cafeteria/exports.py): es-MX headers
and a UTF-8 BOM so Excel opens accented names correctly.
"""
import csv

from django.db.models import Count, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.views import APIView

from apps.core.exports import export_filename, fmt_dt
from apps.core.permissions import IsAdmin

from .models import StudentProfile


def students_roster_csv(students) -> HttpResponse:
    """CSV of the roster: identity, grade/group, guardians count, status."""
    header = ['Alumno', 'Matrícula', 'Grado', 'Grupo', 'Correo', 'Tutores', 'Activo']

    response = HttpResponse(content_type='text/csv; charset=utf-8')
    response.write('﻿')  # BOM so Excel opens UTF-8 accents correctly
    writer = csv.writer(response)
    writer.writerow(['Directorio de alumnos'])
    writer.writerow(['Generado', fmt_dt(timezone.now())])
    writer.writerow([])
    writer.writerow(header)
    for s in students:
        writer.writerow([
            s.user.full_name,
            s.student_id,
            s.grade,
            s.group,
            s.user.email,
            s.guardians_count,
            'Sí' if s.is_active else 'No',
        ])
    response['Content-Disposition'] = f'attachment; filename="{export_filename("alumnos")}"'
    return response


class AdminExportStudentsView(APIView):
    """GET /api/v1/accounts/admin/export/students/?search= — roster CSV (admin).

    Honors the same ``search`` the Alumnos list uses (name / matrícula / email /
    grade) so the download matches what the admin is looking at.
    """
    permission_classes = [IsAdmin]

    def get(self, request):
        qs = (StudentProfile.objects.select_related('user')
              .annotate(guardians_count=Count('parents', distinct=True))
              .order_by('user__last_name', 'user__first_name', 'id'))
        term = (request.query_params.get('search') or '').strip()
        if term:
            qs = qs.filter(
                Q(user__first_name__icontains=term)
                | Q(user__last_name__icontains=term)
                | Q(user__email__icontains=term)
                | Q(student_id__icontains=term)
                | Q(grade__icontains=term))
        return students_roster_csv(qs)
