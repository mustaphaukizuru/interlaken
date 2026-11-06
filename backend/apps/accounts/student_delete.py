"""
accounts/student_delete.py — removing a student who should not be on the platform.

"Baja definitiva" stays the archive for anyone with a past. A real delete is only
for a record with nothing to keep: never signed in, no money, no history, and no
Loyverse customer that would bring it back at the next roster sync.

The history check fails closed: it asks Django what a delete of the login would
touch, and anything outside ``DISPOSABLE`` stops it, a model added next year
included. The wallet is the one exception, because the row itself carries no
history once its balance is zero.
"""
from django.contrib.admin.utils import NestedObjects
from django.db import DEFAULT_DB_ALIAS
from django.db.models import QuerySet

from apps.core.bulk import BulkSkip

from .models import StudentProfile, User

# Typed by the person in the confirm dialog and checked again by the server.
DELETE_CONFIRMATION = 'ELIMINAR'

# What a delete may take with it: the account and its own settings and inbox.
DISPOSABLE = frozenset({
    'accounts.user',
    'accounts.studentprofile',
    'accounts.studentprofile_parents',
    'accounts.notificationpreference',
    'cafeteria.loyverseprofile',
    'portal.notification',
    'portal.pushsubscription',
    'portal.announcementread',
})


def _has_history(user, wallet) -> bool:
    """Would deleting ``user`` remove, block on or orphan anything worth keeping?"""
    collector = NestedObjects(using=DEFAULT_DB_ALIAS)
    collector.collect([user])
    if any(obj != wallet for obj in collector.protected):
        return True
    if any(model._meta.label_lower not in DISPOSABLE for model in collector.model_objs):
        return True
    # SET_NULL relations (a payment, a consent, an audit row) would silently lose
    # their owner: a row in any of them is history too.
    return any(
        batch.exists() if isinstance(batch, QuerySet) else bool(batch)
        for batches in collector.field_updates.values()
        for batch in batches
    )


def deletion_blocker(profile) -> str | None:
    """Why ``profile`` cannot be deleted, worded to follow "N porque …", or None.

    Cheap checks first: a dry run can cover hundreds of rows, and most stop here
    before the collector runs its queries.
    """
    from apps.cafeteria.models import CafeteriaBalance

    user = profile.user
    if user.role != User.Role.STUDENT:
        return 'su cuenta no es de alumno'
    if user.last_login is not None:
        return 'ya inició sesión en el portal'
    if profile.loyverse_id and profile.loyverse_missing_since is None:
        return 'sigue en Loyverse y la sincronización lo volvería a crear'
    if profile.registration_id:
        return 'viene de una inscripción de Admisiones'
    wallet = CafeteriaBalance.objects.filter(student=profile).first()
    if wallet is not None and wallet.balance != 0:
        return 'todavía tiene saldo en cafetería'
    if profile.parents.exclude(pk=user.pk).exists():
        return 'tiene un tutor con cuenta propia'
    if StudentProfile.objects.filter(parents=user).exclude(pk=profile.pk).exists():
        return 'es tutor de otro alumno'
    if _has_history(user, wallet):
        return 'tiene historial de compras, pagos o consentimientos'
    return None


def delete_student(profile) -> dict:
    """Remove the login, the profile and the empty wallet.

    Returns the identity the audit row keeps, since nothing else will say who
    this was. The caller holds the row lock and the transaction.
    """
    from apps.cafeteria.models import CafeteriaBalance

    blocker = deletion_blocker(profile)
    if blocker:
        raise BulkSkip(blocker)
    deleted = {
        'matricula': profile.student_id,
        'name': profile.user.full_name,
        'grade': profile.grade,
        'group': profile.group,
    }
    CafeteriaBalance.objects.filter(student=profile).delete()
    profile.user.delete()
    return deleted
