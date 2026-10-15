"""Family accounts cannot edit their own profile (bitácora 14/10/2026, punto 10).

Parents and students see their name, WhatsApp and photo in "Mi información"
but the school keeps them: a correction is requested, not typed in. Staff and
admins still edit their own profile. Passwords were already school-managed
(there is no self-service change endpoint at all).
"""
from rest_framework import status
from rest_framework.response import Response

from apps.core.exceptions import error_body

from .models import User

LOCKED_ROLES = frozenset({User.Role.PARENT, User.Role.STUDENT})

LOCKED_MESSAGE = (
    'Los datos de su cuenta los actualiza el colegio. '
    'Para corregir algo, escriba a info@interlaken.com.mx.'
)


def profile_locked(user) -> bool:
    return getattr(user, 'role', None) in LOCKED_ROLES


def locked_response() -> Response:
    return Response(error_body(LOCKED_MESSAGE, code='profile_locked'), status=status.HTTP_403_FORBIDDEN)
