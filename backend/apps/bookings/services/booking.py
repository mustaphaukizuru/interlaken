"""
bookings/services/booking.py — capacity-safe booking creation, shared by every
entry point (web slot picker, admissions open-school signup, WhatsApp bot).

Locks the slot row (``select_for_update``) so concurrent bookings can't oversell
capacity, then fires the fail-soft side effects (branded email + Google Calendar).
Raises ``SlotUnavailable`` (a plain 400-worthy error) when the slot is gone,
inactive, in the past, or already full.
"""
from datetime import datetime

from django.db import transaction
from django.utils import timezone

from ..models import AvailabilitySlot, Booking
from . import calendar
from .notifications import send_booking_confirmation


class SlotUnavailable(Exception):
    """The requested slot can't take this booking (missing/past/inactive/full)."""


def create_booking(*, slot_id, parent_name, parent_email='', parent_phone='',
                   child_name='', child_grade='', num_attendees=1,
                   source=Booking.Source.WEB, notes='', notify_email=True):
    """Create a confirmed booking for ``slot_id`` under a row lock.

    Returns the ``Booking``. Raises ``SlotUnavailable`` if the slot can't take it.
    Email + calendar side effects run outside the lock and are fail-soft, so a
    broken SMTP/Google never turns a saved booking into a 500. The email is only
    sent when a ``parent_email`` is present (WhatsApp bookings confirm in-channel).
    """
    with transaction.atomic():
        try:
            slot = AvailabilitySlot.objects.select_for_update().get(pk=slot_id)
        except AvailabilitySlot.DoesNotExist:
            raise SlotUnavailable('El horario seleccionado no existe.') from None
        # Compare the slot's LOCAL start datetime against now — not just the
        # date, and not the UTC date. slot.date < now().date() used the UTC
        # calendar day (America/Mexico_City is UTC-6), which both rejected valid
        # same-day evening slots (18:00-23:59 local) and accepted a slot whose
        # start time had already elapsed earlier today.
        slot_start = timezone.make_aware(datetime.combine(slot.date, slot.start_time))
        if not slot.is_active or slot_start < timezone.now():
            raise SlotUnavailable('Este horario ya no está disponible.')
        if slot.spots_remaining < num_attendees:
            raise SlotUnavailable('El horario seleccionado ya no tiene cupo disponible.')
        booking = Booking.objects.create(
            slot=slot,
            parent_name=parent_name,
            parent_email=parent_email,
            parent_phone=parent_phone,
            child_name=child_name,
            child_grade=child_grade,
            num_attendees=num_attendees,
            status=Booking.Status.CONFIRMED,
            source=source,
            notes=notes,
        )

    if notify_email and parent_email:
        send_booking_confirmation(booking)
    calendar.sync_booking_created(booking)
    return booking
