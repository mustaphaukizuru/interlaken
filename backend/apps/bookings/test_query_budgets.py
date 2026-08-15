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
    @pytest.mark.parametrize('n_slots', [50, 150])
    def test_single_query_regardless_of_slot_count(
            self, api_client, django_assert_num_queries, n_slots):
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
                slot=slot, parent_name='P', parent_email='p@test.mx',
                parent_phone='555', num_attendees=2,
            )

        with django_assert_num_queries(AVAILABILITY_BUDGET):
            resp = api_client.get(reverse('bookings-availability'))
        assert resp.status_code == 200
        assert len(resp.data) == n_slots  # capacity 5, max 2 booked: none full
        booked = {s['id']: s for s in resp.data}
        assert booked[slots[0].id]['spots_remaining'] == 3
        assert booked[slots[1].id]['spots_remaining'] == 5
