"""
accounts/staff_users.py — portal staff-user management (BACKLOG P1-H1, AF-4 gap 3).

GET   /accounts/admin/staff/            list admin + staff accounts (archived ones: ?activo=archivadas)
POST  /accounts/admin/staff/            invite: create with a generated password (returned once)
PATCH /accounts/admin/staff/<pk>/       role / active / name / email
POST  /accounts/admin/staff/<pk>/reset-password/   new generated password (returned once)
GET   /accounts/admin/staff/<pk>/activity/         the account and its last actions in Auditoría
POST  /accounts/admin/staff/bulk/       deactivate / reactivate / archive / restore / delete

Guards: only admins; an admin cannot deactivate or demote themselves; the last
active admin cannot be demoted/deactivated; superusers are untouchable here
(they belong to the Django admin). The password reset only targets non-admin
staff: an admin who could rewrite a peer admin's password (and read it back)
would own that account, the same rule ``admin_password`` and
``password_requests`` enforce.
"""
from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from rest_framework import generics, serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.areas import AREAS, PUESTOS, clean_areas
from apps.core.audit import record
from apps.core.bulk import AdminBulkView, BulkAction, BulkSkip
from apps.core.exporting import AdminExportMixin, Col, ExportSpec
from apps.core.filtersets import parse_bool_param
from apps.core.importing import (
    ImportCol,
    ImportSpec,
    ImportTemplateView,
    ImportView,
    parse_choice,
    parse_email,
)
from apps.core.listing import AdminListMixin
from apps.core.permissions import IsAdmin

from .account_removal import archive_account, has_history, restore_account
from .admin_password import generate_temporary_password, revoke_refresh_tokens
from .filters import StaffFilterSet
from .models import User

STAFF_ROLES = (User.Role.ADMIN, User.Role.STAFF)


class StaffUserSerializer(serializers.ModelSerializer):
    full_name = serializers.ReadOnlyField()
    has_password = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'email', 'first_name', 'last_name', 'full_name', 'role', 'is_active',
                  'is_superuser', 'last_login', 'date_joined', 'has_password',
                  'staff_title', 'staff_areas', 'archived_at']
        read_only_fields = fields

    def get_has_password(self, u):
        return u.has_usable_password()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Stored areas only matter for role staff; an admin uses every area.
        if instance.role != User.Role.STAFF:
            data['staff_areas'] = []
        return data


def parse_staff_access(data, *, role, current_title='', current_areas=None):
    """``(title, areas, errors)`` from a create/edit body.

    ``staff_areas`` is a list of area keys; ``puesto`` (secretaria, recepcion,
    cafeteria) fills both from the preset, and an explicit ``staff_title`` or
    ``staff_areas`` in the same body wins. An admin keeps no stored areas: it
    uses all of them.
    """
    errors = {}
    title = current_title
    areas = list(current_areas or [])
    puesto = str(data.get('puesto') or '').strip().lower()
    if puesto:
        if puesto not in PUESTOS:
            errors['puesto'] = ['Puesto desconocido.']
        else:
            title, areas = PUESTOS[puesto][0], list(PUESTOS[puesto][1])
    if 'staff_title' in data:
        title = str(data.get('staff_title') or '').strip()[:60]
    if 'staff_areas' in data:
        raw = data.get('staff_areas')
        if not isinstance(raw, (list, tuple)):
            errors['staff_areas'] = ['Envíe una lista de áreas.']
        else:
            try:
                areas = clean_areas(raw)
            except ValueError as exc:
                errors['staff_areas'] = [str(exc)]
    if role != User.Role.STAFF:
        areas = []
    return title, areas, errors


STAFF_ORDERING = {
    'name': ('last_name', 'first_name'),
    'email': 'email',
    'role': 'role',
    'is_active': 'is_active',
    'last_login': 'last_login',
    'date_joined': 'date_joined',
}


def _guard_target(request, target):
    if target.is_superuser:
        return 'Las cuentas superusuario se administran desde el panel técnico.'
    if target.role not in STAFF_ROLES:
        return 'Solo se administran cuentas del personal aquí.'
    return None


def last_active_admin(target) -> bool:
    """True when ``target`` is the only active admin left (the console must keep one)."""
    return not User.objects.filter(role=User.Role.ADMIN, is_active=True).exclude(pk=target.pk).exists()


class StaffListCreateView(AdminListMixin, generics.ListAPIView):
    """GET (list contract: ``q``, ``ordering``, ``role``/``rol``, ``active``/``activo``,
    ``page_size``) and POST (invite) on /accounts/admin/staff/."""

    serializer_class = StaffUserSerializer
    search_fields = ('email', 'first_name', 'last_name')
    ordering = STAFF_ORDERING
    default_ordering = ('-is_active', 'role', 'last_name', 'first_name')
    filterset_class = StaffFilterSet

    def get_queryset(self):
        return User.objects.filter(role__in=STAFF_ROLES)

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        first = (request.data.get('first_name') or '').strip()
        last = (request.data.get('last_name') or '').strip()
        role = request.data.get('role') or User.Role.STAFF
        title, areas, errors = parse_staff_access(request.data, role=role)
        if not email or '@' not in email:
            errors['email'] = ['Correo inválido.']
        elif User.objects.filter(email__iexact=email).exists():
            errors['email'] = ['Ese correo ya está registrado.']
        if not first:
            errors['first_name'] = ['Requerido.']
        if role not in STAFF_ROLES:
            errors['role'] = ['Rol inválido.']
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        password = generate_temporary_password()
        with transaction.atomic():
            user = User.objects.create_user(email=email, password=password, first_name=first, last_name=last,
                                            role=role, is_staff=(role == User.Role.ADMIN),
                                            staff_title=title, staff_areas=areas)
            record('create', user, {'via': 'portal', 'role': role, 'staff_title': title,
                                    'staff_areas': areas},
                   actor=request.user, context='portal: alta de personal')
        data = StaffUserSerializer(user).data
        data['temporary_password'] = password  # shown once
        return Response(data, status=status.HTTP_201_CREATED)


class StaffExportView(AdminExportMixin, StaffListCreateView):
    """GET /accounts/admin/staff/export/?fmt=csv|xlsx|pdf — audited, throttled."""

    http_method_names = ['get', 'head', 'options']  # never the inherited invite POST

    export_spec = ExportSpec(
        filename_prefix='usuarios',
        title='Usuarios del personal',
        sheet_title='Usuarios',
        audit_entity='staff',
        columns=[
            Col('name', 'Nombre', lambda u: u.full_name, width=28),
            Col('email', 'Correo', width=32),
            Col('role', 'Rol', lambda u: u.get_role_display(), width=14),
            Col('staff_title', 'Puesto', width=16),
            Col('staff_areas', 'Áreas de la consola', lambda u: (
                'Todas' if u.role == User.Role.ADMIN else
                ', '.join(AREAS[a][0] for a in AREAS if a in (u.staff_areas or [])) or '—'),
                width=40),
            Col('is_active', 'Activo', width=8, fmt='bool'),
            Col('is_superuser', 'Superusuario', width=8, fmt='bool'),
            Col('has_password', 'Contraseña asignada', lambda u: u.has_usable_password(),
                width=10, fmt='bool'),
            Col('last_login', 'Último acceso', width=17, fmt='datetime'),
            Col('date_joined', 'Alta', width=17, fmt='datetime'),
        ],
    )


class StaffDetailView(APIView):
    permission_classes = [IsAdmin]

    def _get(self, pk):
        try:
            return User.objects.get(pk=pk)
        except User.DoesNotExist:
            return None

    def patch(self, request, pk):
        target = self._get(pk)
        if target is None:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        err = _guard_target(request, target)
        if err:
            return Response({'detail': err}, status=status.HTTP_403_FORBIDDEN)

        changes, fields = {}, []
        for k in ('first_name', 'last_name'):
            if k in request.data:
                v = (request.data.get(k) or '').strip()
                if k == 'first_name' and not v:
                    return Response({'first_name': ['Requerido.']}, status=status.HTTP_400_BAD_REQUEST)
                if v != getattr(target, k):
                    changes[k] = {'from': getattr(target, k), 'to': v}
                    setattr(target, k, v)
                    fields.append(k)
        if 'email' in request.data:
            # The address is also the Google sign-in: from now on the person
            # enters with the new one, never with the old.
            email = (request.data.get('email') or '').strip().lower()
            try:
                validate_email(email)
            except DjangoValidationError:
                return Response({'email': ['Correo inválido.']}, status=status.HTTP_400_BAD_REQUEST)
            if email != target.email.lower():
                if User.objects.filter(email__iexact=email).exclude(pk=target.pk).exists():
                    return Response({'email': ['Ese correo ya está registrado.']},
                                    status=status.HTTP_400_BAD_REQUEST)
                changes['email'] = {'from': target.email, 'to': email}
                target.email = email
                fields.append('email')
        if 'role' in request.data:
            role = request.data['role']
            if role not in STAFF_ROLES:
                return Response({'role': ['Rol inválido.']}, status=status.HTTP_400_BAD_REQUEST)
            if role != target.role:
                if target.pk == request.user.pk:
                    return Response({'detail': 'No puede cambiar su propio rol.'}, status=status.HTTP_400_BAD_REQUEST)
                if target.role == User.Role.ADMIN and self._last_admin(target):
                    return Response({'detail': 'Debe quedar al menos un administrador activo.'}, status=status.HTTP_400_BAD_REQUEST)
                changes['role'] = {'from': target.role, 'to': role}
                target.role = role
                target.is_staff = role == User.Role.ADMIN
                fields += ['role', 'is_staff']
        if 'role' in fields or any(k in request.data for k in ('puesto', 'staff_title', 'staff_areas')):
            title, areas, errors = parse_staff_access(
                request.data, role=target.role, current_title=target.staff_title,
                current_areas=target.staff_areas)
            if errors:
                return Response(errors, status=status.HTTP_400_BAD_REQUEST)
            if title != target.staff_title:
                changes['staff_title'] = {'from': target.staff_title, 'to': title}
                target.staff_title = title
                fields.append('staff_title')
            if areas != list(target.staff_areas or []):
                changes['staff_areas'] = {'from': list(target.staff_areas or []), 'to': areas}
                target.staff_areas = areas
                fields.append('staff_areas')
        if 'is_active' in request.data:
            # bool("false") is True: parse the token, refuse anything ambiguous.
            active = parse_bool_param(request.data['is_active'])
            if active is None:
                return Response({'is_active': ['Valor inválido: use true o false.']},
                                status=status.HTTP_400_BAD_REQUEST)
            if active != target.is_active:
                if target.pk == request.user.pk and not active:
                    return Response({'detail': 'No puede desactivar su propia cuenta.'}, status=status.HTTP_400_BAD_REQUEST)
                if not active and target.role == User.Role.ADMIN and self._last_admin(target):
                    return Response({'detail': 'Debe quedar al menos un administrador activo.'}, status=status.HTTP_400_BAD_REQUEST)
                changes['is_active'] = {'from': target.is_active, 'to': active}
                target.is_active = active
                fields.append('is_active')
        if fields:
            with transaction.atomic():
                target.save(update_fields=fields)
                if 'is_active' in fields and not target.is_active:
                    revoke_refresh_tokens(target)
                record('update', target, {'via': 'portal', **changes}, actor=request.user,
                       context='portal: edición de personal')
        return Response(StaffUserSerializer(target).data)

    def _last_admin(self, target):
        return last_active_admin(target)


ADMIN_RESET_REFUSED = (
    'No se puede generar la contraseña de otra cuenta administradora: quien la '
    'reescribe se apropiaría de esa cuenta. Un administrador con correo del colegio '
    'entra con «Continuar con Google»; si perdió el acceso, un superusuario restablece '
    'su contraseña desde el panel técnico.'
)


class StaffResetPasswordView(APIView):
    """Non-admin staff passwords are generated here (the family flow refuses
    staff-level accounts). Admin targets are refused: see the module docstring."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        try:
            target = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        err = _guard_target(request, target)
        if err:
            return Response({'detail': err}, status=status.HTTP_403_FORBIDDEN)
        if target.pk == request.user.pk:
            return Response({'detail': 'Use su propio flujo de contraseña.'}, status=status.HTTP_400_BAD_REQUEST)
        if target.role == User.Role.ADMIN:
            return Response({'detail': ADMIN_RESET_REFUSED}, status=status.HTTP_403_FORBIDDEN)
        password = generate_temporary_password()
        with transaction.atomic():
            target.set_password(password)
            target.save(update_fields=['password'])
            revoked = revoke_refresh_tokens(target)
            record('permission', target, {'password': ['[redacted]', '[redacted]'], 'sessions_revoked': revoked},
                   actor=request.user, context='accounts.staff_set_password')
        return Response({'temporary_password': password, 'sessions_revoked': revoked})


# ── bulk: deactivate / reactivate (Data Ops C5) ────────────
def _bulk_guard(target, actor, *, active: bool):
    reason = _guard_target(None, target)
    if reason:
        raise BulkSkip(reason)
    if target.is_active == active:
        raise BulkSkip('Ya está activa.' if active else 'Ya está desactivada.')
    if not active and target.pk == actor.pk:
        raise BulkSkip('No puede desactivar su propia cuenta.')
    if not active and target.role == User.Role.ADMIN and last_active_admin(target):
        raise ValueError('Debe quedar al menos un administrador activo.')


def _set_active_action(name: str, label: str, *, active: bool, actor) -> BulkAction:
    def plan(target, payload):
        _bulk_guard(target, actor, active=active)

    def handler(target, payload, by):
        _bulk_guard(target, by, active=active)
        target.is_active = active
        target.save(update_fields=['is_active'])
        changes = {'is_active': [not active, active], 'via': 'portal-bulk'}
        if not active:
            changes['sessions_revoked'] = revoke_refresh_tokens(target)
        return changes

    return BulkAction(name, label, handler=handler, plan=plan,
                      side_effects='per_row' if not active else 'none')


# ── bulk: archive / restore / delete (owner, 2026-11-08) ────
STAFF_DELETE_CONFIRMATION = 'ELIMINAR'


def _leave_guard(target, actor):
    """Archiving or deleting: the same people deactivation may touch."""
    reason = _guard_target(None, target)
    if reason:
        raise BulkSkip(reason)
    if target.pk == actor.pk:
        raise BulkSkip('es su propia cuenta')
    if target.role == User.Role.ADMIN and target.is_active and last_active_admin(target):
        raise ValueError('Debe quedar al menos un administrador activo.')


def staff_keep_reason(target) -> str | None:
    """Why an account must be archived rather than erased (None: nothing to keep)."""
    if target.last_login is not None:
        return 'ya inició sesión'
    if has_history(target):
        return 'tiene actividad registrada'
    return None


def _archive_action(actor) -> BulkAction:
    def plan(target, payload):
        _leave_guard(target, actor)
        if target.archived_at is not None:
            raise BulkSkip('ya está archivada')
        return 'archived'

    def handler(target, payload, by):
        plan(target, payload)
        return {'outcome': 'archived', **archive_account(target), 'via': 'portal-bulk'}

    return BulkAction('archive', 'Archivar', handler=handler, plan=plan, side_effects='per_row')


def _restore_action(actor) -> BulkAction:
    def plan(target, payload):
        reason = _guard_target(None, target)
        if reason:
            raise BulkSkip(reason)
        if target.archived_at is None:
            raise BulkSkip('no está archivada')
        return 'restored'

    def handler(target, payload, by):
        plan(target, payload)
        return {'outcome': 'restored', **restore_account(target, reactivate=True), 'via': 'portal-bulk'}

    return BulkAction('restore', 'Restaurar', handler=handler, plan=plan, side_effects='none')


def _delete_action(actor) -> BulkAction:
    def plan(target, payload):
        _leave_guard(target, actor)
        if staff_keep_reason(target) is None:
            return 'erased'
        if target.archived_at is not None:
            raise BulkSkip('ya está archivada')
        return 'archived'

    def handler(target, payload, by):
        if plan(target, payload) == 'archived':
            return {'outcome': 'archived', 'reason': staff_keep_reason(target),
                    **archive_account(target), 'via': 'portal-bulk'}
        deleted = {'email': target.email, 'name': target.full_name, 'role': target.role}
        pk = target.pk
        target.delete()
        target.pk = pk  # Django clears it; the audit row still names the account
        return {'outcome': 'erased', 'deleted': deleted, 'via': 'portal-bulk'}

    return BulkAction('delete', 'Eliminar', handler=handler, plan=plan,
                      side_effects='none', audit_action='delete')


class StaffBulkView(AdminBulkView):
    """POST /accounts/admin/staff/bulk/ — ``deactivate`` / ``reactivate`` /
    ``archive`` / ``restore`` / ``delete``.

    Per-row guards (the same as the single PATCH): superusers and non-staff
    accounts are skipped, nobody deactivates, archives or deletes their own
    account, and the last active admin stays. Archive hides the account and
    blocks sign-in with its history intact; delete erases an account with
    nothing to keep and archives the rest (``outcomes`` counts both); its
    commit carries ``{"confirm": "ELIMINAR"}``. Deactivating, archiving and
    deleting revoke the account's refresh tokens.
    """

    entity = 'accounts.user'

    def get_queryset(self):
        return User.objects.all()

    list_view_class = StaffListCreateView

    def get_action(self, name):
        # The guards need the acting admin in the dry run too (self-deactivation).
        actor = self.request.user
        self.actions = {
            'deactivate': _set_active_action('deactivate', 'Desactivar', active=False, actor=actor),
            'reactivate': _set_active_action('reactivate', 'Reactivar', active=True, actor=actor),
            'archive': _archive_action(actor),
            'restore': _restore_action(actor),
            'delete': _delete_action(actor),
        }
        return super().get_action(name)

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        payload = data.get('payload') if isinstance(data.get('payload'), dict) else {}
        if (data.get('action') == 'delete' and not parse_bool_param(data.get('dry_run', False))
                and payload.get('confirm') != STAFF_DELETE_CONFIRMATION):
            raise ValidationError({'confirm': ['Confirme la eliminación.']})
        return super().post(request)


class StaffActivityView(APIView):
    """GET /accounts/admin/staff/<pk>/activity/ — the account and its last 20 actions in Auditoría."""
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        from apps.core.models import AuditLog
        from apps.core.serializers import AuditLogSerializer

        target = User.objects.filter(pk=pk, role__in=STAFF_ROLES).first()
        if target is None:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        actions = AuditLog.objects.filter(actor=target)
        recent = list(actions.select_related('actor').order_by('-created_at', '-pk')[:20])
        labels = _object_labels(recent)
        data = AuditLogSerializer(recent, many=True).data
        for row, entry in zip(data, recent, strict=True):
            row['object_label'] = labels.get((entry.object_type, str(entry.object_id)), '')
        return Response({
            'user': StaffUserSerializer(target).data,
            'total_actions': actions.count(),
            'recent': data,
        })


# What an activity row is about, as the office reads it (other types read "Tipo #id").
_OBJECT_TYPES = {
    'accounts.studentprofile': 'Alumno',
    'accounts.user': 'Cuenta',
    'accounts.parentprofile': 'Tutor',
    'payments.payment': 'Pago',
    'cafeteria.cafeteriabalance': 'Saldo de cafetería',
    'cafeteria.cafeteriatransaction': 'Movimiento de cafetería',
    'admissions.registration': 'Inscripción',
    'bookings.booking': 'Visita',
}


def _object_labels(rows) -> dict[tuple[str, str], str]:
    """``(object_type, object_id) → label`` for activity rows, in two queries.

    A student's file and its login both read as the student's name, so the
    timeline can fold the rows one action wrote about the same person.
    """
    from .models import StudentProfile

    ids: dict[str, set[int]] = {'accounts.studentprofile': set(), 'accounts.user': set()}
    for r in rows:
        if r.object_type in ids and str(r.object_id).isdigit():
            ids[r.object_type].add(int(r.object_id))
    labels: dict[tuple[str, str], str] = {}
    for p in StudentProfile.objects.filter(pk__in=ids['accounts.studentprofile']).select_related('user'):
        labels[('accounts.studentprofile', str(p.pk))] = p.user.full_name or p.student_id
    for u in User.objects.filter(pk__in=ids['accounts.user']).select_related('student_profile'):
        is_student = hasattr(u, 'student_profile')
        labels[('accounts.user', str(u.pk))] = u.full_name if is_student and u.full_name else (u.full_name or u.email)
    for r in rows:
        key = (r.object_type, str(r.object_id))
        if key not in labels:
            kind = _OBJECT_TYPES.get(r.object_type)
            labels[key] = f'{kind} #{r.object_id}' if kind else ''
    return labels


# ── import: invite many (Data Ops C4) ──────────────────────
class StaffImport:
    """``correo, nombre, apellidos, rol`` → new staff accounts.

    Import only *invites*: an existing staff account is ``omitir`` (never
    rewritten from a spreadsheet), an address owned by a family or student
    account is an error. Imported accounts get NO usable password: the person
    signs in with Google using that address, or an admin generates a temporary
    password from the row's "Contraseña" action (so no password ever travels
    in an import response or report file).
    """

    def __init__(self):
        self._users: dict[str, User | None] = {}

    def user(self, email):
        if email not in self._users:
            self._users[email] = User.objects.filter(email__iexact=email).first()
        return self._users[email]

    def validate_row(self, data, row):
        email = data.get('correo')
        if not email or row.action == 'error':
            return
        existing = self.user(email)
        if existing is not None and (existing.role not in STAFF_ROLES or existing.is_superuser):
            row.error(f'El correo pertenece a una cuenta con rol «{existing.get_role_display()}».')

    def db_match(self, data):
        return self.user(data['correo']) if data.get('correo') else None

    @staticmethod
    def skip_reason(data, existing):
        return 'Ya existe una cuenta del personal con ese correo.' if existing is not None else None

    @staticmethod
    def create(data, actor):
        email = data['correo']
        if User.objects.filter(email__iexact=email).exists():
            raise ValueError('Ese correo ya está registrado.')
        role = data.get('rol') or User.Role.STAFF
        title, areas = '', []
        if role == User.Role.STAFF and data.get('puesto'):
            title, areas = PUESTOS[data['puesto']][0], list(PUESTOS[data['puesto']][1])
        return User.objects.create_user(
            email=email, password=None, first_name=data['nombre'],
            last_name=data.get('apellidos') or '', role=role,
            is_staff=(role == User.Role.ADMIN), staff_title=title, staff_areas=areas,
        )

    def spec(self) -> ImportSpec:
        return ImportSpec(
            entity='staff',
            label='Personal',
            columns=[
                ImportCol('correo', ('email', 'correo_electronico'), True, parse=parse_email,
                          example='maestra@interlaken.edu.mx'),
                ImportCol('nombre', ('nombres', 'first_name'), True, example='Laura'),
                ImportCol('apellidos', ('apellido', 'last_name'), example='Martínez'),
                ImportCol('rol', ('role',), parse=parse_choice(
                    [(User.Role.STAFF, 'Personal'), (User.Role.ADMIN, 'Administrador')],
                    aliases={'admin': User.Role.ADMIN, 'maestro': User.Role.STAFF}),
                    example='staff'),
                # Optional: gives a staff account the preset console areas.
                ImportCol('puesto', ('cargo',), parse=parse_choice(
                    [(key, label) for key, (label, _) in PUESTOS.items()],
                    aliases={'secretaría': 'secretaria', 'recepción': 'recepcion',
                             'cafetería': 'cafeteria'}),
                    example='secretaria'),
            ],
            dedupe_keys=[('correo',)],
            key_of=lambda d: d.get('correo') or '',
            db_match=self.db_match,
            validate_row=self.validate_row,
            skip_reason=self.skip_reason,
            create=self.create,
        )


class StaffImportView(ImportView):
    """POST /accounts/admin/staff/import/ (dry run by default)."""

    template_url = '/api/v1/accounts/admin/staff/import/template/'

    def get_spec(self):
        return StaffImport().spec()


class StaffImportTemplateView(ImportTemplateView):
    def get_spec(self):
        return StaffImport().spec()
