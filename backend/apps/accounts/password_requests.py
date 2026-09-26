"""
accounts/password_requests.py — the password request inbox (BACKLOG P1-A4/A5).

GET   /accounts/admin/password-requests/?status=open   list
POST  /accounts/admin/password-requests/               log a request
PATCH /accounts/admin/password-requests/<pk>/          resolve / reject

Resolving with ``{"action": "resolve"}`` generates a temporary password through
the same code path as ``AdminSetPasswordView`` (sessions revoked, audited), marks
the row resolved and returns the password ONCE together with ready-to-send
WhatsApp / email delivery texts.
"""
from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.bulk import AdminBulkView, BulkAction
from apps.core.exporting import AdminExportMixin, Col, ExportSpec
from apps.core.listing import AdminListMixin
from apps.core.permissions import IsAdmin
from apps.core.transitions import assert_transition

from .admin_password import _audit_set_password, generate_temporary_password, revoke_refresh_tokens
from .filters import PasswordRequestFilterSet
from .models import PasswordRequest, User

ENTITY = 'accounts.passwordrequest'


def delivery_templates(user: User, password: str) -> dict:
    """Plain-text messages an admin pastes into WhatsApp or email (P1-A5)."""
    name = user.first_name or 'familia'
    login_url = f"{(settings.FRONTEND_URL or '').rstrip('/')}/login"
    support = getattr(settings, 'SUPPORT_EMAIL', '') or settings.CONTACT_EMAIL
    body = (
        f'Hola {name}, le compartimos su acceso al Portal de Familias del Colegio Interlaken.\n\n'
        f'Usuario: {user.email}\n'
        f'Contraseña: {password}\n'
        f'Ingrese en: {login_url}\n\n'
        'Guarde esta contraseña: por seguridad no se puede cambiar desde el portal. '
        f'Si la olvida, solicítela de nuevo por WhatsApp o a {support}.\n\n'
        'Colegio Interlaken'
    )
    return {
        'whatsapp_text': body,
        'email_subject': 'Acceso al Portal de Familias - Colegio Interlaken',
        'email_body': body,
    }


class PasswordRequestSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_email = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PasswordRequest
        fields = ['id', 'user', 'user_name', 'user_email', 'requested_email', 'requester_name',
                  'channel', 'note', 'status', 'created_by_name', 'created_at',
                  'resolved_by_name', 'resolved_at', 'delivered_via']
        read_only_fields = ['status', 'created_at', 'resolved_at', 'delivered_via']

    def get_user_name(self, o):
        return o.user.full_name if o.user else ''

    def get_user_email(self, o):
        return o.user.email if o.user else ''

    def get_created_by_name(self, o):
        return o.created_by.full_name if o.created_by else ''

    def get_resolved_by_name(self, o):
        return o.resolved_by.full_name if o.resolved_by else ''


PASSWORD_REQUEST_ORDERING = {
    'created_at': 'created_at',
    'status': 'status',
    'requested_email': 'requested_email',
    'channel': 'channel',
    'resolved_at': 'resolved_at',
}


class PasswordRequestListCreateView(AdminListMixin, generics.ListAPIView):
    """GET (list contract: ``q`` over requested email / requester / linked account,
    ``ordering``, ``status``/``estado``, ``channel``/``canal``, ``from``/``to``) and
    POST (log a request). The page also carries ``open_count`` for the tab badge."""

    serializer_class = PasswordRequestSerializer
    search_fields = ('requested_email', 'requester_name', 'user__email', 'user__first_name',
                     'user__last_name')
    ordering = PASSWORD_REQUEST_ORDERING
    default_ordering = '-created_at'
    filterset_class = PasswordRequestFilterSet

    def get_queryset(self):
        return PasswordRequest.objects.select_related('user', 'created_by', 'resolved_by')

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        response.data['open_count'] = PasswordRequest.objects.filter(
            status=PasswordRequest.Status.OPEN).count()
        return response

    def post(self, request):
        email = (request.data.get('requested_email') or '').strip().lower()
        user_id = request.data.get('user')
        user = None
        if user_id:
            user = User.objects.filter(pk=user_id).first()
        elif email:
            user = User.objects.filter(email__iexact=email).first()
        if user is None and not email:
            return Response({'requested_email': ['Indique el correo o seleccione la cuenta.']},
                            status=status.HTTP_400_BAD_REQUEST)
        channel = request.data.get('channel') or PasswordRequest.Channel.WHATSAPP
        if channel not in PasswordRequest.Channel.values:
            return Response({'channel': ['Canal inválido.']}, status=status.HTTP_400_BAD_REQUEST)
        req = PasswordRequest.objects.create(
            user=user, requested_email=email or (user.email if user else ''),
            requester_name=(request.data.get('requester_name') or '').strip()[:150],
            channel=channel, note=(request.data.get('note') or '').strip()[:300],
            created_by=request.user,
        )
        return Response(PasswordRequestSerializer(req).data, status=status.HTTP_201_CREATED)


def reject_request(req: PasswordRequest, actor, note: str = '') -> dict:
    """open → rejected under the transition table; returns the audit diff."""
    assert_transition(ENTITY, req.status, PasswordRequest.Status.REJECTED)
    before = req.status
    req.status = PasswordRequest.Status.REJECTED
    req.resolved_by, req.resolved_at = actor, timezone.now()
    note = (note or '').strip()
    if note:
        req.note = note[:300]
    req.save(update_fields=['status', 'resolved_by', 'resolved_at', 'note'])
    changes = {'status': [before, req.status]}
    if note:
        changes['note'] = note[:300]
    return changes


class PasswordRequestExportView(AdminExportMixin, PasswordRequestListCreateView):
    """GET /accounts/admin/password-requests/export/?fmt=csv|xlsx|pdf — audited."""

    http_method_names = ['get', 'head', 'options']  # never the inherited POST
    export_spec = ExportSpec(
        filename_prefix='solicitudes_contrasena',
        title='Solicitudes de contraseña',
        sheet_title='Solicitudes',
        audit_entity='password_requests',
        columns=[
            Col('created_at', 'Fecha', width=17, fmt='datetime'),
            Col('requested_email', 'Correo solicitado', width=30),
            Col('requester_name', 'Solicitante', width=24),
            Col('account', 'Cuenta vinculada', lambda r: r.user.email if r.user else '', width=30),
            Col('channel', 'Canal', lambda r: r.get_channel_display(), width=12),
            Col('status', 'Estado', lambda r: r.get_status_display(), width=12),
            Col('note', 'Nota', width=30),
            Col('created_by', 'Registró', lambda r: r.created_by.full_name if r.created_by else '',
                width=22),
            Col('resolved_by', 'Atendió', lambda r: r.resolved_by.full_name if r.resolved_by else '',
                width=22),
            Col('resolved_at', 'Atendida', width=17, fmt='datetime'),
            Col('delivered_via', 'Entregada vía', lambda r: r.get_delivered_via_display(),
                width=12),
        ],
    )


class PasswordRequestBulkView(AdminBulkView):
    """POST /accounts/admin/password-requests/bulk/ — ``reject`` (note required).

    ``resolve`` stays single-row on purpose: it generates a password that must be
    shown once and delivered to one family."""

    entity = ENTITY
    list_view_class = PasswordRequestListCreateView
    actions = {
        'reject': BulkAction(
            'reject', 'Rechazar',
            handler=lambda req, payload, actor: reject_request(req, actor, payload.get('note')),
            plan=lambda req, payload: assert_transition(
                ENTITY, req.status, PasswordRequest.Status.REJECTED),
            requires_note=True,
            side_effects='none',
        ),
    }


class PasswordRequestDetailView(APIView):
    permission_classes = [IsAdmin]

    def patch(self, request, pk):
        try:
            req = PasswordRequest.objects.select_related('user').get(pk=pk)
        except PasswordRequest.DoesNotExist:
            return Response({'detail': 'Solicitud no encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        if req.status != PasswordRequest.Status.OPEN:
            return Response({'detail': 'La solicitud ya fue atendida.'}, status=status.HTTP_409_CONFLICT)

        action = request.data.get('action')
        if action == 'reject':
            with transaction.atomic():
                changes = reject_request(req, request.user, request.data.get('note') or '')
                record('update', req, {'via': 'portal', **changes}, actor=request.user,
                       context='portal: solicitud de contraseña rechazada')
            return Response(PasswordRequestSerializer(req).data)
        if action != 'resolve':
            return Response({'action': ['Use "resolve" o "reject".']}, status=status.HTTP_400_BAD_REQUEST)

        target = req.user
        if target is None and request.data.get('user'):
            target = User.objects.filter(pk=request.data['user']).first()
        if target is None:
            return Response({'user': ['Vincule la solicitud a una cuenta antes de resolverla.']},
                            status=status.HTTP_400_BAD_REQUEST)
        if target.role == User.Role.ADMIN or target.is_superuser:
            return Response({'detail': 'No se restablecen cuentas administradoras desde aquí.'},
                            status=status.HTTP_403_FORBIDDEN)

        delivered_via = request.data.get('delivered_via') or req.channel
        password = generate_temporary_password()
        with transaction.atomic():
            target.set_password(password)
            target.save(update_fields=['password'])
            revoked = revoke_refresh_tokens(target)
            req.user = target
            req.status = PasswordRequest.Status.RESOLVED
            req.resolved_by, req.resolved_at = request.user, timezone.now()
            req.delivered_via = delivered_via if delivered_via in PasswordRequest.Channel.values else ''
            req.save(update_fields=['user', 'status', 'resolved_by', 'resolved_at', 'delivered_via'])
        _audit_set_password(request.user, target, generated=True,
                            reason=f'solicitud #{req.pk} vía {req.get_channel_display()}', revoked=revoked)
        data = PasswordRequestSerializer(req).data
        data['temporary_password'] = password  # shown once, never stored
        data['templates'] = delivery_templates(target, password)
        data['whatsapp_number'] = (target.whatsapp or '').strip()
        return Response(data)
