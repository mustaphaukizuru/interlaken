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
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.permissions import IsAdmin

from .admin_password import generate_temporary_password, revoke_refresh_tokens
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


STAFF_PAGE = 20  # matches DRF's global PAGE_SIZE


def _guard_target(request, target):
    if target.is_superuser:
        return 'Las cuentas superusuario se administran desde el panel técnico.'
    if target.role not in STAFF_ROLES:
        return 'Solo se administran cuentas del personal aquí.'
    return None


class StaffListCreateView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        qs = User.objects.filter(role__in=STAFF_ROLES).order_by('-is_active', 'role', 'last_name', 'first_name')
        # The envelope always looked paginated but never sliced, so the payload
        # grew with every staff account ever created (deactivated ones included).
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except (TypeError, ValueError):
            page = 1
        start = (page - 1) * STAFF_PAGE
        return Response({
            'results': StaffUserSerializer(qs[start:start + STAFF_PAGE], many=True).data,
            'count': qs.count(),
        })

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
        return not User.objects.filter(role=User.Role.ADMIN, is_active=True).exclude(pk=target.pk).exists()


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
