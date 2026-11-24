"""
accounts/student_admin.py — portal student editor (BACKLOG P1-A1).

The portal is where staff create and edit students (ownership map AF-3 rule 1);
the Django admin only mirrors them. Creating a student here mirrors the CSV
importer exactly: a school-email User (synthetic ``<matricula>@alumnos...``
address unless a real one is given), NO usable password (an admin assigns one
on request, AE5), the profile, and the self-guardian link so the school-email
login sees its own file.

Every mutation writes an AuditLog row with the changed fields.
"""
from __future__ import annotations

from django.db import transaction
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.bulk import AdminBulkView, BulkAction, BulkSkip
from apps.core.flags import truthy
from apps.core.permissions import IsAdmin
from apps.core.transitions import assert_transition

from .import_students import STUDENT_EMAIL_DOMAIN
from .models import StudentProfile, User
from .serializers import StudentProfileSerializer
from .student_delete import (
    DELETE_CONFIRMATION,
    archive_student,
    removal_plan,
    remove_student,
    restore_student,
)

EDITABLE_PROFILE = ('student_id', 'grade', 'group', 'tipo', 'puesto', 'enrollment_date', 'is_active',
                    'loyverse_id', 'status',
                    'birth_date', 'curp', 'emergency_name', 'emergency_phone', 'emergency_rel',
                    'blood_type', 'allergies', 'medical_notes')
SENSITIVE = ('blood_type', 'allergies', 'medical_notes')


def _student_payload(profile, user) -> dict:
    """The file as the editor returns it, medical data masked like the read endpoint.

    Admins see it; «Alumnos» staff never do (accounts.medical): before, the
    editor's create/PATCH answers carried the real allergies to any staff.
    """
    from .medical import mask_medical, medical_access

    data = StudentProfileSerializer(profile, context={'include_medical': True}).data
    allowed, reason = medical_access(user, profile)
    if not allowed:
        mask_medical(data)
        data['medical_masked'] = reason
    return data
EDITABLE_USER = ('first_name', 'last_name', 'email')


class StudentWriteSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    # «Matrícula o código Loyverse» (A6): written as the office types it, in
    # any case. Pupils keep normalize_matricula (``ci09932`` → ``09932``).
    student_id = serializers.CharField(max_length=20)
    # A pupil needs a grade; a staff member (``tipo='personal'``) has a
    # ``puesto`` instead. Checked in ``validate``.
    grade = serializers.CharField(max_length=20, required=False, allow_blank=True)
    group = serializers.CharField(max_length=5, required=False, allow_blank=True)
    tipo = serializers.ChoiceField(choices=StudentProfile.Tipo.choices, required=False)
    puesto = serializers.ChoiceField(choices=StudentProfile.Puesto.choices, required=False,
                                     allow_blank=True)
    enrollment_date = serializers.DateField(required=False, allow_null=True)
    is_active = serializers.BooleanField(required=False)
    status = serializers.ChoiceField(choices=StudentProfile.Status.choices, required=False)
    birth_date = serializers.DateField(required=False, allow_null=True)
    curp = serializers.CharField(max_length=20, required=False, allow_blank=True)
    emergency_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    emergency_phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    emergency_rel = serializers.CharField(max_length=50, required=False, allow_blank=True)
    blood_type = serializers.CharField(max_length=10, required=False, allow_blank=True)
    allergies = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    medical_notes = serializers.CharField(max_length=4000, required=False, allow_blank=True)

    def validate_curp(self, value):
        return (value or '').strip().upper()
    loyverse_id = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def __init__(self, *args, partial=False, **kwargs):
        super().__init__(*args, partial=partial, **kwargs)
        if partial:
            for f in self.fields.values():
                f.required = False

    def validate_student_id(self, value):
        # Normalised per tipo in ``validate`` (a staff code is kept as written).
        return (value or '').strip()

    def validate_email(self, value):
        value = (value or '').strip().lower()
        if not value:
            return value
        qs = User.objects.filter(email__iexact=value)
        current = self.context.get('profile')
        if current is not None:
            qs = qs.exclude(pk=current.user_id)
        existing = qs.first()
        if existing is not None:
            # A staff member whose address already has an account (a console
            # user such as colegio@, or a parent) keeps it: the cafetería
            # account is attached to that login (AdminStudentCreateView).
            attachable = (current is None
                          and self.initial_data.get('tipo') == StudentProfile.Tipo.PERSONAL
                          and not StudentProfile.objects.filter(user_id=existing.pk).exists())
            if not attachable:
                raise serializers.ValidationError('Ese correo ya está registrado.')
        return value

    def validate(self, attrs):
        from .people import normalize_code

        current = self.context.get('profile')
        default_tipo = current.tipo if current is not None else StudentProfile.Tipo.ALUMNO
        tipo = attrs.get('tipo') or default_tipo
        personal = tipo == StudentProfile.Tipo.PERSONAL
        if 'student_id' in attrs or current is None:
            # Spelled like every other matrícula input (importers, Loyverse,
            # admissions): «CI09932» is stored as «09932», never as a second
            # student. Compared case-insensitively: «JPEREZ» is «jperez».
            code = normalize_code(attrs.get('student_id'), tipo)
            if not code:
                raise serializers.ValidationError(
                    {'student_id': ['Escriba la matrícula o el código Loyverse.']})
            qs = StudentProfile.objects.filter(student_id__iexact=code)
            if current is not None:
                qs = qs.exclude(pk=current.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {'student_id': ['Ya existe un alumno con esa matrícula.']})
            attrs['student_id'] = code
        tipo_changed = current is None or current.tipo != tipo
        if personal:
            # A staff member has no grade or group: never promoted, counted or
            # targeted by grade.
            attrs['grade'] = ''
            attrs['group'] = ''
            if 'puesto' in attrs or tipo_changed:
                attrs['puesto'] = attrs.get('puesto') or StudentProfile.Puesto.SIN_ASIGNAR
        else:
            needs_grade = tipo_changed or 'grade' in attrs
            grade = attrs['grade'] if 'grade' in attrs else (current.grade if current else '')
            if needs_grade and not (grade or '').strip():
                raise serializers.ValidationError({'grade': ['Seleccione el grado.']})
            if tipo_changed:
                attrs['puesto'] = ''
            else:
                attrs.pop('puesto', None)
        return attrs


def _changes(before: dict, after: dict) -> dict:
    return {k: {'from': before[k], 'to': after[k]} for k in after if before.get(k) != after[k]}


def _snapshot(profile: StudentProfile) -> dict:
    u = profile.user
    snap = {k: getattr(u, k) for k in EDITABLE_USER}
    snap.update({k: getattr(profile, k) for k in EDITABLE_PROFILE})
    for k in ('enrollment_date', 'birth_date'):
        snap[k] = snap[k].isoformat() if snap[k] else None
    # Never persist medical values in the audit payload (only that they changed).
    for k in SENSITIVE:
        snap[k] = '[set]' if snap[k] else ''
    return snap


def _existing_student(student_id, tipo=StudentProfile.Tipo.ALUMNO) -> dict | None:
    """The record that already holds ``student_id``, archived ones included, so the
    form can offer to open or restore it instead of creating a second copy.
    Case-insensitive (A6): «JPEREZ» and «jperez» are one code."""
    from .people import normalize_code

    sid = normalize_code(str(student_id or ''), tipo)
    profile = (StudentProfile.objects.filter(student_id__iexact=sid).select_related('user').first()
               if sid else None)
    if profile is None:
        return None
    return {'id': profile.id, 'name': profile.user.full_name, 'student_id': profile.student_id,
            'status': profile.status, 'archived': profile.user.archived_at is not None,
            'tipo': profile.tipo}


def _link_on_save(profile, actor) -> dict:
    """Link ``profile`` to its Loyverse customer now (A7) and return the
    outcome the form shows. Never raises: the person is already saved."""
    import logging

    from apps.cafeteria.services import link_profile_on_save

    try:
        return link_profile_on_save(profile, actor=actor)
    except Exception:  # noqa: BLE001 - the save already succeeded
        logging.getLogger(__name__).exception('Link on save failed for profile %s', profile.pk)
        return {'status': 'error',
                'message': 'No se pudo vincular con Loyverse ahora; se vinculará en la '
                           'próxima sincronización.'}


def _is_admin_login(user) -> bool:
    return bool(getattr(user, 'role', None) == User.Role.ADMIN or getattr(user, 'is_superuser', False))


def _may_change_login_email(requester, target) -> bool:
    """Families' logins: anyone with «Alumnos». A staff login: an administrator.
    An administrator's login: never from the student editor."""
    if _is_admin_login(target):
        return False
    if target.role == User.Role.STAFF or target.is_staff:
        return _is_admin_login(requester)
    return True


class AdminStudentCreateView(APIView):
    """POST /api/v1/accounts/admin/students/ — create a student (admin).

    A matrícula already on file is refused with ``existing`` (id, name, whether
    archived), so the console can point to that record instead of a duplicate.
    """
    admin_area = 'alumnos'
    permission_classes = [IsAdmin]

    def post(self, request):
        tipo = request.data.get('tipo') or StudentProfile.Tipo.ALUMNO
        existing = _existing_student(request.data.get('student_id'), tipo)
        if existing is not None:
            return Response({'student_id': ['Ya existe un alumno con esa matrícula.'], 'existing': existing},
                            status=status.HTTP_400_BAD_REQUEST)
        ser = StudentWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        personal = d.get('tipo') == StudentProfile.Tipo.PERSONAL
        email = d.get('email') or f"{d['student_id'].lower()}@{STUDENT_EMAIL_DOMAIN}"
        # A staff member whose address already has an account keeps it (and its
        # role: a console user stays one); validate_email let through only a
        # login that holds no cafetería account yet.
        attach = User.objects.filter(email__iexact=email).first() if personal else None
        if attach is None and User.objects.filter(email__iexact=email).exists():
            return Response({'email': ['Ese correo ya está registrado.']}, status=status.HTTP_400_BAD_REQUEST)
        if attach is not None and _is_admin_login(attach) and not _is_admin_login(request.user):
            # QA 2026-11-24: attaching a cafetería account to an administrator's
            # login handed «Alumnos» staff a record whose email they could edit.
            return Response({'email': ['Solo un administrador puede crear la cuenta de cafetería '
                                       'de otro administrador.']}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            if attach is not None:
                user = attach
            else:
                user = User.objects.create_user(
                    email=email, password=None,
                    first_name=d['first_name'].strip(), last_name=d['last_name'].strip(),
                    role=User.Role.STUDENT)
                user.set_unusable_password()
                user.save(update_fields=['password'])
            profile = StudentProfile.objects.create(
                user=user, student_id=d['student_id'], grade=(d.get('grade') or '').strip(),
                group=(d.get('group') or '').strip(), loyverse_id=(d.get('loyverse_id') or '').strip(),
                tipo=d.get('tipo') or StudentProfile.Tipo.ALUMNO, puesto=d.get('puesto') or '',
                enrollment_date=d.get('enrollment_date'), is_active=d.get('is_active', True))
            if 'status' in d:
                profile.save(update_fields=profile.apply_status(d['status']))
            if not personal:
                profile.parents.add(user)  # school-email family login sees its own file
            # StudentProfile is auto-audited by core.audit signals; add the actor context.
            record('create', profile, {'via': 'portal', 'snapshot': _snapshot(profile)},
                   actor=request.user,
                   context='portal: alta de personal' if personal else 'portal: alta de alumno')
        # A7: look the person up in Loyverse right away (read-only), after the
        # commit so a slow Loyverse never holds a row lock.
        link = _link_on_save(profile, request.user)
        return Response({**_student_payload(profile, request.user), 'loyverse_link': link},
                        status=status.HTTP_201_CREATED)


class AdminStudentUpdateView(APIView):
    """PATCH /api/v1/accounts/admin/students/<pk>/ — edit identity/profile (admin)."""
    admin_area = 'alumnos'
    permission_classes = [IsAdmin]

    def patch(self, request, pk):
        try:
            profile = StudentProfile.objects.select_related('user').get(pk=pk)
        except StudentProfile.DoesNotExist:
            return Response({'detail': 'Alumno no encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        ser = StudentWriteSerializer(data=request.data, partial=True, context={'profile': profile})
        ser.is_valid(raise_exception=True)
        d = dict(ser.validated_data)
        # Medical fields: only someone who may read them may write them, and the
        # mask itself is never stored. «Alumnos» staff see «●●●» in the form;
        # saving it back used to overwrite the real allergies with the mask.
        from .medical import MASK, medical_access
        may_edit_medical = medical_access(request.user, profile)[0]
        for f in SENSITIVE:
            if f in d and (not may_edit_medical or d[f] == MASK):
                d.pop(f)
        if not d:
            return Response(_student_payload(profile, request.user))

        new_email = (d.get('email') or '').strip().lower()
        if new_email and new_email != (profile.user.email or '').lower() and not _may_change_login_email(
                request.user, profile.user):
            # QA 2026-11-24: the email IS the login (Google sign-in matches it),
            # so changing a console account's email here let «Alumnos» staff
            # sign in as an administrator. Like passwords (admin_password.py),
            # a staff login's email is changed by an administrator, and an
            # administrator's never from the student editor.
            return Response({'email': ['El correo de una cuenta del personal solo lo cambia un administrador, '
                                       'y el de un administrador no se cambia desde aquí.']},
                            status=status.HTTP_403_FORBIDDEN)

        before = _snapshot(profile)
        old_loyverse_id = profile.loyverse_id or ''
        with transaction.atomic():
            user = profile.user
            user_fields = []
            for k in EDITABLE_USER:
                if k in d and d[k] != '' or (k == 'email' and d.get('email')):
                    setattr(user, k, d[k].strip() if isinstance(d[k], str) else d[k])
                    user_fields.append(k)
            if user_fields:
                user.save(update_fields=user_fields)
            prof_fields = []
            for k in EDITABLE_PROFILE:
                if k in d and k != 'status':
                    setattr(profile, k, d[k].strip() if isinstance(d[k], str) else d[k])
                    prof_fields.append(k)
            if 'status' in d:
                prof_fields += profile.apply_status(d['status'])
            elif 'is_active' in d:
                # Legacy toggle: keep status coherent with the boolean.
                prof_fields += profile.apply_status(
                    StudentProfile.Status.ACTIVE if d['is_active'] else StudentProfile.Status.WITHDRAWN)
            prof_fields = list(dict.fromkeys(prof_fields))
            if prof_fields:
                profile.save(update_fields=prof_fields)
            if old_loyverse_id and (profile.loyverse_id or '') != old_loyverse_id:
                # The wallet was seeded from (and is mirrored against) the OLD
                # customer's points; left as is, the next POS mirror pass would
                # credit the new customer's points minus this wallet as a fake
                # "recarga". Re-seed it from the new customer instead (audited).
                from apps.cafeteria.services import reset_wallet_seed
                reset_wallet_seed(profile, old_loyverse_id=old_loyverse_id, actor=request.user,
                                  context='portal: cambio de cliente Loyverse')
            changes = _changes(before, _snapshot(profile))
            if changes:
                record('update', profile, {'via': 'portal', **changes},
                       actor=request.user, context='portal: edición de alumno')
        link = None
        if 'student_id' in changes or 'email' in changes:
            # A7: a new code or address may now match a Loyverse customer.
            link = _link_on_save(profile, request.user)
        payload = _student_payload(profile, request.user)
        if link is not None:
            payload['loyverse_link'] = link
        return Response(payload)


# ── bulk actions (Data Ops C5) ─────────────────────────────
STUDENT_ENTITY = 'accounts.studentprofile'
STATUS_LABEL = dict(StudentProfile.Status.choices)


def _value(payload) -> str:
    return str(payload.get('value') or '').strip()


def _plan_status(profile, payload):
    assert_transition(STUDENT_ENTITY, profile.status, _value(payload))


def _apply_status(profile, payload, actor):
    target = _value(payload)
    current = profile.status
    assert_transition(STUDENT_ENTITY, current, target)
    profile.save(update_fields=profile.apply_status(target))
    return {'status': [current, target], 'via': 'portal-bulk'}


def _field_action(field: str, label: str):
    def plan(profile, payload):
        if getattr(profile, field) == _value(payload):
            raise BulkSkip(f'Ya tiene ese {label}.')

    def handler(profile, payload, actor):
        value = _value(payload)
        before = getattr(profile, field)
        if before == value:
            raise BulkSkip(f'Ya tiene ese {label}.')
        setattr(profile, field, value)
        profile.save(update_fields=[field])
        return {field: [before, value], 'via': 'portal-bulk'}

    return plan, handler


def _plan_sync(profile, payload):
    if not profile.loyverse_id:
        raise BulkSkip('No está vinculado a Loyverse.')
    cb = getattr(profile, 'cafeteria_balance', None)
    if cb is not None and cb.last_synced is not None:
        raise BulkSkip('El saldo ya está sincronizado (el ledger local manda).')


def _apply_sync(profile, payload, actor):
    from apps.cafeteria.services import LoyverseError, sync_student_balance

    _plan_sync(profile, payload)
    try:
        balance = sync_student_balance(profile)
    except LoyverseError as exc:
        raise ValueError(f'Loyverse no respondió: {exc}') from None
    return {'seeded_balance': str(balance), 'via': 'portal-bulk'}


def _plan_delete(profile, payload):
    return removal_plan(profile)


def _apply_delete(profile, payload, actor):
    return {**remove_student(profile), 'via': 'portal-bulk'}


def _plan_archive(profile, payload):
    if profile.user.archived_at is not None:
        raise BulkSkip('ya está archivado')
    return 'archived'


def _apply_archive(profile, payload, actor):
    return {**archive_student(profile), 'via': 'portal-bulk'}


def _plan_restore(profile, payload):
    if profile.user.archived_at is None:
        raise BulkSkip('no está archivado')
    return 'restored'


def _apply_restore(profile, payload, actor):
    # payload.undo: the toast's «Deshacer» puts the previous status back.
    return {**restore_student(profile, undo=bool(payload.get('undo'))), 'via': 'portal-bulk'}


_plan_grade, _apply_grade = _field_action('grade', 'grado')
_plan_group, _apply_group = _field_action('group', 'grupo')

STUDENT_BULK_ACTIONS = {
    a.name: a for a in (
        BulkAction('status', 'Cambiar estado', handler=_apply_status, plan=_plan_status,
                   side_effects='none'),
        BulkAction('grade', 'Cambiar grado', handler=_apply_grade, plan=_plan_grade,
                   side_effects='none'),
        BulkAction('group', 'Cambiar grupo', handler=_apply_group, plan=_plan_group,
                   side_effects='none'),
        # Seeds the opening wallet balance from Loyverse for linked students
        # that were never seeded (sync_student_balance); a no-op otherwise.
        BulkAction('sync_loyverse', 'Sincronizar con Loyverse', handler=_apply_sync,
                   plan=_plan_sync, side_effects='per_row'),
        # Admins only (see post): erases a record with nothing to keep and
        # archives the rest; each row reports which (student_delete.py).
        BulkAction('delete', 'Eliminar', handler=_apply_delete,
                   plan=_plan_delete, side_effects='none', audit_action='delete'),
        BulkAction('archive', 'Archivar', handler=_apply_archive, plan=_plan_archive,
                   side_effects='none'),
        BulkAction('restore', 'Restaurar', handler=_apply_restore, plan=_plan_restore,
                   side_effects='none'),
    )
}


def withdrawal_warnings(ids) -> list[dict]:
    """Students in ``ids`` whose wallet still holds money or who have a paid top-up
    waiting for the POS (C5: archiving a student surfaces both, so the office
    refunds or loads them first)."""
    from apps.cafeteria.models import CafeteriaBalance, TopUpRequest

    rows = (CafeteriaBalance.objects.filter(student_id__in=list(ids), balance__gt=0)
            .select_related('student__user').order_by('-balance', 'student_id'))
    warnings = [{
        'id': cb.student_id,
        'name': cb.student.user.full_name,
        'student_id': cb.student.student_id,
        'balance': str(cb.balance),
        'message': f'{cb.student.user.full_name} ({cb.student.student_id}) tiene '
                   f'${cb.balance:,.2f} de saldo en cafetería.',
    } for cb in rows]
    paid = (TopUpRequest.objects.filter(student_id__in=list(ids), status=TopUpRequest.Status.PAID)
            .select_related('student__user').order_by('student_id', 'pk'))
    warnings += [{
        'id': f'topup-{t.pk}',
        'name': t.student.user.full_name,
        'student_id': t.student.student_id,
        'balance': str(t.amount),
        'message': f'{t.student.user.full_name} ({t.student.student_id}) tiene una recarga '
                   f'pagada de ${t.amount:,.2f} por aplicar en Loyverse.',
    } for t in paid]
    return warnings


class AdminStudentBulkView(AdminBulkView):
    """POST /api/v1/accounts/admin/students/bulk/ — the C5 bulk contract for the roster.

    Actions: ``status`` (payload ``{"value": "active|on_leave|graduated|withdrawn"}``,
    under the ``accounts.studentprofile`` transition table; the dry run of a
    withdrawal lists the students that still hold a wallet balance under
    ``warnings``), ``grade`` / ``group`` (``{"value": "..."}``) and
    ``sync_loyverse`` (seed the opening balance of linked, never-seeded
    students), ``archive`` / ``restore`` (off and back on the lists, history
    kept) and ``delete`` (admins only, ``{"confirm": "ELIMINAR"}`` on the
    commit; erases a record with nothing to keep and archives the rest, counted
    under ``outcomes``). The dry run of a withdrawal, an archive or a delete
    lists who still holds money or a paid top-up under ``warnings``.
    """
    admin_area = 'alumnos'
    entity = STUDENT_ENTITY
    actions = STUDENT_BULK_ACTIONS

    @property
    def list_view_class(self):
        from .views import StudentListView
        return StudentListView

    def get_queryset(self):
        return StudentProfile.objects.select_related('user', 'cafeteria_balance')

    def validate_payload(self, action: str, payload: dict):
        value = _value(payload)
        if action == 'status' and value not in StudentProfile.Status.values:
            raise ValidationError({'value': ['Estado no válido.']})
        if action == 'grade' and not 1 <= len(value) <= 20:
            raise ValidationError({'value': ['Indique un grado de hasta 20 caracteres.']})
        if action == 'group' and not 1 <= len(value) <= 5:
            raise ValidationError({'value': ['Indique un grupo de hasta 5 caracteres.']})

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        payload = data.get('payload') if isinstance(data.get('payload'), dict) else {}
        action = str(data.get('action') or '')
        if action == 'delete':
            # The roster area is enough to archive; only an admin may erase.
            if request.user.role != User.Role.ADMIN:
                raise PermissionDenied('Solo un administrador puede eliminar alumnos.')
            if not truthy(data.get('dry_run', False)) and payload.get('confirm') != DELETE_CONFIRMATION:
                raise ValidationError({'confirm': ['Confirme la eliminación.']})
        if action == 'group' and _value(payload):
            payload['value'] = _value(payload).upper()
        self.validate_payload(action, payload)
        response = super().post(request)
        result = response.data
        leaving = action in ('archive', 'delete') or (
            action == 'status' and _value(payload) == StudentProfile.Status.WITHDRAWN)
        if result.get('dry_run') and leaving:
            if data.get('all_matching'):
                ids = self.matching_ids(request, data.get('filters') or {})
            else:
                ids = [int(i) for i in data.get('ids') or []]
            result['warnings'] = withdrawal_warnings(ids)
        return response


class AdminStudentHistoryView(APIView):
    """GET /api/v1/accounts/admin/students/<pk>/history/ — the student's record in Auditoría.

    Changes to the file and to its login, newest first (the last 100). Wallet
    movements live in Cafetería: one row per purchase would drown the rest.
    """
    admin_area = 'alumnos'
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        from django.db.models import Q

        from apps.core.models import AuditLog
        from apps.core.serializers import AuditLogSerializer

        profile = StudentProfile.objects.filter(pk=pk).only('id', 'user_id').first()
        if profile is None:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        rows = (AuditLog.objects.select_related('actor')
                .filter(Q(object_type='accounts.studentprofile', object_id=str(profile.id))
                        | Q(object_type='accounts.user', object_id=str(profile.user_id)))
                .order_by('-created_at', '-pk')[:100])
        return Response(AuditLogSerializer(rows, many=True).data)

