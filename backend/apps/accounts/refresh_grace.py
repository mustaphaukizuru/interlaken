"""A short reuse window for a refresh token that was just rotated.

Refresh tokens rotate and the old one is blacklisted at once. When the browser
drops the answer (a reload or «Atrás» while the silent refresh is in flight, a
phone losing signal) the new cookie is never stored, the browser sends the old
token again and the family is signed out (QA 2026-11-24, reproduced by
pressing «Atrás» on the payment page).

The window: an old token rotated less than ``GRACE`` ago whose successor was
never used is accepted once more. Its unused successor is blacklisted and a
fresh session is issued. A token blacklisted by «Cerrar sesión» never had a
successor, and one whose successor was already used (or itself signed out) is
refused as before, so a stolen old token cannot outlive the session it came
from.
"""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

GRACE = timedelta(seconds=60)
# The successor is written in the same request as the blacklisting.
_SAME_ROTATION = timedelta(seconds=5)


def user_for_recent_rotation(raw: str):
    """The user to re-issue a session for, or None (refuse as before)."""
    from rest_framework_simplejwt.settings import api_settings
    from rest_framework_simplejwt.state import token_backend
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    from .models import User

    try:
        # Signature and expiry only: the blacklist check is the point here.
        payload = token_backend.decode(raw, verify=True)
    except Exception:  # any token that does not decode is refused
        return None
    if payload.get(api_settings.TOKEN_TYPE_CLAIM) != 'refresh':
        return None
    jti = payload.get(api_settings.JTI_CLAIM)
    user_id = payload.get(api_settings.USER_ID_CLAIM)
    if not jti or user_id is None:
        return None

    now = timezone.now()
    entry = (BlacklistedToken.objects.select_related('token')
             .filter(token__jti=jti).first())
    if entry is None or entry.blacklisted_at < now - GRACE:
        return None

    successors = (OutstandingToken.objects
                  .filter(user_id=user_id,
                          created_at__gte=entry.blacklisted_at - _SAME_ROTATION,
                          created_at__lte=entry.blacklisted_at + _SAME_ROTATION)
                  .exclude(jti=jti))
    if not successors.exists() or successors.filter(blacklistedtoken__isnull=False).exists():
        # Signed out (no successor), or the session already moved on.
        return None

    user = User.objects.filter(pk=user_id, is_active=True, archived_at__isnull=True).first()
    if user is None:
        return None
    for token in successors:
        BlacklistedToken.objects.get_or_create(token=token)
    return user
