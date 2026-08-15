"""
GET /api/v1/bookings/admin/bookings/export/ — visits CSV (Admin console v2):
UTF-8 BOM for Excel, es-MX headers, respects the list filters, admin-only.
"""
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from .models import AvailabilitySlot, Booking

pytestmark = pytest.mark.django_db


@pytest.fixture
def bookings(db):
    slot_ind = AvailabilitySlot.objects.create(
        visit_type='individual',
        date=timezone.now().date() + timedelta(days=3),
        start_time='09:00', end_time='09:30', capacity=1, location='Campus',
    )
    slot_open = AvailabilitySlot.objects.create(
        visit_type='open_class', title='Puertas Abiertas',
        date=timezone.now().date() + timedelta(days=5),
        start_time='09:00', end_time='11:00', capacity=30, location='Campus',
    )
    ind = Booking.objects.create(
        slot=slot_ind, parent_name='Ana Tutor', parent_email='ana@example.com',
        parent_phone='5511111111', child_name='Niño Uno', num_attendees=1,
    )
    open_b = Booking.objects.create(
        slot=slot_open, parent_name='Beto Tutor', parent_email='beto@example.com',
        parent_phone='5522222222', num_attendees=2,
    )
    return {'individual': ind, 'open_class': open_b}


class TestBookingsExport:
    def test_csv_has_bom_and_headers(self, admin_client, bookings):
        resp = admin_client.get(reverse('bookings-admin-export'))
        assert resp.status_code == 200
        assert resp['Content-Type'].startswith('text/csv')
        assert 'attachment' in resp['Content-Disposition']
        content = resp.content.decode('utf-8')
        assert content.startswith('﻿')
        assert ('Fecha,Hora,Tipo,Tutor,Correo,Teléfono,'
                'Alumno,Grado de interés,Asistentes,Estado') in content
        assert 'Ana Tutor' in content and 'Beto Tutor' in content

    def test_respects_type_filter(self, admin_client, bookings):
        resp = admin_client.get(reverse('bookings-admin-export'), {'type': 'individual'})
        content = resp.content.decode('utf-8')
        assert 'Ana Tutor' in content
        assert 'Beto Tutor' not in content

    def test_parent_is_403(self, api_client, parent_user, bookings):
        api_client.force_authenticate(user=parent_user)
        assert api_client.get(reverse('bookings-admin-export')).status_code == 403

    def test_anonymous_is_401(self, api_client, bookings):
        assert api_client.get(reverse('bookings-admin-export')).status_code == 401
