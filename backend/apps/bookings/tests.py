"""
bookings/tests.py — capacity safety, cancellation, and fail-soft calendar.
"""
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import AvailabilitySlot, Booking
from .services import calendar


class BookingCapacityTests(APITestCase):
    def setUp(self):
        self.slot = AvailabilitySlot.objects.create(
            visit_type=AvailabilitySlot._meta.get_field('visit_type').default,
            date=timezone.now().date() + timedelta(days=3),
            start_time='09:00', end_time='09:30',
            capacity=1, location='Campus',
        )

    def _book(self, name='Ana'):
        return self.client.post(reverse('bookings-create'), {
            'slot': self.slot.id,
            'parent_name': name,
            'parent_email': 'ana@example.com',
            'parent_phone': '5512345678',
            'num_attendees': 1,
        }, format='json')

    def test_booking_fills_slot_and_second_is_rejected(self):
        r1 = self._book('Ana')
        self.assertEqual(r1.status_code, 201, r1.data)
        self.assertTrue(AvailabilitySlot.objects.get(pk=self.slot.id).is_full)

        r2 = self._book('Beto')
        self.assertEqual(r2.status_code, 400, r2.data)

    def test_cancel_frees_the_slot(self):
        r1 = self._book('Ana')
        booking_id = r1.data['id']

        cancel = self.client.post(reverse('bookings-cancel', args=[booking_id]))
        self.assertEqual(cancel.status_code, 200, cancel.data)
        self.assertFalse(AvailabilitySlot.objects.get(pk=self.slot.id).is_full)

        r2 = self._book('Beto')
        self.assertEqual(r2.status_code, 201, r2.data)

    def test_confirmation_flag_and_email(self):
        r1 = self._book('Ana')
        booking = Booking.objects.get(pk=r1.data['id'])
        self.assertTrue(booking.confirmation_sent)

    def test_availability_hides_full_slots(self):
        self._book('Ana')
        r = self.client.get(reverse('bookings-availability'), {'type': 'individual'})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn(self.slot.id, [s['id'] for s in r.data])

    def test_booking_succeeds_with_calendar_unconfigured(self):
        """A booking must never fail because Google Calendar is unset."""
        r = self._book('Ana')
        self.assertEqual(r.status_code, 201, r.data)
        booking = Booking.objects.get(pk=r.data['id'])
        # Fail-soft: no event created, but the booking stands (sync_calendar later).
        self.assertEqual(booking.google_event_id, '')


@override_settings(GOOGLE_CALENDAR_ID='', GOOGLE_CALENDAR_SA_KEY='')
class CalendarFailSoftTests(TestCase):
    """The calendar service degrades to no-ops when unconfigured — never raises."""

    def setUp(self):
        slot = AvailabilitySlot.objects.create(
            visit_type='individual',
            date=timezone.now().date() + timedelta(days=5),
            start_time='10:00', end_time='10:30', capacity=1,
        )
        self.booking = Booking.objects.create(
            slot=slot, parent_name='Ana', parent_email='ana@example.com',
            parent_phone='5512345678', num_attendees=1,
        )

    def test_is_configured_false_when_unset(self):
        self.assertFalse(calendar.is_configured())

    def test_create_event_returns_empty_when_unconfigured(self):
        self.assertEqual(calendar.create_event(self.booking), '')

    def test_cancel_event_returns_false_when_unconfigured(self):
        self.assertFalse(calendar.cancel_event('some-event-id'))

    def test_sync_helpers_are_noops_when_unconfigured(self):
        self.assertEqual(calendar.sync_booking_created(self.booking), '')
        self.assertEqual(self.booking.google_event_id, '')
        self.assertFalse(calendar.sync_booking_cancelled(self.booking))

    def test_sync_calendar_command_is_clean_noop(self):
        out = StringIO()
        call_command('sync_calendar', stdout=out)
        self.assertIn('not configured', out.getvalue())
