"""
admissions/guardians.py — the ficha's parent blocks ↔ the legacy parent fields.

The ficha stores «Datos del padre» and «Datos de la madre» as
``RegistrationGuardian`` rows, and the step-0 contact (who fills the ficha in)
on the Registration. Everything built before the ficha (lists, search,
dedupe indexes, exports, emails, «Mis inscripciones», ``ConvertView``) reads
``parent1_*`` / ``parent2_*``. ``sync_legacy_parents`` is the ONE place that
derives them:

* **parent1** = the contact. When an applicable guardian block has the same
  email (case-insensitive), parent1 takes that block's full name, its mobile
  and its occupation.
* **parent2** = the other applicable guardian with an email different from
  parent1's (legal guardians first, then the Excel order padre, madre). With
  no such guardian parent2 is blank. When the contact said they are «Madre»
  or «Padre» but used another email in that block, that block is not
  offered as parent2 (it is the same person).
* A registration with no guardian rows at all (the old wizard) keeps its
  parent2 and occupation as typed.

``ConvertView`` creates or links one family account per parent1/parent2
email, so this function decides who gets a login.
"""

from __future__ import annotations

from collections.abc import Iterable

from .ficha_schema import OCCUPATION_OTHER, choice_label

GUARDIAN_ORDER = ("padre", "madre")
# contact_relationship → the block that is the contact themself.
RELATIONSHIP_ROLE = {"madre": "madre", "padre": "padre"}

LEGACY_PARENT_FIELDS = (
    "parent1_name",
    "parent1_email",
    "parent1_phone",
    "parent1_occupation",
    "parent2_name",
    "parent2_email",
    "parent2_phone",
)


def join_name(*parts: str) -> str:
    return " ".join(p.strip() for p in parts if p and p.strip())


def guardian_full_name(g) -> str:
    """«Nombre(s) Paterno Materno»."""
    return join_name(g.given_names, g.paternal_surname, g.maternal_surname)


def split_full_name(name: str) -> tuple[str, str, str]:
    """Best-effort ``(given_names, paternal, maternal)`` from one full name.

    Mexican convention: the last two words are the surnames. One word is a
    given name; two words are given name + paternal surname.
    """
    words = (name or "").split()
    if not words:
        return "", "", ""
    if len(words) == 1:
        return words[0], "", ""
    if len(words) == 2:
        return words[0], words[1], ""
    return " ".join(words[:-2]), words[-2], words[-1]


def occupation_display(g) -> str:
    if not g.occupation:
        return ""
    if g.occupation == OCCUPATION_OTHER and g.occupation_other:
        return g.occupation_other.strip()
    return choice_label("ocupacion", g.occupation)


def applies(g) -> bool:
    """A block counts when it is not «No aplica» and holds someone."""
    return not g.not_applicable and bool(
        (g.given_names or "").strip()
        or (g.paternal_surname or "").strip()
        or (g.email or "").strip()
    )


def _low(value: str) -> str:
    return (value or "").strip().lower()


def _ordered(guardians: Iterable) -> list:
    return sorted(
        guardians, key=lambda g: GUARDIAN_ORDER.index(g.role) if g.role in GUARDIAN_ORDER else 9
    )


def legacy_parent_values(reg, guardians: Iterable) -> dict[str, str]:
    """What ``parent1_*`` / ``parent2_*`` should hold for ``reg`` (pure: no save)."""
    guardians = _ordered(guardians)
    contact_email = (reg.contact_email or reg.parent1_email or "").strip()
    contact_name = (reg.contact_name or "").strip() or reg.parent1_name
    contact_phone = (reg.contact_phone or "").strip() or reg.parent1_phone
    applicable = [g for g in guardians if applies(g)]

    match = next(
        (g for g in applicable if contact_email and _low(g.email) == _low(contact_email)), None
    )
    out = {
        "parent1_name": (guardian_full_name(match) if match else "") or contact_name,
        "parent1_email": contact_email,
        "parent1_phone": ((match.mobile or "").strip() if match else "") or contact_phone,
    }
    if not guardians:
        # The old wizard: nothing to derive parent2 or the occupation from.
        out["parent1_occupation"] = reg.parent1_occupation
        out.update(
            parent2_name=reg.parent2_name,
            parent2_email=reg.parent2_email,
            parent2_phone=reg.parent2_phone,
        )
        return out

    out["parent1_occupation"] = occupation_display(match) if match else ""
    self_role = None if match else RELATIONSHIP_ROLE.get(_low(reg.contact_relationship))
    others = [
        g
        for g in applicable
        if g is not match
        and g.role != self_role
        and _low(g.email)
        and _low(g.email) != _low(contact_email)
    ]
    others.sort(key=lambda g: not g.is_legal_guardian)  # stable: keeps padre, madre order
    other = others[0] if others else None
    out.update(
        parent2_name=guardian_full_name(other) if other else "",
        parent2_email=(other.email or "").strip() if other else "",
        parent2_phone=(other.mobile or "").strip() if other else "",
    )
    return out


def sync_legacy_parents(reg, guardians: Iterable | None = None, *, save: bool = True) -> list[str]:
    """Write ``legacy_parent_values`` onto ``reg``; returns the fields that changed.

    ``guardians`` defaults to the registration's rows. With ``save=False`` the
    caller saves (a registration that does not exist yet).
    """
    if guardians is None:
        guardians = list(reg.guardians.all()) if reg.pk else []
    values = legacy_parent_values(reg, guardians)
    changed = []
    for field, value in values.items():
        value = value or ""
        limit = reg._meta.get_field(field).max_length
        if limit:
            value = value[:limit]
        if getattr(reg, field) != value:
            setattr(reg, field, value)
            changed.append(field)
    if changed and save and reg.pk:
        reg.save(update_fields=[*changed, "updated_at"])
    return changed
