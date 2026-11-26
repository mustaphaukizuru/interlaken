"""
bookings/services/followup.py: which visits still need the school.

Every web booking is confirmed on the spot (``create_booking``), so «Pendiente»
is almost never used and the console's red dot, which counted pending
bookings, stayed at 0 while families booked (owner, 2026-11-25: three visits
nobody saw). What the office needs instead:

- **upcoming**: visits from today on that still stand (pending or confirmed):
  people who are coming. The red dot on «Visitas».
- **to close**: visits whose day has passed and that nobody marked «Asistió»,
  «No asistió» or cancelled. «Por cerrar» under «Visitas».

Both are plain filters on the slot's school-local date, shared by the badge
counts (core/badges.py) and the Visitas list filter (``followup``), so the
number in the menu always matches the list it opens.
"""

from django.db.models import Q
from django.utils import timezone

from ..models import Booking

# A booking that still occupies its seat and has no result yet.
OPEN_STATUSES = (Booking.Status.PENDING, Booking.Status.CONFIRMED)


def upcoming_q(today=None) -> Q:
    """Standing visits on ``today`` (school-local) or later."""
    day = today or timezone.localdate()
    return Q(status__in=OPEN_STATUSES, slot__date__gte=day)


def to_close_q(today=None) -> Q:
    """Visits before ``today`` still pending or confirmed: nobody recorded how they went."""
    day = today or timezone.localdate()
    return Q(status__in=OPEN_STATUSES, slot__date__lt=day)


def upcoming_visits(today=None):
    return Booking.objects.filter(upcoming_q(today))


def visits_to_close(today=None):
    return Booking.objects.filter(to_close_q(today))
