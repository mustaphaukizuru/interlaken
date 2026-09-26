"""
bookings/services/status.py — the one path a booking's status changes through.

Both the single-row admin endpoint (``AdminBookingActionView``) and the bulk
endpoint (``AdminBookingBulkView``) call ``change_booking_status`` so they can
never diverge (Data Ops C5):

* the transition table (``apps.core.transitions``, entity ``bookings.booking``)
  guards every move: a cancelled booking can only be reopened (→ pending, with
  a note), an attended ↔ no-show correction needs a note, and so on;
* a move that (re)claims seats (→ pending / confirmed) locks the slot with
  ``select_for_update`` and sums ``num_attendees`` of the other bookings that
  occupy it, exactly like ``create_booking`` (``AvailabilitySlot.spots_remaining``);
* side effects stay per row as before: the confirmation email (optional via
  ``notify``) and the Google Calendar sync.

``occupied_seats`` counts the same statuses as ``AvailabilitySlot.annotate_booked``
(pending, confirmed, attended); cancelled and no-show free their seats. The
reschedule endpoint uses it too, so the three capacity checks agree.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from apps.core.transitions import assert_transition

from ..models import AvailabilitySlot, Booking
from . import calendar
from .notifications import send_booking_confirmation

ENTITY = "bookings.booking"

# Same set as AvailabilitySlot.annotate_booked / booked_count.
OCCUPYING = (Booking.Status.PENDING, Booking.Status.CONFIRMED, Booking.Status.ATTENDED)
# Targets that promise a seat in a (usually future) slot: re-check capacity.
SEAT_TARGETS = (Booking.Status.PENDING, Booking.Status.CONFIRMED)


class CapacityError(ValidationError):
    """400: the slot cannot take this booking's attendees."""


def occupied_seats(slot, *, exclude_pk=None) -> int:
    """Attendees of the bookings that occupy ``slot`` (optionally minus one booking)."""
    qs = Booking.objects.filter(slot=slot, status__in=OCCUPYING)
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs.aggregate(total=Sum("num_attendees"))["total"] or 0


def check_capacity(booking, slot, *, lock: bool = True) -> AvailabilitySlot:
    """Raise ``CapacityError`` unless ``slot`` fits ``booking.num_attendees``.

    ``lock=True`` (the write path) re-reads the slot under ``select_for_update``
    so two admins confirming into the last seats cannot both succeed; the bulk
    dry-run passes ``lock=False``. Must run inside ``transaction.atomic()`` when
    locking.
    """
    if lock:
        slot = AvailabilitySlot.objects.select_for_update().get(pk=slot.pk)
    taken = occupied_seats(slot, exclude_pk=booking.pk)
    free = max(0, slot.capacity - taken)
    if booking.num_attendees > free:
        raise CapacityError(
            f"El horario ya no tiene cupo suficiente: quedan {free} de {slot.capacity} "
            f"lugares y la reserva es para {booking.num_attendees}."
        )
    return slot


def plan_booking_status(booking, target: str, *, note: str | None = None) -> None:
    """The dry-run of ``change_booking_status``: guard + capacity, no writes, no lock."""
    assert_transition(ENTITY, booking.status, target, note=note)
    if target in SEAT_TARGETS:
        check_capacity(booking, booking.slot, lock=False)


def change_booking_status(booking, target: str, *, note: str | None = None, notify: bool = True):
    """Move ``booking`` to ``target`` under the transition table; returns the previous status.

    ``note=None`` skips the reverse-transition note check; callers that take a
    note from the person pass the string (``''`` enforces it). ``notify=False``
    skips the confirmation email (the calendar still syncs).
    """
    previous = booking.status
    assert_transition(ENTITY, previous, target, note=note)
    with transaction.atomic():
        if target in SEAT_TARGETS:
            check_capacity(booking, booking.slot, lock=True)
        booking.status = target
        booking.save(update_fields=["status", "updated_at"])

    if target == Booking.Status.CONFIRMED:
        if notify and booking.parent_email and not booking.confirmation_sent:
            send_booking_confirmation(booking)
        calendar.sync_booking_created(booking)
    elif target == Booking.Status.PENDING:
        # A reopened (previously cancelled) visit gets its calendar event back.
        calendar.sync_booking_created(booking)
    elif target == Booking.Status.CANCELLED:
        calendar.sync_booking_cancelled(booking)
    return previous
