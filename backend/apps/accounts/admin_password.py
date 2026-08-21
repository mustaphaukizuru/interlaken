"""
Admin-managed password reset for family accounts (school policy: only an
administrator resets a family's password).

POST /api/v1/accounts/admin/users/<pk>/set-password/

Why this endpoint exists: ``import_students`` / ``loyverse_import`` create both
the alumno's User and its guardians with ``set_unusable_password()``, so a
family has no password at all. The two self-service recovery paths do not work
for them - the synthetic ``<matricula>@alumnos.interlaken.edu.mx`` address
receives no mail, and Google OAuth needs a real Google account. The front desk
therefore needs a way to hand a family a working credential.

Safety rails (all enforced here, all covered by tests):

* admin-only (``IsAdmin`` - ``role == 'admin'``);
* **never** targets another administrator or a superuser: an admin who can
  rewrite a peer's password owns that peer's account, which would turn "reset
  the Perez family's password" into a privilege-escalation primitive. Admins
  change their own password through the normal authenticated flow;
* any admin-supplied password goes through Django's ``validate_password``;
* a generated password is returned exactly once, in the response body, and is
  never written to the audit log or the server log;
* every outstanding refresh token for the target is blacklisted, so sessions
  opened with the old credential die with the reset;
* one append-only ``AuditLog`` row records who reset whose password and why.
"""
import logging
import secrets

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.throttling import SharedScopedRateThrottle

from .import_students import IsAdmin
from .models import User

logger = logging.getLogger(__name__)

# Deliberately excludes every look-alike pair (0/O, 1/l/I, 5/S, 8/B, 2/Z, u/v).
# A temporary password is read off a screen, dictated over the phone or copied
# onto a printed slip, so an ambiguous glyph is a support call.
_SAFE_ALPHABET = 'ACDEFGHJKLMNPQRTWXYacdefghjkmnpqrtwxy34679'
_GENERATED_CHARS = 16
_GROUP = 4


def generate_temporary_password() -> str:
    """Return a 16-character CSPRNG password grouped as ``xxxx-xxxx-xxxx-xxxx``.

    16 characters over a 42-symbol alphabet is ~86 bits of entropy; the hyphens
    are cosmetic (they make the value dictatable) and add no guessing cost.
    """
    raw = ''.join(secrets.choice(_SAFE_ALPHABET) for _ in range(_GENERATED_CHARS))
    return '-'.join(raw[i:i + _GROUP] for i in range(0, _GENERATED_CHARS, _GROUP))


def revoke_refresh_tokens(user) -> int:
    """Blacklist every outstanding refresh token for ``user``; return how many.

    ``rest_framework_simplejwt.token_blacklist`` is installed and rotation
    already blacklists on refresh (see ``CookieTokenRefreshView``), so every
    session the user holds has an ``OutstandingToken`` row. Blacklisting them
    all means an attacker holding a stolen refresh cookie cannot outlive the
    reset. Access tokens are not revocable by design; they expire in 15 min.
    """
    from rest_framework_simplejwt.token_blacklist.models import (
        BlacklistedToken,
        OutstandingToken,
    )

    revoked = 0
    for token in OutstandingToken.objects.filter(user=user).only('id'):
        _, created = BlacklistedToken.objects.get_or_create(token=token)
        revoked += int(created)
    return revoked


def _audit_set_password(actor, target, *, generated: bool, reason: str, revoked: int) -> None:
    """Append one AuditLog row for the reset. Fail-open: an audit failure must
    never leave the admin thinking the reset did not happen (it did).

    ``action`` uses the model's ``PERMISSION`` choice - ``AuditLog.action`` is a
    20-char choices field, so the dotted label lives in ``context`` exactly as
    ``finance.mark_paid`` does. The password itself is never recorded.
    """
    try:
        from apps.core.audit import record
        record(
            'permission', target,
            {
                'password': ['[redacted]', '[redacted]'],
                'source': 'generated' if generated else 'admin-supplied',
                'reason': reason,
                'sessions_revoked': revoked,
                'target_email': target.email,
                'target_role': target.role,
            },
            actor=actor,
            context='accounts.set_password',
        )
    except Exception:  # noqa: BLE001 - audit is best-effort by design
        logger.warning('AuditLog write failed for password reset of user #%s',
                       target.pk, exc_info=True)


class AdminSetPasswordView(APIView):
    """POST /api/v1/accounts/admin/users/<pk>/set-password/

    Body (both optional)::

        {"password": "<explicit>", "reason": "<why>"}

    With no ``password`` a strong temporary one is generated and returned as
    ``temporary_password`` - the only time it is ever readable. An
    admin-supplied password is **not** echoed back.
    """
    permission_classes = [IsAdmin]
    # Per-admin ceiling: a legitimate front-desk reset is a handful per minute;
    # 20/min still blunts scripted mass-rewriting of every family credential.
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = 'admin-set-password'

    def post(self, request, pk):
        target = get_object_or_404(User, pk=pk)

        if target.role == User.Role.ADMIN or target.is_superuser:
            return Response(
                {'detail': 'No se puede restablecer la contraseña de una cuenta '
                           'administradora desde aquí: un administrador que reescribe '
                           'la contraseña de otro se apropiaría de esa cuenta. '
                           'Cada administrador cambia su propia contraseña desde su '
                           'perfil o con el enlace de recuperación.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        reason = (request.data.get('reason') or '').strip()[:200]
        supplied = request.data.get('password')
        generated = not supplied

        if generated:
            password = generate_temporary_password()
        else:
            password = str(supplied)
            try:
                validate_password(password, user=target)
            except DjangoValidationError as exc:
                return Response({'password': list(exc.messages)},
                                status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            target.set_password(password)
            target.save(update_fields=['password'])
            # Inside the transaction on purpose: a reset that sets a new
            # password but leaves old sessions alive is worse than no reset.
            revoked = revoke_refresh_tokens(target)

        _audit_set_password(request.user, target,
                            generated=generated, reason=reason, revoked=revoked)
        logger.info('Admin %s reset the password of user #%s (%s); %d session(s) revoked.',
                    request.user.email, target.pk, target.email, revoked)

        data = {
            'detail': 'Contraseña restablecida.',
            'user': {
                'id': target.id,
                'email': target.email,
                'full_name': target.full_name,
                'role': target.role,
            },
            'sessions_revoked': revoked,
        }
        if generated:
            # Shown once by the SPA, never persisted anywhere else.
            data['temporary_password'] = password
        return Response(data)
