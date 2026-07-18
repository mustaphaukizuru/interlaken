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


def _long_booking():
    slot = AvailabilitySlot.objects.create(
        visit_type=VisitType.INDIVIDUAL, title='Visita', date=date(2026, 7, 20),
        start_time=time(9, 0), end_time=time(9, 30), capacity=5,
        location='Campus Interlaken Sur, Avenida de los Educadores 1234, '
                 'Colonia Benito Juárez, Ciudad de México')
    return Booking.objects.create(
        slot=slot, num_attendees=2, parent_email='ana@example.com',
        parent_name='María José de la Concepción Fernández Ñoño Güemez Iturbide')


def _unfold(ics: str) -> str:
    """Reverse RFC 5545 folding (CRLF + a single leading space/tab)."""
    return ics.replace('\r\n ', '').replace('\r\n\t', '')


class TestFolding:
    def test_no_content_line_exceeds_75_octets(self):
        ics = build_ics(_long_booking())
        for ln in ics.split('\r\n'):
            assert len(ln.encode('utf-8')) <= 75, f'over-length line: {ln!r}'

    def test_folding_is_reversible_and_keeps_accents_intact(self):
        # Unfolding must reconstruct the logical value with no multi-byte char
        # cut across the 75-octet boundary.
        unfolded = _unfold(build_ics(_long_booking()))
        assert ('María José de la Concepción Fernández Ñoño Güemez Iturbide'
                in unfolded)
        assert 'Ciudad de México' in unfolded


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
