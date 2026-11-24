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

from datetime import datetime

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.bulk import after_commit
from apps.core.transitions import assert_transition

from ..models import AvailabilitySlot, Booking
from . import calendar
from .notifications import send_booking_cancellation, send_booking_confirmation

ENTITY = "bookings.booking"

# Same set as AvailabilitySlot.annotate_booked / booked_count.
OCCUPYING = (Booking.Status.PENDING, Booking.Status.CONFIRMED, Booking.Status.ATTENDED)
# Targets that promise a seat in a (usually future) slot: re-check capacity.
SEAT_TARGETS = (Booking.Status.PENDING, Booking.Status.CONFIRMED)


class CapacityError(ValidationError):
    """400: the slot cannot take this booking's attendees."""


# «Asistió» / «No asistió» record what happened at the visit: not before it.
ATTENDANCE_TARGETS = (Booking.Status.ATTENDED, Booking.Status.NO_SHOW)


def visit_started(booking) -> bool:
    """True once the visit's start time has come (school time zone, the
    ``TIME_ZONE`` setting: Mexico City)."""
    slot = booking.slot
    start = timezone.make_aware(datetime.combine(slot.date, slot.start_time))
    return timezone.now() >= start


def assert_visit_started(booking, target: str) -> None:
    """400 «La visita aún no ocurre.» for attendance on a visit still to come
    (QA 2026-11-24: a visit could be marked «Asistió» days before)."""
    if target in ATTENDANCE_TARGETS and not visit_started(booking):
        raise ValidationError('La visita aún no ocurre.', code='not_started')
    # Undoing an attendance (→ «Confirmada») is for a mark made by mistake; a
    # visit with a recorded result already moved its admissions case.
    if (target == Booking.Status.CONFIRMED and booking.status in ATTENDANCE_TARGETS
            and booking.outcome):
        raise ValidationError('Esta visita ya tiene un resultado registrado: no se puede volver '
                              'a «Confirmada».', code='has_outcome')


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
    assert_visit_started(booking, target)
    if target in SEAT_TARGETS:
        check_capacity(booking, booking.slot, lock=False)


def change_booking_status(booking, target: str, *, note: str | None = None, notify: bool = True):
    """Move ``booking`` to ``target`` under the transition table; returns the previous status.

    ``note=None`` skips the reverse-transition note check; callers that take a
    note from the person pass the string (``''`` enforces it). ``notify=False``
    skips the family's email (confirmation or cancellation; the calendar still
    syncs). Attendance (attended / no-show) is refused before the visit starts.
    """
    previous = booking.status
    assert_transition(ENTITY, previous, target, note=note)
    assert_visit_started(booking, target)
    with transaction.atomic():
        if target in SEAT_TARGETS:
            check_capacity(booking, booking.slot, lock=True)
        booking.status = target
        booking.save(update_fields=["status", "updated_at"])

    def side_effects():
        if target == Booking.Status.CONFIRMED:
            if notify and booking.parent_email and not booking.confirmation_sent:
                send_booking_confirmation(booking)
            calendar.sync_booking_created(booking)
        elif target == Booking.Status.PENDING:
            # A reopened (previously cancelled) visit gets its calendar event back.
            calendar.sync_booking_created(booking)
        elif target == Booking.Status.CANCELLED:
            calendar.sync_booking_cancelled(booking)
            # The family is told (QA 2026-11-24: a visit cancelled from the
            # console sent nothing), unless the visit is already past.
            if notify and booking.parent_email and not visit_started(booking):
                send_booking_cancellation(booking)

    # Now on a single row; in a bulk run once the chunk commits, so a rolled
    # back confirmation never leaves a sent email or a calendar event behind.
    after_commit(side_effects)
    return previous
