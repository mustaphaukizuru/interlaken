"""
accounts/staff_users.py — portal staff-user management (BACKLOG P1-H1, AF-4 gap 3).

GET   /accounts/admin/staff/            list admin + staff accounts
POST  /accounts/admin/staff/            invite: create with a generated password (returned once)
PATCH /accounts/admin/staff/<pk>/       role / active / name
POST  /accounts/admin/staff/<pk>/reset-password/   new generated password (returned once)

Guards: only admins; an admin cannot deactivate or demote themselves; the last
active admin cannot be demoted/deactivated; superusers are untouchable here
(they belong to the Django admin).
"""
from __future__ import annotations

from django.db import transaction
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.bulk import AdminBulkView, BulkAction, BulkSkip
from apps.core.exporting import AdminExportMixin, Col, ExportSpec
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
                  'is_superuser', 'last_login', 'date_joined', 'has_password']
        read_only_fields = fields

    def get_has_password(self, u):
        return u.has_usable_password()


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
        errors = {}
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
                                            role=role, is_staff=(role == User.Role.ADMIN))
            record('create', user, {'via': 'portal', 'role': role}, actor=request.user,
                   context='portal: alta de personal')
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
                if v != getattr(target, k):
                    changes[k] = {'from': getattr(target, k), 'to': v}
                    setattr(target, k, v)
                    fields.append(k)
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
        if 'is_active' in request.data:
            active = bool(request.data['is_active'])
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


class StaffResetPasswordView(APIView):
    """Staff passwords are generated here (not via the family flow, which refuses admins)."""
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


class StaffBulkView(AdminBulkView):
    """POST /accounts/admin/staff/bulk/ — ``deactivate`` / ``reactivate``.

    Per-row guards (the same as the single PATCH): superusers and non-staff
    accounts are skipped, nobody deactivates their own account, and the last
    active admin cannot be deactivated. There is no delete: deactivation is the
    archive. Deactivating revokes the account's refresh tokens.
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
        }
        return super().get_action(name)


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
        return User.objects.create_user(
            email=email, password=None, first_name=data['nombre'],
            last_name=data.get('apellidos') or '', role=role,
            is_staff=(role == User.Role.ADMIN),
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
