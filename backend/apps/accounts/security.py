"""
Account security (BACKLOG P4-7): login history, sessions, TOTP 2FA for admins.

LoginEvent   one row per sign-in attempt (method password/google, success, ip,
             user agent). Written by the login views; never edited.
Sessions     GET  /accounts/me/sessions/          last 20 logins + active refresh
                                                  tokens (outstanding, not blacklisted)
             POST /accounts/me/sessions/close-others/  blacklist every refresh token
                                                  except the one in this browser's cookie
TOTP (RFC 6238, stdlib HMAC, no extra dependency):
             POST /accounts/me/totp/setup/    -> {secret, otpauth_url}  (pending until verified)
             POST /accounts/me/totp/enable/   {code}  -> enabled
             POST /accounts/me/totp/disable/  {code}
             Password login for a user with TOTP enabled must include "totp" in
             the body; otherwise 401 {"totp_required": true}. Google sign-in
             carries Google's own second factor and is not gated here.
Idle timeout lives in the SPA (PortalLayout) for admin/staff: 30 min.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

from django.db import models
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.fields import EncryptedTextField

from .models import User


# ---------------------------------------------------------------------------
# TOTP
# ---------------------------------------------------------------------------
def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')


def totp_code(secret: str, at: float | None = None, step: int = 30, digits: int = 6) -> str:
    key = base64.b32decode(secret + '=' * (-len(secret) % 8), casefold=True)
    counter = int((at if at is not None else time.time()) // step)
    mac = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    code = (struct.unpack('>I', mac[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    code = (code or '').strip().replace(' ', '')
    if not secret or not code.isdigit():
        return False
    now = time.time()
    return any(hmac.compare_digest(totp_code(secret, now + i * 30), code) for i in range(-window, window + 1))


def otpauth_url(secret: str, email: str) -> str:
    return f'otpauth://totp/{quote("Interlaken:" + email)}?secret={secret}&issuer=Interlaken&digits=6&period=30'


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginEvent(models.Model):
    class Method(models.TextChoices):
        PASSWORD = 'password', 'Contraseña'
        GOOGLE = 'google', 'Google'

    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='login_events')
    email = models.CharField(max_length=254, blank=True)
    method = models.CharField(max_length=10, choices=Method.choices)
    success = models.BooleanField(default=True)
    reason = models.CharField(max_length=40, blank=True)   # bad_password, totp_required, bad_totp, inactive
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Inicio de sesión'
        verbose_name_plural = 'Historial de inicios de sesión'


class TotpDevice(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='totp')
    secret = EncryptedTextField()
    confirmed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Segundo factor (TOTP)'
        verbose_name_plural = 'Segundos factores (TOTP)'


def record_login(request, *, user=None, email='', method='password', success=True, reason=''):
    try:
        LoginEvent.objects.create(
            user=user, email=(email or getattr(user, 'email', ''))[:254], method=method, success=success, reason=reason[:40],
            ip=request.META.get('REMOTE_ADDR') or None, user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:300],
        )
    except Exception:  # noqa: BLE001 - history must never break login
        pass


def totp_enabled(user) -> bool:
    dev = getattr(user, 'totp', None)
    return bool(dev and dev.confirmed)


def _ua_label(ua: str) -> str:
    ua = ua or ''
    os_ = 'iPhone' if 'iPhone' in ua else 'iPad' if 'iPad' in ua else 'Android' if 'Android' in ua else 'Windows' if 'Windows' in ua else 'Mac' if 'Mac OS' in ua else 'Linux' if 'Linux' in ua else ''
    br = 'Edge' if 'Edg/' in ua else 'Chrome' if 'Chrome/' in ua else 'Safari' if 'Safari/' in ua else 'Firefox' if 'Firefox/' in ua else ''
    return ' · '.join(p for p in (br, os_) if p) or 'Dispositivo'


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------
class MySessionsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        now = timezone.now()
        active = (OutstandingToken.objects.filter(user=request.user, expires_at__gt=now)
                  .exclude(id__in=BlacklistedToken.objects.filter(token__user=request.user).values_list('token_id', flat=True)))
        events = LoginEvent.objects.filter(user=request.user)[:20]
        return Response({
            'active_sessions': active.count(),
            'totp_enabled': totp_enabled(request.user),
            'history': [{'at': e.created_at.isoformat(), 'method': e.method, 'success': e.success, 'reason': e.reason,
                         'ip': e.ip, 'device': _ua_label(e.user_agent)} for e in events],
        })


class CloseOtherSessionsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from django.conf import settings

        from .cookies import csrf_ok
        if not csrf_ok(request):
            return Response({'detail': 'CSRF token inválido.'}, status=status.HTTP_403_FORBIDDEN)
        keep_jti = None
        raw = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE)
        if raw:
            try:
                keep_jti = RefreshToken(raw)['jti']
            except TokenError:
                keep_jti = None
        closed = 0
        for tok in OutstandingToken.objects.filter(user=request.user, expires_at__gt=timezone.now()).exclude(jti=keep_jti or ''):
            _, created = BlacklistedToken.objects.get_or_create(token=tok)
            closed += int(created)
        return Response({'closed': closed})


class TotpSetupView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if request.user.role not in ('admin', 'staff'):
            return Response({'detail': 'El segundo factor está disponible para el personal.'}, status=status.HTTP_403_FORBIDDEN)
        dev, _ = TotpDevice.objects.get_or_create(user=request.user, defaults={'secret': new_secret()})
        if dev.confirmed:
            return Response({'detail': 'El segundo factor ya está activo.'}, status=status.HTTP_400_BAD_REQUEST)
        dev.secret = new_secret()
        dev.save(update_fields=['secret'])
        return Response({'secret': dev.secret, 'otpauth_url': otpauth_url(dev.secret, request.user.email)})


class TotpEnableView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        dev = TotpDevice.objects.filter(user=request.user).first()
        if dev is None:
            return Response({'detail': 'Primero genere la clave.'}, status=status.HTTP_400_BAD_REQUEST)
        if not verify_totp(dev.secret, str(request.data.get('code', ''))):
            return Response({'code': ['Código incorrecto. Revise la hora del teléfono.']}, status=status.HTTP_400_BAD_REQUEST)
        dev.confirmed = True
        dev.last_used_at = timezone.now()
        dev.save(update_fields=['confirmed', 'last_used_at'])
        return Response({'totp_enabled': True})


class TotpDisableView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        dev = TotpDevice.objects.filter(user=request.user, confirmed=True).first()
        if dev is None:
            return Response({'detail': 'El segundo factor no está activo.'}, status=status.HTTP_400_BAD_REQUEST)
        if not verify_totp(dev.secret, str(request.data.get('code', ''))):
            return Response({'code': ['Código incorrecto.']}, status=status.HTTP_400_BAD_REQUEST)
        dev.delete()
        return Response({'totp_enabled': False})
