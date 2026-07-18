"""
.ics calendar invite on booking confirmations (IK-BOOK).
"""
from datetime import date, time

import pytest
from django.core import mail

from apps.bookings.models import AvailabilitySlot, Booking, VisitType
from apps.bookings.services.ics import build_ics
from apps.bookings.services.notifications import send_booking_confirmation

pytestmark = pytest.mark.django_db


def _booking():
    slot = AvailabilitySlot.objects.create(
        visit_type=VisitType.INDIVIDUAL, title='Visita', date=date(2026, 7, 20),
        start_time=time(9, 0), end_time=time(9, 30), capacity=5,
        location='Campus Interlaken')
    return Booking.objects.create(
        slot=slot, parent_name='Ana Pérez; Familia', parent_email='ana@example.com',
        num_attendees=2)


class TestBuildIcs:
    def test_valid_vevent(self):
        ics = build_ics(_booking())
        assert ics.startswith('BEGIN:VCALENDAR')
        assert 'BEGIN:VEVENT' in ics and 'END:VEVENT' in ics
        assert ics.rstrip().endswith('END:VCALENDAR')
        # CRLF line endings (RFC 5545).
        assert '\r\n' in ics

    def test_local_time_converted_to_utc(self):
        # 09:00 America/Mexico_City (UTC-6) → 15:00Z.
        ics = build_ics(_booking())
        assert 'DTSTART:20260720T150000Z' in ics
        assert 'DTEND:20260720T153000Z' in ics

    def test_text_fields_are_escaped(self):
        ics = build_ics(_booking())
        # The ';' in the parent name must be escaped in DESCRIPTION.
        desc = [ln for ln in ics.splitlines() if ln.startswith('DESCRIPTION:')][0]
        assert 'Ana Pérez\\; Familia' in desc

    def test_uid_is_stable_per_booking(self):
        b = _booking()
        assert f'UID:booking-{b.pk}@interlaken.edu.mx' in build_ics(b)


class TestConfirmationEmail:
    def test_email_has_ics_attachment(self):
        b = _booking()
        send_booking_confirmation(b)

        assert len(mail.outbox) == 1
        msg = mail.outbox[0]
        assert msg.to == ['ana@example.com']
        assert len(msg.attachments) == 1
        name, content, mimetype = msg.attachments[0]
        assert name == 'visita-interlaken.ics'
        assert 'text/calendar' in mimetype
        assert 'BEGIN:VCALENDAR' in content
        b.refresh_from_db()
        assert b.confirmation_sent is True
