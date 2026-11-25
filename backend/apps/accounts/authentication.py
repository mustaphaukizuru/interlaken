"""
accounts/authentication.py — the API's JWT authentication, plus the
«Cree su contraseña» gate (2026-11-24).

An administrator who generates or sets a temporary password for someone sets
``User.password_change_required``. Until that person creates their own
password (``POST /accounts/me/password/``) the API refuses everything they ask
with 403 ``{"detail", "code": "password_change_required"}``, except:

* views that declare ``password_change_allowed`` (``True``, or the HTTP
  methods allowed): the change-password endpoint, ``me`` (read), logout and
  the token refresh;
* public endpoints (every permission is ``AllowAny``): they answer exactly as
  they would to a visitor who is not signed in, so the public site keeps
  working and nothing there acts as that account.

Why here: DRF authenticates inside each view (``APIView.initial``), so a
Django middleware never sees a JWT user. This class is the only entry in
``REST_FRAMEWORK['DEFAULT_AUTHENTICATION_CLASSES']``, which covers every API
view that does not opt out of authentication altogether.
"""

from __future__ import annotations

from rest_framework import exceptions
from rest_framework.permissions import AllowAny
from rest_framework_simplejwt.authentication import JWTAuthentication as SimpleJWTAuthentication

PASSWORD_CHANGE_REQUIRED = "password_change_required"
PASSWORD_CHANGE_MESSAGE = "Antes de continuar, cree su propia contraseña."


class PasswordChangeRequired(exceptions.PermissionDenied):
    default_detail = PASSWORD_CHANGE_MESSAGE
    default_code = PASSWORD_CHANGE_REQUIRED

    def __init__(self):
        # A dict detail is the body as is: {"detail": "...", "code": "..."}.
        super().__init__(
            detail={"detail": PASSWORD_CHANGE_MESSAGE, "code": PASSWORD_CHANGE_REQUIRED}
        )


def allowed_while_password_change_required(view, method: str) -> bool:
    allowed = getattr(view, "password_change_allowed", False)
    if allowed is True:
        return True
    return bool(allowed) and method.upper() in allowed


def is_public_view(view) -> bool:
    """Every permission of this request is ``AllowAny`` (or there is none)."""
    if view is None:
        return False
    try:
        perms = view.get_permissions()
    except Exception:  # noqa: BLE001 - unknown means not public: refuse
        return False
    return all(isinstance(p, AllowAny) for p in perms)


class JWTAuthentication(SimpleJWTAuthentication):
    """SimpleJWT's bearer authentication with the password-change gate."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user = result[0]
        if not getattr(user, "password_change_required", False):
            return result
        view = (getattr(request, "parser_context", None) or {}).get("view")
        if allowed_while_password_change_required(view, request.method):
            return result
        if is_public_view(view):
            # The public site as anyone sees it: never as this account.
            return None
        raise PasswordChangeRequired()


try:  # The staff-only API docs describe it as the same bearer JWT.
    from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme

    class GateJWTScheme(SimpleJWTScheme):
        target_class = "apps.accounts.authentication.JWTAuthentication"

except ImportError:  # pragma: no cover - drf-spectacular is a dependency
    pass
