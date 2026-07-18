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

from apps.accounts.models import User

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

        # Cancel is now owner-authenticated: the booking's contact email is
        # ana@example.com, so a guardian account with that email may cancel it.
        owner = User.objects.create_user(
            email='ana@example.com', password='x',
            first_name='Ana', last_name='Padre', role=User.Role.PARENT,
        )
        self.client.force_authenticate(user=owner)
        cancel = self.client.post(reverse('bookings-cancel', args=[booking_id]))
        self.assertEqual(cancel.status_code, 200, cancel.data)
        self.assertFalse(AvailabilitySlot.objects.get(pk=self.slot.id).is_full)

        self.client.force_authenticate(user=None)  # creating a booking stays public
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


class BookingAccessControlTests(APITestCase):
    """Booking detail/cancel are authenticated + owner-only (no IDOR / PII leak)."""

    def setUp(self):
        self.slot = AvailabilitySlot.objects.create(
            visit_type='individual',
            date=timezone.now().date() + timedelta(days=4),
            start_time='11:00', end_time='11:30', capacity=1,
        )
        self.booking = Booking.objects.create(
            slot=self.slot, parent_name='Owner', parent_email='owner@example.com',
            parent_phone='5510000000', num_attendees=1,
        )
        self.owner = User.objects.create_user(
            email='owner@example.com', password='x',
            first_name='Owner', last_name='Guardian', role=User.Role.PARENT,
        )
        self.other = User.objects.create_user(
            email='other@example.com', password='x',
            first_name='Other', last_name='Family', role=User.Role.PARENT,
        )
        self.admin = User.objects.create_user(
            email='admin@example.com', password='x',
            first_name='Ada', last_name='Admin', role=User.Role.ADMIN, is_staff=True,
        )
        self.detail_url = reverse('bookings-detail', args=[self.booking.id])
        self.cancel_url = reverse('bookings-cancel', args=[self.booking.id])

    # ── anonymous → 401 ──────────────────────────────────────────────
    def test_anonymous_detail_is_401(self):
        self.assertEqual(self.client.get(self.detail_url).status_code, 401)

    def test_anonymous_cancel_is_401(self):
        self.assertEqual(self.client.post(self.cancel_url).status_code, 401)

    # ── wrong family → 404 (no existence oracle), booking untouched ───
    def test_other_guardian_detail_is_404(self):
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.get(self.detail_url).status_code, 404)

    def test_other_guardian_cannot_cancel(self):
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.post(self.cancel_url).status_code, 404)
        self.booking.refresh_from_db()
        self.assertNotEqual(self.booking.status, Booking.Status.CANCELLED)

    # ── owner → 200 ──────────────────────────────────────────────────
    def test_owner_can_read_and_cancel(self):
        self.client.force_authenticate(user=self.owner)
        detail = self.client.get(self.detail_url)
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertEqual(detail.data['parent_email'], 'owner@example.com')

        cancel = self.client.post(self.cancel_url)
        self.assertEqual(cancel.status_code, 200, cancel.data)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)

    # ── staff/admin → 200 on any booking ─────────────────────────────
    def test_admin_can_read_any_booking(self):
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.client.get(self.detail_url).status_code, 200)


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


class BookingTimeGuardTests(TestCase):
    """The past-slot guard compares the slot's LOCAL start datetime to now —
    not just the date, and not the UTC date (America/Mexico_City is UTC-6)."""

    def _slot_at(self, start_dt, capacity=5):
        end_dt = start_dt + timedelta(minutes=30)
        return AvailabilitySlot.objects.create(
            visit_type=AvailabilitySlot._meta.get_field('visit_type').default,
            date=start_dt.date(),
            start_time=start_dt.time().replace(microsecond=0),
            end_time=end_dt.time().replace(microsecond=0),
            capacity=capacity, location='Campus')

    def test_elapsed_slot_is_rejected(self):
        from .services import SlotUnavailable, create_booking
        slot = self._slot_at(timezone.localtime() - timedelta(minutes=1))
        with self.assertRaises(SlotUnavailable):
            create_booking(slot_id=slot.id, parent_name='Ana', parent_email='a@x.mx')

    def test_future_slot_is_bookable(self):
        from .services import create_booking
        slot = self._slot_at(timezone.localtime() + timedelta(hours=1))
        booking = create_booking(slot_id=slot.id, parent_name='Ana',
                                 parent_email='a@x.mx')
        self.assertEqual(booking.status, Booking.Status.CONFIRMED)


class OpenSchoolSignupTests(APITestCase):
    """The public open-school signup route shares the booking-create rate limit
    and only accepts open_class slots (finding: it bypassed both)."""

    def _slot(self, visit_type=None, capacity=100):
        from .models import VisitType
        start = timezone.localtime() + timedelta(days=2)
        return AvailabilitySlot.objects.create(
            visit_type=visit_type or VisitType.OPEN_CLASS, date=start.date(),
            start_time='10:00', end_time='11:00', capacity=capacity, location='Campus')

    def test_signup_rejects_non_open_class_slot(self):
        from .models import VisitType
        slot = self._slot(visit_type=VisitType.INDIVIDUAL, capacity=1)
        resp = self.client.post(reverse('open-school-signup'),
                                {'slot': slot.id, 'name': 'X', 'email': 'x@x.mx', 'phone': '5'})
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertFalse(Booking.objects.filter(slot=slot).exists())

    @override_settings(RATELIMIT_ENABLE=True)
    def test_signup_is_rate_limited(self):
        from django.core.cache import cache
        cache.clear()
        slot = self._slot(capacity=100)
        codes = [self.client.post(
            reverse('open-school-signup'),
            {'slot': slot.id, 'name': f'P{i}', 'email': f'p{i}@x.mx', 'phone': '5'},
        ).status_code for i in range(12)]
        self.assertIn(429, codes)                 # the shared limit engaged
        self.assertEqual(codes[:10], [201] * 10)  # first 10 allowed


class SlotGeneratorWeekdayTests(APITestCase):
    """The day-picker sends JS getDay() values (Sun=0, Mon=1 … Sat=6); the
    generator must land slots on the selected day, not Python's weekday()+1."""

    def test_slots_land_on_the_selected_js_weekday(self):
        from datetime import date, timedelta
        from apps.accounts.models import User
        admin = User.objects.create_user(
            email='wdadmin@x.mx', password='x', first_name='A', last_name='D',
            role=User.Role.ADMIN, is_staff=True)
        self.client.force_authenticate(admin)
        start = date(2026, 7, 20)  # a Monday
        resp = self.client.post(reverse('bookings-availability'), {
            'visit_type': 'individual',
            'start_date': start.isoformat(),
            'end_date': (start + timedelta(days=6)).isoformat(),
            'weekdays': [1],  # JS Monday
            'window_start': '09:00', 'window_end': '10:00',
            'interval_minutes': 30, 'capacity': 1, 'location': 'Campus',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        py_weekdays = {s.date.weekday() for s in AvailabilitySlot.objects.all()}
        # Every generated slot must fall on Monday (python weekday()==0).
        self.assertEqual(py_weekdays, {0})
