"""
bookings/tests.py — capacity safety and cancellation behaviour.
"""
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import AvailabilitySlot, Booking


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
