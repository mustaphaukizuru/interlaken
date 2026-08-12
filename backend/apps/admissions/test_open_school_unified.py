"""Public Puertas Abiertas routes use bookings.AvailabilitySlot (open_class),
not the retired admissions.OpenSchoolDay table."""
from datetime import timedelta

import pytest
from django.apps import apps
from django.urls import reverse
from django.utils import timezone

from apps.bookings.models import AvailabilitySlot, Booking, VisitType


@pytest.mark.django_db
class TestOpenSchoolDayRetired:
    def test_openschoolday_model_is_gone(self):
        with pytest.raises(LookupError):
            apps.get_model('admissions', 'OpenSchoolDay')


@pytest.mark.django_db
class TestOpenSchoolListAndSignup:
    url_list = reverse('open-school-list')
    url_signup = reverse('open-school-signup')

    def _slot(self, **kwargs):
        start = timezone.localtime() + timedelta(days=3)
        defaults = dict(
            visit_type=VisitType.OPEN_CLASS,
            date=start.date(),
            start_time='10:00',
            end_time='12:00',
            capacity=30,
            title='Puertas Abiertas',
            location='Campus Interlaken',
            is_active=True,
        )
        defaults.update(kwargs)
        return AvailabilitySlot.objects.create(**defaults)

    def test_list_returns_open_class_event_shape(self, api_client):
        slot = self._slot()
        resp = api_client.get(self.url_list)
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        row = rows[0]
        assert row['id'] == slot.id
        assert row['title'] == 'Puertas Abiertas'
        assert row['location'] == 'Campus Interlaken'
        assert row['spots_remaining'] == 30
        assert row['is_active'] is True
        assert 'date' in row

    def test_list_omits_individual_slots(self, api_client):
        self._slot(visit_type=VisitType.INDIVIDUAL, capacity=1, title='')
        resp = api_client.get(self.url_list)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_signup_legacy_payload_creates_booking(self, api_client):
        slot = self._slot()
        resp = api_client.post(self.url_signup, {
            'event': slot.id,
            'name': 'María López',
            'email': 'maria@test.mx',
            'phone': '5551234567',
            'children_count': 2,
        }, format='json')
        assert resp.status_code == 201, resp.content
        booking = Booking.objects.get()
        assert booking.slot_id == slot.id
        assert booking.parent_name == 'María López'
        assert booking.parent_email == 'maria@test.mx'
        assert booking.num_attendees == 2
        assert booking.status == Booking.Status.CONFIRMED
