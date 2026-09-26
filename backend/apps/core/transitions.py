"""
core/transitions.py — the lifecycle tables every status endpoint obeys (Data Ops C5).

Until this round every status endpoint accepted any target (a rejected
pre-registro could jump straight to "inscrito"; an attended booking could be
"cancelled"). One table per entity lives here and BOTH the single-row endpoints
and the bulk actions call ``assert_transition`` so they cannot diverge.

A *reverse* transition (undoing a decision: rejected → pending, resolved →
in_review, attended ↔ no_show) requires a ``note`` and is audited with it.

    >>> assert_transition('bookings.booking', 'pending', 'confirmed')
    >>> assert_transition('bookings.booking', 'cancelled', 'pending', note='')
    ValidationError: Indique el motivo para revertir el estado.

Entities are keyed ``app_label.modelname`` (the same key ``AuditLog.object_type``
uses). ``StudentProfile`` is free among its four states because the archive
rule (withdrawing surfaces the wallet balance) is a warning, not a guard.
"""

from __future__ import annotations

from django.apps import apps
from django.core.exceptions import FieldDoesNotExist
from rest_framework.exceptions import ValidationError

TRANSITIONS: dict[str, dict[str, frozenset[str]]] = {
    "admissions.preregistration": {
        "pending": frozenset({"contacted", "enrolled", "rejected"}),
        "contacted": frozenset({"enrolled", "rejected", "pending"}),
        "rejected": frozenset({"pending"}),
        "enrolled": frozenset(),
    },
    "admissions.registration": {
        "submitted": frozenset({"reviewing", "approved", "rejected"}),
        "reviewing": frozenset({"approved", "rejected", "submitted"}),
        "approved": frozenset({"complete", "reviewing"}),
        "rejected": frozenset({"reviewing"}),
        # draft and complete only move through the family form / convert paths.
        "draft": frozenset(),
        "complete": frozenset(),
    },
    "bookings.booking": {
        "pending": frozenset({"confirmed", "cancelled", "no_show", "attended"}),
        "confirmed": frozenset({"attended", "no_show", "cancelled"}),
        "cancelled": frozenset({"pending"}),
        "attended": frozenset({"no_show"}),
        "no_show": frozenset({"attended"}),
    },
    "cafeteria.topuprequest": {
        "pending": frozenset({"completed", "failed"}),
        "failed": frozenset({"pending"}),
        "completed": frozenset(),
    },
    "legal.arcorequest": {
        "received": frozenset({"in_review", "resolved", "rejected"}),
        "in_review": frozenset({"resolved", "rejected"}),
        "resolved": frozenset({"in_review"}),
        "rejected": frozenset({"in_review"}),
    },
    "accounts.passwordrequest": {
        "open": frozenset({"resolved", "rejected"}),
        "resolved": frozenset(),
        "rejected": frozenset(),
    },
    # Announcement has no status column: 'active'/'inactive' map to is_active
    # (a never-published draft counts as inactive).
    "portal.announcement": {
        "draft": frozenset({"active"}),
        "inactive": frozenset({"active"}),
        "active": frozenset({"inactive"}),
    },
    "accounts.studentprofile": {
        "active": frozenset({"on_leave", "graduated", "withdrawn"}),
        "on_leave": frozenset({"active", "graduated", "withdrawn"}),
        "graduated": frozenset({"active", "on_leave", "withdrawn"}),
        "withdrawn": frozenset({"active", "on_leave", "graduated"}),
    },
}

# Undoing a decision: allowed, but only with a note (audited with it).
REVERSE_TRANSITIONS: frozenset[tuple[str, str, str]] = frozenset(
    {
        ("admissions.preregistration", "contacted", "pending"),
        ("admissions.preregistration", "rejected", "pending"),
        ("admissions.registration", "reviewing", "submitted"),
        ("admissions.registration", "approved", "reviewing"),
        ("admissions.registration", "rejected", "reviewing"),
        ("bookings.booking", "cancelled", "pending"),
        ("bookings.booking", "attended", "no_show"),
        ("bookings.booking", "no_show", "attended"),
        ("cafeteria.topuprequest", "failed", "pending"),
        ("legal.arcorequest", "resolved", "in_review"),
        ("legal.arcorequest", "rejected", "in_review"),
    }
)

# States with no outgoing transition at all.
TERMINAL: dict[str, frozenset[str]] = {
    entity: frozenset(state for state, targets in table.items() if not targets)
    for entity, table in TRANSITIONS.items()
}


class TransitionError(ValidationError):
    """400 with an es-MX message; ``code`` tells bulk whether to skip or fail."""


# Entities whose states are not a ``status`` choices column (Announcement maps
# is_active + fanout_at onto draft/inactive/active) name their states here.
STATE_LABELS: dict[str, dict[str, str]] = {
    "portal.announcement": {"draft": "Borrador", "inactive": "Inactivo", "active": "Activo"},
}


def _labels(entity: str) -> dict[str, str]:
    """``{'pending': 'Pendiente', ...}`` from the model's ``status`` choices, if any."""
    if entity in STATE_LABELS:
        return STATE_LABELS[entity]
    try:
        model = apps.get_model(entity)
        field = model._meta.get_field("status")
    except (LookupError, ValueError, FieldDoesNotExist):
        return {}
    return {str(k): str(v) for k, v in (field.choices or [])}


def label(entity: str, state: str) -> str:
    return _labels(entity).get(state, state)


def allowed_targets(entity: str, current: str) -> frozenset[str]:
    table = TRANSITIONS.get(entity)
    if table is None:
        raise KeyError(f"No hay tabla de transiciones para {entity}.")
    return table.get(current, frozenset())


def is_reverse(entity: str, current: str, target: str) -> bool:
    return (entity, current, target) in REVERSE_TRANSITIONS


def assert_transition(entity: str, current: str, target: str, *, note: str | None = None) -> None:
    """Raise ``TransitionError`` unless ``current → target`` is allowed for ``entity``.

    * same state → code ``same_state`` (bulk reports it as *omitido*);
    * not in the table → code ``not_allowed``;
    * reverse transition without ``note`` → code ``note_required``.
    ``note=None`` skips the note check (single-row callers that collect the
    note elsewhere); pass ``''`` to enforce it.
    """
    if current == target:
        raise TransitionError(f"Ya está en estado «{label(entity, current)}».", code="same_state")
    if target not in allowed_targets(entity, current):
        raise TransitionError(
            f"No se puede pasar de «{label(entity, current)}» a «{label(entity, target)}».",
            code="not_allowed",
        )
    if note is not None and is_reverse(entity, current, target) and not str(note).strip():
        raise TransitionError("Indique el motivo para revertir el estado.", code="note_required")


def transition_code(exc: ValidationError) -> str:
    """The ``code`` of a single-message ValidationError ('' when unknown)."""
    detail = exc.detail
    if isinstance(detail, list) and detail:
        detail = detail[0]
    return str(getattr(detail, "code", "") or "")
