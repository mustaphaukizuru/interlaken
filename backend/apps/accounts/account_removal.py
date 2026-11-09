"""
accounts/account_removal.py — archiving and erasing people (students and staff).

Owner, 2026-11-08: an admin must always be able to take someone off the lists.

- **Archive** hides the person everywhere, blocks sign-in and ends their
  sessions; every payment, purchase, balance and audit row stays. Reversible
  from the Archivados view.
- **Erase** is permanent and only for a record with nothing to keep. Asked to
  erase someone with a past, the callers archive instead and say so.

The "nothing to keep" test fails closed: it asks Django what a delete of the
login would touch, and anything outside ``DISPOSABLE`` (a model added next
year included) counts as history.
"""

from django.contrib.admin.utils import NestedObjects
from django.db import DEFAULT_DB_ALIAS
from django.db.models import QuerySet
from django.utils import timezone

from apps.core.bulk import BulkSkip

from .admin_password import revoke_refresh_tokens

# What an erase may take with it: the account and its own settings and inbox.
DISPOSABLE = frozenset(
    {
        "accounts.user",
        "accounts.studentprofile",
        "accounts.studentprofile_parents",
        "accounts.notificationpreference",
        "cafeteria.loyverseprofile",
        "portal.notification",
        "portal.pushsubscription",
        "portal.announcementread",
    }
)


def has_history(user, *, keep_allowed=None) -> bool:
    """Would deleting ``user`` remove, block on or orphan anything worth keeping?

    ``keep_allowed`` is the one protected row the caller deletes itself first
    (a student's empty wallet).
    """
    collector = NestedObjects(using=DEFAULT_DB_ALIAS)
    collector.collect([user])
    if any(obj != keep_allowed for obj in collector.protected):
        return True
    if any(model._meta.label_lower not in DISPOSABLE for model in collector.model_objs):
        return True
    # SET_NULL relations (a payment, a consent, an audit row, a sign-in) would
    # silently lose their owner: a row in any of them is history too.
    return any(
        batch.exists() if isinstance(batch, QuerySet) else bool(batch)
        for batches in collector.field_updates.values()
        for batch in batches
    )


def archive_account(user) -> dict:
    """Hide ``user``, block their sign-in and end their sessions. Returns the audit changes."""
    if user.archived_at is not None:
        raise BulkSkip("ya está archivado")
    was_active = user.is_active
    user.archived_at = timezone.now()
    user.is_active = False
    user.save(update_fields=["archived_at", "is_active"])
    return {
        "archived": [False, True],
        "is_active": [was_active, False],
        "sessions_revoked": revoke_refresh_tokens(user),
    }


def restore_account(user, *, reactivate: bool) -> dict:
    """Bring ``user`` back to the lists; staff may sign in again, students wait for Reactivar."""
    if user.archived_at is None:
        raise BulkSkip("no está archivado")
    user.archived_at = None
    fields, changes = ["archived_at"], {"archived": [True, False]}
    if reactivate and not user.is_active:
        user.is_active = True
        fields.append("is_active")
        changes["is_active"] = [False, True]
    user.save(update_fields=fields)
    return changes
