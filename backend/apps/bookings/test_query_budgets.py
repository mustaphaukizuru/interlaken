"""P7 query budget: public availability is ONE query regardless of slot count.

Parametrizes small-N vs 3N and asserts the SAME pinned constant, so any
reintroduced per-slot aggregate (the old 3-aggregates-per-slot N+1) fails.
"""

import datetime

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.bookings.models import AvailabilitySlot, Booking, VisitType

pytestmark = pytest.mark.django_db

# Single annotated SELECT (booked totals grouped into the slot query).
AVAILABILITY_BUDGET = 1


class TestAvailabilityBudget:
    @pytest.mark.parametrize("n_slots", [50, 150])
    def test_single_query_regardless_of_slot_count(
        self, api_client, django_assert_num_queries, n_slots
    ):
        base = timezone.localdate() + datetime.timedelta(days=7)
        slots = [
            AvailabilitySlot.objects.create(
                visit_type=VisitType.INDIVIDUAL,
                date=base + datetime.timedelta(days=i // 10),
                start_time=datetime.time(8 + (i % 10), 0),
                end_time=datetime.time(8 + (i % 10), 30),
                capacity=5,
            )
            for i in range(n_slots)
        ]
        # Partial occupancy: booked_count/is_full must come from the annotation.
        for slot in slots[::5]:
            Booking.objects.create(
                slot=slot,
                parent_name="P",
                parent_email="p@test.mx",
                parent_phone="555",
                num_attendees=2,
            )

        with django_assert_num_queries(AVAILABILITY_BUDGET):
            resp = api_client.get(reverse("bookings-availability"))
        assert resp.status_code == 200
        assert len(resp.data) == n_slots  # capacity 5, max 2 booked: none full
        booked = {s["id"]: s for s in resp.data}
        assert booked[slots[0].id]["spots_remaining"] == 3
        assert booked[slots[1].id]["spots_remaining"] == 5


# ── Data Ops Phase 10: admin exports and the week board ───────────────────
# Exports are consumed inside the assert block so the streamed rows and the
# audit insert are counted.
# count + rows (slot joined) + audit insert.
BOOKINGS_EXPORT_BUDGET = 3
# count + annotated rows + audit insert.
SLOTS_EXPORT_BUDGET = 3
# slots of the week + bookings prefetch.
WEEK_BUDGET = 2


def _slot(i, start):
    return AvailabilitySlot.objects.create(
        visit_type=VisitType.INDIVIDUAL,
        date=start + datetime.timedelta(days=i % 5),
        start_time=datetime.time(8 + i // 5, 0),
        end_time=datetime.time(8 + i // 5, 30),
        capacity=5,
    )


def _book(slot, i):
    return Booking.objects.create(
        slot=slot,
        parent_name=f"P{i}",
        parent_email=f"p{i}@test.mx",
        parent_phone="5512345678",
        num_attendees=1,
        status=Booking.Status.CONFIRMED,
    )


def _csv_lines(resp) -> list[str]:
    raw = b"".join(resp.streaming_content) if resp.streaming else resp.content
    return [line for line in raw.decode("utf-8-sig").split("\r\n")[1:] if line]


def _next_monday():
    today = timezone.localdate()
    return today + datetime.timedelta(days=7 - today.weekday())


class TestBookingsAdminBudgets:
    @pytest.mark.parametrize("n", [1, 12])
    def test_bookings_export(self, admin_client, django_assert_num_queries, n):
        monday = _next_monday()
        for i in range(n):
            _book(_slot(i, monday), i)
        with django_assert_num_queries(BOOKINGS_EXPORT_BUDGET):
            resp = admin_client.get(reverse("bookings-admin-export"))
            assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_slots_export(self, admin_client, django_assert_num_queries, n):
        monday = _next_monday()
        for i in range(n):
            _book(_slot(i, monday), i)
        with django_assert_num_queries(SLOTS_EXPORT_BUDGET):
            resp = admin_client.get(reverse("bookings-admin-slots-export"))
            assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_week_board(self, admin_client, django_assert_num_queries, n):
        monday = _next_monday()
        for i in range(n):
            _book(_slot(i, monday), i)
        with django_assert_num_queries(WEEK_BUDGET):
            resp = admin_client.get(reverse("bookings-admin-week"), {"start": monday.isoformat()})
        assert resp.status_code == 200
        assert sum(len(d["slots"]) for d in resp.data["days"]) == n
