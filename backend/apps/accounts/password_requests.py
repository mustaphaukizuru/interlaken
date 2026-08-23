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
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin

from .admin_password import _audit_set_password, generate_temporary_password, revoke_refresh_tokens
from .models import PasswordRequest, User

PAGE = 50


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


class PasswordRequestListCreateView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        qs = PasswordRequest.objects.select_related('user', 'created_by', 'resolved_by')
        st = request.query_params.get('status')
        if st in PasswordRequest.Status.values:
            qs = qs.filter(status=st)
        return Response({
            'count': qs.count(),
            'open_count': PasswordRequest.objects.filter(status=PasswordRequest.Status.OPEN).count(),
            'results': PasswordRequestSerializer(qs[:PAGE], many=True).data,
        })

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
            req.status = PasswordRequest.Status.REJECTED
            req.resolved_by, req.resolved_at = request.user, timezone.now()
            req.note = (request.data.get('note') or req.note)[:300]
            req.save(update_fields=['status', 'resolved_by', 'resolved_at', 'note'])
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
