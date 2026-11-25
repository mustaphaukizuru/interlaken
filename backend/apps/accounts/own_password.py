"""
POST /api/v1/accounts/me/password/   {current_password, new_password}

A signed-in person replaces their own password by proving the current one
(2026-11-24). This is how a temporary password handed out by the school
(``password_change_required``) is replaced: the SPA's «Cree su contraseña»
step calls it, and it is on the allowlist of ``apps.accounts.authentication``.

There is still no self-service *reset*: whoever forgot their password asks
the school (``password_views`` docstring).

* Django's password validators (``AUTH_PASSWORD_VALIDATORS``) apply, and the
  new password must differ from the current one.
* Every other session (refresh token) is closed; this browser keeps its own.
* Audited without the password; 10 tries an hour per account.
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils.decorators import method_decorator
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.audit import record
from apps.core.ratelimit import ratelimit

from .admin_password import revoke_refresh_tokens
from .serializers import UserSerializer


def _this_browser_jti(request) -> str | None:
    """The refresh token of the browser asking (its httpOnly cookie), if valid and its own."""
    raw = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE)
    if not raw:
        return None
    try:
        token = RefreshToken(raw)
    except TokenError:
        return None
    if str(token.get("user_id")) != str(request.user.pk):
        return None
    return token.get("jti")


def _text(value) -> str:
    return value if isinstance(value, str) else ""


@method_decorator(ratelimit("my-password", "10/h", key="user", method="POST"), name="post")
class MyPasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    password_change_allowed = True

    def post(self, request):
        user = request.user
        current = _text(request.data.get("current_password"))
        new = _text(request.data.get("new_password"))
        errors: dict[str, list[str]] = {}
        if not current:
            errors["current_password"] = ["Escriba su contraseña actual."]
        elif not user.check_password(current):
            errors["current_password"] = ["La contraseña actual no es correcta."]
        if not new:
            errors["new_password"] = ["Escriba la contraseña nueva."]
        elif new == current:
            errors["new_password"] = ["La contraseña nueva debe ser distinta de la actual."]
        else:
            try:
                validate_password(new, user=user)
            except DjangoValidationError as exc:
                errors["new_password"] = list(exc.messages)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        was_temporary = user.password_change_required
        with transaction.atomic():
            user.set_password(new)
            user.password_change_required = False
            user.save(update_fields=["password", "password_change_required"])
            revoked = revoke_refresh_tokens(user, keep_jti=_this_browser_jti(request))
            record(
                "permission",
                user,
                {
                    "password": ["[redacted]", "[redacted]"],
                    "source": "self",
                    "was_temporary": was_temporary,
                    "sessions_revoked": revoked,
                },
                actor=user,
                context="accounts.change_own_password",
            )
        return Response(
            {
                "detail": "Contraseña guardada.",
                "sessions_revoked": revoked,
                "user": UserSerializer(user, context={"include_prefs": True}).data,
            }
        )
