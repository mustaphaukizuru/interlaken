"""
accounts/cookies.py — httpOnly refresh-cookie + double-submit CSRF helpers.

The refresh token is delivered only as an httpOnly cookie (never in a response
body or URL, so JavaScript and logs can't see it). A companion JS-readable CSRF
cookie is issued at the same time; state-changing cookie endpoints (refresh,
logout) require that value echoed in the ``X-CSRF-Token`` header. Because a
cross-site page cannot read the CSRF cookie (same-origin policy), it cannot forge
the header — this is the classic double-submit defense. See AUTH.md.
"""
import secrets

from django.conf import settings
from rest_framework_simplejwt.tokens import RefreshToken


def _refresh_max_age() -> int:
    return int(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds())


def _base_kwargs() -> dict:
    return {
        'secure': settings.AUTH_COOKIE_SECURE,
        'samesite': settings.AUTH_COOKIE_SAMESITE,
        'domain': settings.AUTH_COOKIE_DOMAIN,
        'path': settings.AUTH_COOKIE_PATH,
    }


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_refresh_cookie(response, refresh_token: str) -> None:
    response.set_cookie(
        settings.AUTH_REFRESH_COOKIE, str(refresh_token),
        max_age=_refresh_max_age(), httponly=True, **_base_kwargs(),
    )


def set_csrf_cookie(response, token: str) -> None:
    # httponly=False on purpose: the SPA must read it to echo the header.
    response.set_cookie(
        settings.AUTH_CSRF_COOKIE, token,
        max_age=_refresh_max_age(), httponly=False, **_base_kwargs(),
    )


def clear_auth_cookies(response) -> None:
    kw = _base_kwargs()
    for name in (settings.AUTH_REFRESH_COOKIE, settings.AUTH_CSRF_COOKIE):
        response.delete_cookie(
            name, path=kw['path'], domain=kw['domain'], samesite=kw['samesite'],
        )


def issue_session(user, response) -> str:
    """Mint a refresh+access pair, attach the httpOnly refresh + CSRF cookies to
    ``response``, and return the short-lived access token (memory-only client-side)."""
    refresh = RefreshToken.for_user(user)
    access = str(refresh.access_token)
    set_refresh_cookie(response, str(refresh))
    set_csrf_cookie(response, new_csrf_token())
    return access


def csrf_ok(request) -> bool:
    """True when the X-CSRF-Token header matches the CSRF cookie (double-submit)."""
    cookie = request.COOKIES.get(settings.AUTH_CSRF_COOKIE)
    header = request.headers.get('X-CSRF-Token')
    return bool(cookie) and bool(header) and secrets.compare_digest(cookie, header)
