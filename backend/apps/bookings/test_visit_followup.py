"""Owner points 2026-11-25: the Visitas list filters the same visits the menu
counts: «Próximas» (the red dot) and «Por cerrar» (past visits nobody closed)."""

from datetime import time, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import UserFactory
from apps.accounts.models import User
from apps.core.badges import _compute_badges

from .models import AvailabilitySlot, Booking, VisitType

pytestmark = pytest.mark.django_db

S = Booking.Status


@pytest.fixture
def visits():
    today = timezone.localdate()
    hours = iter(range(7, 20))

    def book(days, status):
        h = next(hours)
        slot = AvailabilitySlot.objects.create(
            visit_type=VisitType.INDIVIDUAL,
            date=today + timedelta(days=days),
            start_time=time(h),
            end_time=time(h, 30),
            capacity=3,
        )
        return Booking.objects.create(
            slot=slot,
            parent_name="Ana López",
            parent_phone="5512345678",
            parent_email="ana@test.mx",
            status=status,
        ).pk

    return {
        "today": book(0, S.CONFIRMED),
        "tomorrow": book(1, S.CONFIRMED),
        "next_week_pending": book(7, S.PENDING),
        "future_cancelled": book(2, S.CANCELLED),
        "yesterday_open": book(-1, S.CONFIRMED),
        "last_week_open": book(-7, S.PENDING),
        "yesterday_attended": book(-1, S.ATTENDED),
        "yesterday_no_show": book(-1, S.NO_SHOW),
        "yesterday_cancelled": book(-1, S.CANCELLED),
    }


def _ids(client, **params):
    resp = client.get(reverse("bookings-admin-list"), params)
    assert resp.status_code == 200, resp.data
    return {row["id"] for row in resp.data["results"]}


def test_proximas_and_por_cerrar_match_the_menu_counts(admin_client, admin_user, visits):
    upcoming = _ids(admin_client, followup="upcoming")
    to_close = _ids(admin_client, followup="to_close")
    assert upcoming == {visits["today"], visits["tomorrow"], visits["next_week_pending"]}
    assert to_close == {visits["yesterday_open"], visits["last_week_open"]}
    badges = _compute_badges(admin_user)
    assert badges["visitas"] == len(upcoming)
    assert badges["visitas_cerrar"] == len(to_close)


def test_the_filter_combines_with_the_others_and_rejects_unknown_values(admin_client, visits):
    assert _ids(admin_client, followup="upcoming", status="pending") == {
        visits["next_week_pending"]
    }
    resp = admin_client.get(reverse("bookings-admin-list"), {"followup": "someday"})
    assert resp.status_code == 400


def test_visitas_staff_can_use_it_and_others_cannot(api_client, visits):
    api_client.force_authenticate(user=UserFactory(role=User.Role.STAFF, staff_areas=["visitas"]))
    assert _ids(api_client, followup="to_close") == {
        visits["yesterday_open"],
        visits["last_week_open"],
    }
    api_client.force_authenticate(user=UserFactory(role=User.Role.STAFF, staff_areas=["cafeteria"]))
    assert (
        api_client.get(reverse("bookings-admin-list"), {"followup": "to_close"}).status_code == 403
    )
