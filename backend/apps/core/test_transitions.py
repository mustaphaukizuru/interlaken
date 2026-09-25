"""
apps.core.transitions — the lifecycle tables of Data Ops C5, exactly as
specified, plus the note requirement on reverse transitions.
"""

import pytest
from rest_framework.exceptions import ValidationError

from apps.core.transitions import (
    REVERSE_TRANSITIONS,
    TERMINAL,
    TRANSITIONS,
    TransitionError,
    allowed_targets,
    assert_transition,
    is_reverse,
    label,
    transition_code,
)

EXPECTED = {
    "admissions.preregistration": {
        "pending": {"contacted", "enrolled", "rejected"},
        "contacted": {"enrolled", "rejected", "pending"},
        "rejected": {"pending"},
        "enrolled": set(),
    },
    "admissions.registration": {
        "submitted": {"reviewing", "approved", "rejected"},
        "reviewing": {"approved", "rejected", "submitted"},
        "approved": {"complete", "reviewing"},
        "rejected": {"reviewing"},
        "draft": set(),
        "complete": set(),
    },
    "bookings.booking": {
        "pending": {"confirmed", "cancelled", "no_show", "attended"},
        "confirmed": {"attended", "no_show", "cancelled"},
        "cancelled": {"pending"},
        "attended": {"no_show"},
        "no_show": {"attended"},
    },
    "cafeteria.topuprequest": {
        "pending": {"completed", "failed"},
        "failed": {"pending"},
        "completed": set(),
    },
    "legal.arcorequest": {
        "received": {"in_review", "resolved", "rejected"},
        "in_review": {"resolved", "rejected"},
        "resolved": {"in_review"},
        "rejected": {"in_review"},
    },
    "accounts.passwordrequest": {
        "open": {"resolved", "rejected"},
        "resolved": set(),
        "rejected": set(),
    },
    "portal.announcement": {
        "draft": {"active"},
        "inactive": {"active"},
        "active": {"inactive"},
    },
}


@pytest.mark.parametrize("entity", sorted(EXPECTED))
def test_tables_match_the_contract(entity):
    assert {state: set(targets) for state, targets in TRANSITIONS[entity].items()} == EXPECTED[
        entity
    ]


def test_student_status_is_free_among_its_four_states():
    states = {"active", "on_leave", "graduated", "withdrawn"}
    for state in states:
        assert allowed_targets("accounts.studentprofile", state) == states - {state}


def test_terminal_states():
    assert TERMINAL["admissions.preregistration"] == {"enrolled"}
    assert TERMINAL["admissions.registration"] == {"draft", "complete"}
    assert TERMINAL["cafeteria.topuprequest"] == {"completed"}
    assert TERMINAL["accounts.passwordrequest"] == {"resolved", "rejected"}


def test_reverse_transitions_are_the_documented_ones():
    assert REVERSE_TRANSITIONS == {
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
    # Every reverse pair is also an allowed transition.
    for entity, current, target in REVERSE_TRANSITIONS:
        assert target in TRANSITIONS[entity][current]
        assert is_reverse(entity, current, target)


class TestAssertTransition:
    def test_allowed_passes(self):
        assert assert_transition("bookings.booking", "pending", "confirmed") is None
        assert (
            assert_transition("bookings.booking", "cancelled", "pending", note="cupo liberado")
            is None
        )

    def test_not_allowed_has_es_mx_message_with_labels(self):
        with pytest.raises(TransitionError) as exc:
            assert_transition("bookings.booking", "attended", "cancelled")
        assert str(exc.value.detail[0]) == "No se puede pasar de «Asistió» a «Cancelada»."
        assert transition_code(exc.value) == "not_allowed"
        assert isinstance(exc.value, ValidationError) and exc.value.status_code == 400

    def test_same_state(self):
        with pytest.raises(TransitionError) as exc:
            assert_transition("legal.arcorequest", "resolved", "resolved")
        assert str(exc.value.detail[0]) == "Ya está en estado «Resuelta»."
        assert transition_code(exc.value) == "same_state"

    def test_reverse_requires_note_only_when_asked(self):
        with pytest.raises(TransitionError) as exc:
            assert_transition("legal.arcorequest", "resolved", "in_review", note="  ")
        assert transition_code(exc.value) == "note_required"
        assert str(exc.value.detail[0]) == "Indique el motivo para revertir el estado."
        # note=None: the caller collects the note elsewhere (single-row endpoints).
        assert assert_transition("legal.arcorequest", "resolved", "in_review") is None

    def test_terminal_state_refuses_everything(self):
        with pytest.raises(TransitionError):
            assert_transition("admissions.preregistration", "enrolled", "pending", note="x")

    def test_unknown_entity(self):
        with pytest.raises(KeyError):
            assert_transition("nope.model", "a", "b")

    def test_labels_fall_back_to_raw_values(self):
        assert label("bookings.booking", "no_show") == "No asistió"
        assert label("portal.announcement", "active") == "active"
        assert label("nope.model", "x") == "x"
