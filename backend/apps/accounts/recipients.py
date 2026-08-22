"""
accounts/recipients.py — who actually receives a notification addressed to a user.

School policy (BACKLOG P0-5): anything addressed to a *student* must reach the
student's real mailbox (if any) AND every linked guardian. Student accounts
created by the importers carry a synthetic ``<matricula>@alumnos.interlaken.edu.mx``
address that receives no mail, so it is never a delivery target.
"""
from __future__ import annotations

from .import_students import STUDENT_EMAIL_DOMAIN
from .models import User

SYNTHETIC_SUFFIX = f'@{STUDENT_EMAIL_DOMAIN}'


def is_synthetic_email(email: str | None) -> bool:
    """True for importer-generated student addresses that receive no mail."""
    return bool(email) and email.strip().lower().endswith(SYNTHETIC_SUFFIX)


def delivery_users(user) -> list[User]:
    """The user plus, for students, every active linked guardian (deduplicated).

    The order is stable: the addressee first, then guardians by pk.
    """
    if user is None:
        return []
    targets: list[User] = [user]
    if getattr(user, 'role', None) == User.Role.STUDENT:
        profile = getattr(user, 'student_profile', None)
        if profile is not None:
            for guardian in profile.parents.filter(is_active=True).order_by('pk'):
                if guardian.pk != user.pk:
                    targets.append(guardian)
    seen, unique = set(), []
    for u in targets:
        if u.pk not in seen:
            seen.add(u.pk)
            unique.append(u)
    return unique


def email_recipients(user) -> list[str]:
    """Real mailboxes for ``user``: own (unless synthetic) + guardians'."""
    out, seen = [], set()
    for u in delivery_users(user):
        addr = (getattr(u, 'email', '') or '').strip()
        if not addr or is_synthetic_email(addr):
            continue
        key = addr.lower()
        if key not in seen:
            seen.add(key)
            out.append(addr)
    return out
