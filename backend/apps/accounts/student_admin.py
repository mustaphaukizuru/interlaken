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
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.bulk import AdminBulkView, BulkAction, BulkSkip
from apps.core.permissions import IsAdmin
from apps.core.transitions import assert_transition

from .import_students import STUDENT_EMAIL_DOMAIN
from .models import StudentProfile, User
from .serializers import StudentProfileSerializer

EDITABLE_PROFILE = ('student_id', 'grade', 'group', 'enrollment_date', 'is_active', 'loyverse_id', 'status',
                    'birth_date', 'curp', 'emergency_name', 'emergency_phone', 'emergency_rel',
                    'blood_type', 'allergies', 'medical_notes')
SENSITIVE = ('blood_type', 'allergies', 'medical_notes')
EDITABLE_USER = ('first_name', 'last_name', 'email')


class StudentWriteSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    student_id = serializers.CharField(max_length=20)
    grade = serializers.CharField(max_length=20)
    group = serializers.CharField(max_length=5, required=False, allow_blank=True)
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
        value = value.strip().upper()
        qs = StudentProfile.objects.filter(student_id=value)
        current = self.context.get('profile')
        if current is not None:
            qs = qs.exclude(pk=current.pk)
        if qs.exists():
            raise serializers.ValidationError('Ya existe un alumno con esa matrícula.')
        return value

    def validate_email(self, value):
        value = (value or '').strip().lower()
        if not value:
            return value
        qs = User.objects.filter(email__iexact=value)
        current = self.context.get('profile')
        if current is not None:
            qs = qs.exclude(pk=current.user_id)
        if qs.exists():
            raise serializers.ValidationError('Ese correo ya está registrado.')
        return value


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


class AdminStudentCreateView(APIView):
    """POST /api/v1/accounts/admin/students/ — create a student (admin)."""
    permission_classes = [IsAdmin]

    def post(self, request):
        ser = StudentWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        email = d.get('email') or f"{d['student_id'].lower()}@{STUDENT_EMAIL_DOMAIN}"
        if User.objects.filter(email__iexact=email).exists():
            return Response({'email': ['Ese correo ya está registrado.']}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            user = User.objects.create_user(
                email=email, password=None,
                first_name=d['first_name'].strip(), last_name=d['last_name'].strip(),
                role=User.Role.STUDENT)
            user.set_unusable_password()
            user.save(update_fields=['password'])
            profile = StudentProfile.objects.create(
                user=user, student_id=d['student_id'], grade=d['grade'].strip(),
                group=(d.get('group') or '').strip(), loyverse_id=(d.get('loyverse_id') or '').strip(),
                enrollment_date=d.get('enrollment_date'), is_active=d.get('is_active', True))
            if 'status' in d:
                profile.save(update_fields=profile.apply_status(d['status']))
            profile.parents.add(user)  # school-email family login sees its own file
            # StudentProfile is auto-audited by core.audit signals; add the actor context.
            record('create', profile, {'via': 'portal', 'snapshot': _snapshot(profile)},
                   actor=request.user, context='portal: alta de alumno')
        return Response(StudentProfileSerializer(profile, context={'include_medical': True}).data,
                        status=status.HTTP_201_CREATED)


class AdminStudentUpdateView(APIView):
    """PATCH /api/v1/accounts/admin/students/<pk>/ — edit identity/profile (admin)."""
    permission_classes = [IsAdmin]

    def patch(self, request, pk):
        try:
            profile = StudentProfile.objects.select_related('user').get(pk=pk)
        except StudentProfile.DoesNotExist:
            return Response({'detail': 'Alumno no encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        ser = StudentWriteSerializer(data=request.data, partial=True, context={'profile': profile})
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if not d:
            return Response(StudentProfileSerializer(profile, context={'include_medical': True}).data)

        before = _snapshot(profile)
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
            changes = _changes(before, _snapshot(profile))
            if changes:
                record('update', profile, {'via': 'portal', **changes},
                       actor=request.user, context='portal: edición de alumno')
        return Response(StudentProfileSerializer(profile, context={'include_medical': True}).data)


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
    )
}


def withdrawal_warnings(ids) -> list[dict]:
    """Students in ``ids`` whose wallet still holds money (C5: archiving a student
    surfaces the balance so the office refunds or transfers it first)."""
    from apps.cafeteria.models import CafeteriaBalance

    rows = (CafeteriaBalance.objects.filter(student_id__in=list(ids), balance__gt=0)
            .select_related('student__user').order_by('-balance', 'student_id'))
    return [{
        'id': cb.student_id,
        'name': cb.student.user.full_name,
        'student_id': cb.student.student_id,
        'balance': str(cb.balance),
        'message': f'{cb.student.user.full_name} ({cb.student.student_id}) tiene '
                   f'${cb.balance:,.2f} de saldo en cafetería.',
    } for cb in rows]


class AdminStudentBulkView(AdminBulkView):
    """POST /api/v1/accounts/admin/students/bulk/ — the C5 bulk contract for the roster.

    Actions: ``status`` (payload ``{"value": "active|on_leave|graduated|withdrawn"}``,
    under the ``accounts.studentprofile`` transition table; the dry run of a
    withdrawal lists the students that still hold a wallet balance under
    ``warnings``), ``grade`` / ``group`` (``{"value": "..."}``) and
    ``sync_loyverse`` (seed the opening balance of linked, never-seeded
    students). There is no delete: ``withdrawn`` is the archive.
    """
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
        if action == 'group' and _value(payload):
            payload['value'] = _value(payload).upper()
        self.validate_payload(action, payload)
        response = super().post(request)
        result = response.data
        if (result.get('dry_run') and action == 'status'
                and _value(payload) == StudentProfile.Status.WITHDRAWN):
            if data.get('all_matching'):
                ids = self.matching_ids(request, data.get('filters') or {})
            else:
                ids = [int(i) for i in data.get('ids') or []]
            result['warnings'] = withdrawal_warnings(ids)
        return response
