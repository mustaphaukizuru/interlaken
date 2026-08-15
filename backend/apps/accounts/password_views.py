"""Password-reset / activation API views + notification preference endpoints."""
from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.decorators import method_decorator
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.ratelimit import ratelimit
from apps.portal.services import send_email

from .models import NotificationPreference, User
from .password_reset import consume_reset_token, issue_reset_token
from .serializers import NotificationPreferenceSerializer


def _reset_link(user_id: int, raw: str) -> str:
    base = (settings.FRONTEND_URL or '').rstrip('/')
    return f'{base}/restablecer-contrasena?uid={user_id}&token={raw}'


# 5/hour/IP: every request sends an email, so the window is deliberately long
# (a genuine parent rarely needs more than a couple of reset mails an hour).
@method_decorator(ratelimit('password-reset', '5/h', key='ip', method='POST'), name='dispatch')
class PasswordResetRequestView(APIView):
    """POST /api/v1/accounts/password-reset/  {email}

    Always returns 200 with a generic message (no email enumeration).
    If the user exists and is active, emails a one-time reset/activation link.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        # Generic response either way.
        ok = {'detail': 'Si el correo está registrado, recibirá un enlace para continuar.'}
        if not email:
            return Response(ok)

        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user is None:
            return Response(ok)

        raw = issue_reset_token(user)
        link = _reset_link(user.id, raw)
        subject = 'Restablecer o activar su contraseña — Colegio Interlaken'
        body = (
            f'Hola {user.first_name or ""},\n\n'
            'Recibimos una solicitud para restablecer o activar la contraseña de su cuenta '
            f'({user.email}).\n\n'
            f'Abra este enlace (válido por tiempo limitado):\n{link}\n\n'
            'Si usted no solicitó este cambio, ignore este mensaje.\n\n'
            'Colegio Interlaken'
        )
        send_email(subject=subject, message=body, recipients=[user.email])
        return Response(ok)


@method_decorator(ratelimit('password-reset-confirm', '10/m', key='ip', method='POST'), name='dispatch')
class PasswordResetConfirmView(APIView):
    """POST /api/v1/accounts/password-reset/confirm/  {uid, token, password}"""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        uid = request.data.get('uid')
        token = (request.data.get('token') or '').strip()
        password = request.data.get('password') or ''

        if not uid or not token or not password:
            return Response(
                {'detail': 'Datos incompletos.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user = User.objects.get(pk=int(uid), is_active=True)
        except (User.DoesNotExist, TypeError, ValueError):
            return Response(
                {'detail': 'Enlace inválido o expirado.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(password, user=user)
        except DjangoValidationError as e:
            return Response({'password': list(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

        if not consume_reset_token(user, token):
            return Response(
                {'detail': 'Enlace inválido o expirado.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(password)
        user.save(update_fields=['password'])
        return Response({'detail': 'Contraseña actualizada. Ya puede iniciar sesión.'})


class SetPasswordView(APIView):
    """POST /api/v1/accounts/set-password/  {password}

    Authenticated users (e.g. Google login without a local password) can set one.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        password = request.data.get('password') or ''
        if not password:
            return Response({'detail': 'Indique una contraseña.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(password, user=request.user)
        except DjangoValidationError as e:
            return Response({'password': list(e.messages)}, status=status.HTTP_400_BAD_REQUEST)
        request.user.set_password(password)
        request.user.save(update_fields=['password'])
        return Response({'detail': 'Contraseña guardada.'})


class NotificationPreferenceView(APIView):
    """GET/PATCH /api/v1/accounts/notification-preferences/"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        prefs = NotificationPreference.for_user(request.user)
        return Response(NotificationPreferenceSerializer(prefs).data)

    def patch(self, request):
        prefs = NotificationPreference.for_user(request.user)
        ser = NotificationPreferenceSerializer(prefs, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
