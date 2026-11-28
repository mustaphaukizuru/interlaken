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
from .staff_alerts import alert_staff


class SlotUnavailable(Exception):
    """The requested slot can't take this booking (missing/past/inactive/full)."""


class AlreadyBooked(Exception):
    """The family already has a visit of this type still to come (owner
    2026-11-26: one family booked three visits with the same email and the
    school had to cancel two, each cancellation emailing the family).

    ``existing`` is that visit; the message names only its day, time and type,
    which the family themselves typed the email or phone for."""

    def __init__(self, existing):
        self.existing = existing
        super().__init__(already_booked_message(existing))


WEEKDAYS = ('lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo')


def already_booked_message(existing, *, whatsapp: bool = False) -> str:
    """«Ya tiene una visita agendada el jueves 3 de diciembre a las 11:45 (Visita
    individual). Si desea cambiarla, escríbanos por WhatsApp o llame al colegio.»
    In the WhatsApp chat itself the family is told to answer right there."""
    from apps.portal.emailing import MONTHS

    slot = existing.slot
    day = f'{WEEKDAYS[slot.date.weekday()]} {slot.date.day} de {MONTHS[slot.date.month - 1]}'
    change = ('Si desea cambiarla, respóndanos por este medio.' if whatsapp
              else 'Si desea cambiarla, escríbanos por WhatsApp o llame al colegio.')
    return (f'Ya tiene una visita agendada el {day} a las {slot.start_time:%H:%M} '
            f'({slot.get_visit_type_display()}). {change}')


def existing_payload(existing) -> dict:
    """What the public API says about the visit the family already has (no personal data)."""
    slot = existing.slot
    return {
        'date': slot.date.isoformat(),
        'start_time': f'{slot.start_time:%H:%M}',
        'visit_type': slot.visit_type,
        'visit_type_label': slot.get_visit_type_display(),
    }


def find_standing_booking(*, email='', phone='', visit_type=''):
    """The family's visit of ``visit_type`` still to come (pending or confirmed,
    not started yet), matched by email (case and spaces ignored) or by phone
    (its last 10 digits, so «55 1234 5678», «+52 1 55…» and a WhatsApp sender
    are the same number), or ``None``.

    Only the same type counts: a family with an individual visit may still sign
    up for «Puertas Abiertas», a different, group event."""
    from apps.admissions.process import phone_key
    from apps.admissions.services import RETENTION_PLACEHOLDER

    email = (email or '').strip()
    if email == RETENTION_PLACEHOLDER:
        email = ''
    key = phone_key(phone)
    if not email and not key:
        return None
    now = timezone.now()
    candidates = (Booking.objects
                  .filter(status__in=(Booking.Status.PENDING, Booking.Status.CONFIRMED),
                          slot__date__gte=timezone.localdate())
                  .select_related('slot')
                  .order_by('slot__date', 'slot__start_time'))
    if visit_type:
        candidates = candidates.filter(slot__visit_type=visit_type)
    for booking in candidates:
        if timezone.make_aware(datetime.combine(booking.slot.date, booking.slot.start_time)) < now:
            continue  # today's visit already started: a missed one never blocks a new one
        if email and (booking.parent_email or '').strip().lower() == email.lower():
            return booking
        if key and phone_key(booking.parent_phone) == key:
            return booking
    return None


def create_booking(*, slot_id, parent_name, parent_email='', parent_phone='',
                   child_name='', child_grade='', num_attendees=1,
                   source=Booking.Source.WEB, notes='', notify_email=True, pre_registration=None,
                   allow_duplicate=False):
    """Create a confirmed booking for ``slot_id`` under a row lock.

    Returns the ``Booking``. Raises ``SlotUnavailable`` if the slot can't take it.
    Email + calendar side effects run outside the lock and are fail-soft, so a
    broken SMTP/Google never turns a saved booking into a 500. The email is only
    sent when a ``parent_email`` is present (WhatsApp bookings confirm in-channel).
    The school hears about every booking, whatever its source (``staff_alerts``:
    admissions inbox, Visitas staff and administrators), after the commit.
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
        # Every public entry point (web form, «Puertas Abiertas», WhatsApp) goes
        # through here; under the slot lock, so a double click on the same slot
        # sees the first booking. Staff paths may pass allow_duplicate=True.
        if not allow_duplicate:
            existing = find_standing_booking(email=parent_email, phone=parent_phone,
                                             visit_type=slot.visit_type)
            if existing is not None:
                raise AlreadyBooked(existing)
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
            pre_registration=pre_registration,
        )

    if notify_email and parent_email:
        send_booking_confirmation(booking)
    calendar.sync_booking_created(booking)
    alert_staff(booking)
    return booking
