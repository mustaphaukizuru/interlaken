"""
Bulk student/parent import from CSV (admin only).

POST /api/v1/accounts/admin/import-students/
  multipart: file=<csv>, dry_run=1|0 (default 1 — preview, write nothing)

CSV headers (utf-8, BOM tolerated; header names case/space-insensitive):
  matricula, nombre, apellidos, grado, grupo, email_alumno, loyverse_id,
  nombre_padre, email_padre, telefono_padre
Required per row: matricula, nombre, apellidos, grado. Parent columns are
optional as a group, but if any is present email_padre is required.

Semantics (idempotent — re-importing the same file changes nothing):
  * matricula new  → create student User (unusable password) + StudentProfile.
  * matricula seen → update nombre/apellidos/grado/grupo/loyverse_id.
  * email_padre new  → create parent User (unusable password; logs in via
    Google OAuth with that email, or password reset once SMTP is live).
  * parent is always linked to the student (M2M add — safe to repeat).
Rows are processed independently (savepoint per row): one bad row never
blocks the rest, and every row gets a per-row result in the response.
"""
import csv
import io

from django.db import transaction
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import StudentProfile, User

MAX_ROWS = 500
REQUIRED = ('matricula', 'nombre', 'apellidos', 'grado')
KNOWN_HEADERS = REQUIRED + ('grupo', 'email_alumno', 'loyverse_id',
                            'nombre_padre', 'email_padre', 'telefono_padre')
STUDENT_EMAIL_DOMAIN = 'alumnos.interlaken.edu.mx'


class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated
                    and request.user.role == User.Role.ADMIN)


def _clean_headers(fieldnames):
    return [(h or '').strip().lower().replace(' ', '_') for h in fieldnames]


def _row_value(row, key):
    return (row.get(key) or '').strip()


def _split_name(full_name):
    parts = full_name.split()
    if len(parts) == 1:
        return parts[0], ''
    return ' '.join(parts[:-1]), parts[-1]


class ImportStudentsView(APIView):
    """Bulk CSV import with dry-run preview and per-row results."""
    permission_classes = [IsAdmin]

    def post(self, request):
        upload = request.FILES.get('file')
        if not upload:
            return Response({'error': 'Adjunte un archivo CSV en el campo "file".'},
                            status=status.HTTP_400_BAD_REQUEST)
        dry_run = str(request.data.get('dry_run', '1')).lower() in ('1', 'true', 'si', 'sí')

        try:
            text = upload.read().decode('utf-8-sig')
        except UnicodeDecodeError:
            return Response({'error': 'El archivo debe estar codificado en UTF-8.'},
                            status=status.HTTP_400_BAD_REQUEST)

        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            return Response({'error': 'CSV vacío o sin encabezados.'},
                            status=status.HTTP_400_BAD_REQUEST)
        reader.fieldnames = _clean_headers(reader.fieldnames)
        missing = [h for h in REQUIRED if h not in reader.fieldnames]
        if missing:
            return Response(
                {'error': f'Faltan columnas requeridas: {", ".join(missing)}.',
                 'expected_headers': list(KNOWN_HEADERS)},
                status=status.HTTP_400_BAD_REQUEST)

        rows = list(reader)
        if len(rows) > MAX_ROWS:
            return Response({'error': f'Máximo {MAX_ROWS} filas por archivo '
                                      f'(recibidas: {len(rows)}).'},
                            status=status.HTTP_400_BAD_REQUEST)

        results, stats = [], {'created_students': 0, 'updated_students': 0,
                              'created_parents': 0, 'errors': 0}
        seen_matriculas = set()

        for idx, row in enumerate(rows, start=2):   # 1 = header line
            outcome = self._process_row(row, idx, dry_run, seen_matriculas, stats)
            results.append(outcome)

        return Response({'dry_run': dry_run, 'total_rows': len(rows),
                         **stats, 'rows': results})

    def _process_row(self, row, line, dry_run, seen, stats):
        matricula = _row_value(row, 'matricula')
        nombre = _row_value(row, 'nombre')
        apellidos = _row_value(row, 'apellidos')
        grado = _row_value(row, 'grado')
        grupo = _row_value(row, 'grupo')
        loyverse_id = _row_value(row, 'loyverse_id')
        email_alumno = _row_value(row, 'email_alumno').lower()
        nombre_padre = _row_value(row, 'nombre_padre')
        email_padre = _row_value(row, 'email_padre').lower()
        tel_padre = _row_value(row, 'telefono_padre')

        def err(detail):
            stats['errors'] += 1
            return {'line': line, 'matricula': matricula or '—',
                    'action': 'error', 'detail': detail}

        if not all([matricula, nombre, apellidos, grado]):
            return err('Faltan datos requeridos (matricula, nombre, apellidos, grado).')
        if matricula in seen:
            return err('Matrícula duplicada dentro del archivo.')
        seen.add(matricula)
        if (nombre_padre or tel_padre) and not email_padre:
            return err('email_padre es requerido cuando hay datos del padre/tutor.')

        student_email = email_alumno or f'{matricula.lower()}@{STUDENT_EMAIL_DOMAIN}'
        existing = StudentProfile.objects.filter(student_id=matricula).select_related('user').first()
        action = 'actualizado' if existing else 'creado'
        parent_created = (bool(email_padre)
                          and not User.objects.filter(email=email_padre).exists())

        if dry_run:
            stats['updated_students' if existing else 'created_students'] += 1
            if parent_created:
                stats['created_parents'] += 1
            detail = f'Alumno sería {action}'
            if email_padre:
                detail += ('; padre/tutor sería creado y vinculado'
                           if parent_created else '; padre/tutor existente sería vinculado')
            return {'line': line, 'matricula': matricula, 'action': action,
                    'detail': detail}

        try:
            with transaction.atomic():
                if existing:
                    profile = existing
                    user = profile.user
                    user.first_name, user.last_name = nombre, apellidos
                    user.save(update_fields=['first_name', 'last_name'])
                    profile.grade = grado
                    if grupo:
                        profile.group = grupo
                    if loyverse_id:
                        profile.loyverse_id = loyverse_id
                    profile.save()
                    stats['updated_students'] += 1
                else:
                    if User.objects.filter(email=student_email).exists():
                        return err(f'El correo del alumno ya existe: {student_email}.')
                    user = User.objects.create_user(
                        email=student_email, password=None,
                        first_name=nombre, last_name=apellidos,
                        role=User.Role.STUDENT)
                    user.set_unusable_password()
                    user.save(update_fields=['password'])
                    profile = StudentProfile.objects.create(
                        user=user, student_id=matricula, grade=grado,
                        group=grupo, loyverse_id=loyverse_id)
                    stats['created_students'] += 1

                detail = f'Alumno {action}'
                if email_padre:
                    parent = User.objects.filter(email=email_padre).first()
                    if parent is None:
                        first, last = _split_name(nombre_padre or 'Padre/Tutor')
                        parent = User.objects.create_user(
                            email=email_padre, password=None,
                            first_name=first, last_name=last,
                            role=User.Role.PARENT)
                        parent.set_unusable_password()
                        if tel_padre:
                            parent.whatsapp = tel_padre
                        parent.save()
                        stats['created_parents'] += 1
                        detail += '; padre/tutor creado y vinculado'
                    else:
                        detail += '; padre/tutor vinculado'
                    profile.parents.add(parent)
        except Exception as exc:   # per-row isolation: report, keep importing
            return err(f'Error inesperado: {exc}')

        return {'line': line, 'matricula': matricula, 'action': action,
                'detail': detail}
