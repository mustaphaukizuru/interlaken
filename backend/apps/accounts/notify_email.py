"""
accounts/notify_email.py — a family's personal email for notifications.

Owner, 2026-10-20: "Every notification goes to the student's email, but if
parents want to receive it on their personal email, is it possible?" Family
logins are usually the student's school address (``ci09938@interlaken.com.mx``),
so a parent may add one personal address. It receives every email the account
receives, **once confirmed**: the address gets a signed link (valid 3 days)
and only a confirmed address is ever mailed, so nobody can route a family's
notifications to a mailbox they do not own.

    GET    /accounts/me/notify-email/          {email, verified}
    PUT    /accounts/me/notify-email/          {email} → sends the link
    DELETE /accounts/me/notify-email/          stop using it
    POST   /accounts/me/notify-email/verify/   {token}

Allowed although family profiles are locked (bitácora punto 10): it adds a
delivery address and changes nothing the school owns. Audited.
"""
from __future__ import annotations

from django.conf import settings
from django.core import signing
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.exceptions import error_body
from apps.core.ratelimit import ratelimit

SALT = 'accounts.notify-email'
MAX_AGE = 3 * 24 * 3600


def make_token(user) -> str:
    return signing.dumps({'u': user.pk, 'e': (user.notify_email or '').lower()}, salt=SALT)


def _state(user) -> dict:
    return {'email': user.notify_email or '', 'verified': bool(user.notify_email
                                                                 and user.notify_email_verified_at)}


class _EmailIn(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


@method_decorator(ratelimit('notify-email', '5/h', key='user', method='PUT'), name='dispatch')
class NotifyEmailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(_state(request.user))

    def put(self, request):
        from apps.portal.services import send_email

        from .recipients import is_synthetic_email

        data = _EmailIn(data=request.data)
        data.is_valid(raise_exception=True)
        email = data.validated_data['email'].strip().lower()
        user = request.user
        if email == (user.email or '').lower():
            return Response(error_body('Ese ya es el correo de su cuenta: los avisos ya le llegan ahí.',
                                       code='same_as_account'), status=status.HTTP_400_BAD_REQUEST)
        if is_synthetic_email(email):
            return Response(error_body('Escriba un correo personal.', code='invalid'),
                            status=status.HTTP_400_BAD_REQUEST)
        before = _state(user)
        user.notify_email = email
        user.notify_email_verified_at = None
        user.save(update_fields=['notify_email', 'notify_email_verified_at'])
        record('update', user, {'notify_email': [before['email'], email], 'verified': False},
               actor=user, context='accounts.notify_email')
        frontend = (getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')
        link = f'{frontend}/portal/perfil?tab=avisos&verificar_correo={make_token(user)}'
        sent = send_email(
            subject='Confirme su correo para avisos del Colegio Interlaken',
            message=(f'Hola. Se pidió recibir los avisos de la cuenta {user.email} del portal del '
                     f'Colegio Interlaken en este correo. Para confirmarlo, abra este enlace (válido '
                     f'3 días; puede pedirle que inicie sesión):\n\n{link}\n\nSi usted no lo pidió, '
                     f'ignore este mensaje: no recibirá ningún aviso.'),
            recipients=[email],
            cta_url=link, cta_label='Confirmar correo',
        )
        return Response({**_state(user), 'sent': bool(sent)})

    def delete(self, request):
        user = request.user
        if user.notify_email:
            record('update', user, {'notify_email': [user.notify_email, '']},
                   actor=user, context='accounts.notify_email')
            user.notify_email = ''
            user.notify_email_verified_at = None
            user.save(update_fields=['notify_email', 'notify_email_verified_at'])
        return Response(_state(user))


@method_decorator(ratelimit('notify-email-verify', '20/h', key='user', method='POST'), name='dispatch')
class NotifyEmailVerifyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        token = str(request.data.get('token') or '')
        try:
            payload = signing.loads(token, salt=SALT, max_age=MAX_AGE)
        except signing.SignatureExpired:
            return Response(error_body('El enlace venció. Vuelva a escribir el correo para recibir otro.',
                                       code='expired'), status=status.HTTP_400_BAD_REQUEST)
        except signing.BadSignature:
            return Response(error_body('El enlace no es válido.', code='invalid'),
                            status=status.HTTP_400_BAD_REQUEST)
        user = request.user
        if payload.get('u') != user.pk or payload.get('e') != (user.notify_email or '').lower():
            return Response(error_body('Este enlace es de otra cuenta o de otro correo. Inicie sesión '
                                       'con la cuenta que lo pidió.', code='mismatch'),
                            status=status.HTTP_400_BAD_REQUEST)
        if not user.notify_email_verified_at:
            user.notify_email_verified_at = timezone.now()
            user.save(update_fields=['notify_email_verified_at'])
            record('update', user, {'notify_email': user.notify_email, 'verified': True},
                   actor=user, context='accounts.notify_email')
        return Response(_state(user))
