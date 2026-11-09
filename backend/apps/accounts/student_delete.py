"""
accounts/student_delete.py — taking a student off the platform.

Owner, 2026-11-08: an admin must always be able to remove a student who no
longer attends. A record with nothing to keep is erased; anyone with a past
(payments, purchases, a balance, a Loyverse customer, a family that signed in)
is archived instead: off every list, no sign-in, history and balance intact,
and back with Restaurar. Shared rules: ``account_removal``.
"""
from apps.core.bulk import BulkSkip

from .account_removal import archive_account, has_history, restore_account
from .models import StudentProfile, User

# Sent by the console with every delete; the server refuses a delete without it.
DELETE_CONFIRMATION = 'ELIMINAR'

ERASE, ARCHIVE = 'erased', 'archived'


def _student_account(profile):
    """A profile whose login is not a student's (a tutor's, after a merge) is handled in Usuarios."""
    if profile.user.role != User.Role.STUDENT:
        raise BulkSkip('su cuenta no es de alumno; adminístrela en Usuarios')


def keep_reason(profile) -> str | None:
    """Why ``profile`` must be archived rather than erased, or None when nothing needs keeping.

    Cheap checks first: a plan can cover hundreds of rows, and most stop here
    before the delete collector runs its queries.
    """
    from apps.cafeteria.models import CafeteriaBalance

    user = profile.user
    if user.last_login is not None:
        return 'ya inició sesión en el portal'
    if profile.loyverse_id and profile.loyverse_missing_since is None:
        return 'sigue en Loyverse'
    if profile.registration_id:
        return 'viene de una inscripción de Admisiones'
    wallet = CafeteriaBalance.objects.filter(student=profile).first()
    if wallet is not None and wallet.balance != 0:
        return 'tiene saldo en cafetería'
    if profile.parents.exclude(pk=user.pk).exists():
        return 'tiene un tutor con cuenta propia'
    if StudentProfile.objects.filter(parents=user).exclude(pk=profile.pk).exists():
        return 'es tutor de otro alumno'
    if has_history(user, keep_allowed=wallet):
        return 'tiene compras, pagos o actividad'
    return None


def removal_plan(profile) -> str:
    """What a delete will do to ``profile``: ``erased`` or ``archived``."""
    _student_account(profile)
    if keep_reason(profile) is None:
        return ERASE
    if profile.user.archived_at is not None:
        raise BulkSkip('ya está archivado')
    return ARCHIVE


def archive_student(profile) -> dict:
    """Withdraw and hide ``profile``; its history and balance stay."""
    _student_account(profile)
    before = profile.status
    if before != StudentProfile.Status.WITHDRAWN:
        profile.save(update_fields=profile.apply_status(StudentProfile.Status.WITHDRAWN))
    changes = archive_account(profile.user)
    return {'outcome': ARCHIVE, 'status': [before, profile.status], **changes}


def restore_student(profile) -> dict:
    """Back on the lists as «Baja definitiva»; Reactivar lets them sign in again."""
    _student_account(profile)
    return {'outcome': 'restored', **restore_account(profile.user, reactivate=False)}


def remove_student(profile) -> dict:
    """Erase ``profile`` when there is nothing to keep, else archive it.

    Returns the audit changes; an erase keeps the identity, since nothing else
    will say who this was. The caller holds the row lock and the transaction.
    """
    from apps.cafeteria.models import CafeteriaBalance

    _student_account(profile)
    reason = keep_reason(profile)
    if reason is not None:
        if profile.user.archived_at is not None:
            raise BulkSkip('ya está archivado')
        return {**archive_student(profile), 'reason': reason}
    deleted = {
        'matricula': profile.student_id,
        'name': profile.user.full_name,
        'grade': profile.grade,
        'group': profile.group,
    }
    CafeteriaBalance.objects.filter(student=profile).delete()
    profile.user.delete()
    return {'outcome': ERASE, 'deleted': deleted}
