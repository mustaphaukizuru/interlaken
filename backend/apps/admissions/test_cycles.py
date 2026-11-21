"""The Mexican school year (August to July) used by the ficha (admissions.cycles)."""

from datetime import date

import pytest

from apps.admissions import cycles


@pytest.mark.parametrize(
    "today,running,upcoming",
    [
        (date(2026, 11, 20), "2026-2027", "2027-2028"),
        (date(2027, 3, 1), "2026-2027", "2027-2028"),
        (date(2027, 9, 15), "2027-2028", "2028-2029"),
        (date(2027, 7, 31), "2026-2027", "2027-2028"),  # last day of the school year
        (date(2027, 8, 1), "2027-2028", "2028-2029"),  # first day of the next one
        (date(2027, 1, 1), "2026-2027", "2027-2028"),
    ],
)
def test_running_and_next_cycle(today, running, upcoming):
    assert cycles.running_cycle(today) == running
    assert cycles.next_cycle(today) == upcoming
    assert cycles.allowed_cycles(today) == (running, upcoming)


def test_choice_aliases():
    today = date(2026, 11, 20)
    assert cycles.cycle_for_choice("actual", today) == "2026-2027"
    assert cycles.cycle_for_choice("proximo", today) == "2027-2028"
    assert cycles.cycle_for_choice("otro", today) is None


def test_parse_cycle():
    assert cycles.parse_cycle("2026-2027") == 2026
    assert cycles.parse_cycle("2026-2028") is None
    assert cycles.parse_cycle("2026/2027") is None
    assert cycles.parse_cycle("") is None


def test_cycle_choices_shape():
    options = cycles.cycle_choices(date(2027, 3, 1))
    assert [o["key"] for o in options] == ["actual", "proximo"]
    assert [o["value"] for o in options] == ["2026-2027", "2027-2028"]
    assert "en curso" in options[0]["label"]


def test_current_school_cycle_is_untouched(monkeypatch):
    """This phase must not change the calendar-year cycle the old forms stamp."""
    from django.utils import timezone

    from apps.admissions.models import current_school_cycle

    monkeypatch.setattr(timezone, "localdate", lambda: date(2027, 3, 1))
    assert current_school_cycle() == "2027-2028"
    assert cycles.running_cycle() == "2026-2027"
