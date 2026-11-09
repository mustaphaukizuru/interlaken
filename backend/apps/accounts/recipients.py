"""
accounts/recipients.py — who actually receives a notification addressed to a user.

School policy (BACKLOG P0-5): anything addressed to a *student* must reach the
student's real mailbox (if any) AND every linked guardian. Student accounts
created by the importers carry a synthetic ``<matricula>@alumnos.interlaken.edu.mx``
address that receives no mail, so it is never a delivery target. One notice
reaches each address once (``own_copy_mailboxes``).
"""
from __future__ import annotations

from .import_students import STUDENT_EMAIL_DOMAIN
from .models import NotificationPreference, User

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
    profile = getattr(user, 'student_profile', None) if getattr(user, 'role', None) == User.Role.STUDENT else None
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


def mailboxes_of(users) -> list[str]:
    """Real mailboxes of ``users`` (own address unless synthetic, plus a
    confirmed personal ``notify_email``), deduplicated, order kept."""
    out, seen = [], set()
    for u in users:
        for addr in getattr(u, 'mailboxes', None) or []:
            key = addr.lower()
            if key not in seen:
                seen.add(key)
                out.append(addr)
    return out


def email_recipients(user) -> list[str]:
    """Real mailboxes for ``user``: own (unless synthetic) + guardians', each
    with its confirmed personal address."""
    return mailboxes_of(delivery_users(user))


def wants(user, channel: str, notif_type: str, cache: dict | None = None) -> bool:
    """Whether ``user`` receives ``notif_type`` notices by ``channel`` ('email' or 'push').

    Each delivery target answers for itself (Avisos tab: channel on, category
    not muted; urgent warnings always). ``cache`` (a dict, user pk → prefs)
    reads each user's preferences once per dispatch pass; never creates a row.
    """
    prefs = cache.get(user.pk) if cache is not None else None
    if prefs is None:
        prefs = NotificationPreference.lookup(user)
        if cache is not None:
            cache[user.pk] = prefs
    return prefs.wants(channel, notif_type)


def own_copy_reach(users, notif_type: str, *, cache: dict | None = None) -> set[str]:
    """Lowercased addresses ``users`` receive in their own copy of a
    ``notif_type`` notice (those who keep email on for it)."""
    return {addr.lower() for u in users if wants(u, 'email', notif_type, cache)
            for addr in mailboxes_of([u])}


def own_copy_mailboxes(user, notif_type: str, *, cache: dict | None = None) -> list[str]:
    """``user``'s mailboxes for a notice every family member also gets in
    their own copy (``notify(fanout=False)`` from a family loop).

    A student's confirmed personal address is often a guardian's own address
    (the parent added it on the student's login). The guardian's copy already
    reaches it, so the student's copy leaves out every address an active
    linked guardian gets in theirs, case-insensitively: one email per address
    and notice (2026-11-08: a purchase notice went to mama@… twice).
    """
    guardians = [g for g in delivery_users(user) if g.pk != user.pk]
    covered = own_copy_reach(guardians, notif_type, cache=cache)
    return [addr for addr in mailboxes_of([user]) if addr.lower() not in covered]
