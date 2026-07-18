"""
bookings.services — booking side effects, split by concern.

  - ``notifications`` : our branded Spanish confirmation email.
  - ``calendar``      : Google Calendar events (service account, fail-soft).

Re-exported here so callers keep using ``from apps.bookings.services import …``.
The ``calendar`` submodule is namespaced (``from . import calendar as calendar``)
rather than star-imported to avoid clashing with Python's stdlib ``calendar``.
"""
from . import calendar
from .booking import SlotUnavailable, create_booking
from .notifications import send_booking_confirmation, send_booking_reminder

__all__ = ['send_booking_confirmation', 'send_booking_reminder', 'calendar',
           'create_booking', 'SlotUnavailable']
