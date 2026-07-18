"""
bookings/services/ics.py — build an iCalendar (.ics) VEVENT for a booking so the
confirmation email carries a one-tap "add to calendar" attachment.

Pure and dependency-free (RFC 5545 text): given a Booking, return the calendar
string. Times are the school's local wall-clock (slot.date + slot.start/end_time)
converted to UTC, which every calendar client understands.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

_UTC = ZoneInfo('UTC')


def _escape(text: str) -> str:
    """Escape a value for an iCalendar TEXT field (RFC 5545 §3.3.11)."""
    return (str(text or '')
            .replace('\\', '\\\\')
            .replace(';', r'\;')
            .replace(',', r'\,')
            .replace('\r\n', r'\n')
            .replace('\n', r'\n'))


def _utc(dt_local: datetime) -> str:
    return dt_local.astimezone(_UTC).strftime('%Y%m%dT%H%M%SZ')


def build_ics(booking) -> str:
    """Return an RFC-5545 VCALENDAR/VEVENT string for ``booking``."""
    slot = booking.slot
    tz = ZoneInfo(getattr(settings, 'TIME_ZONE', 'America/Mexico_City'))
    start = datetime.combine(slot.date, slot.start_time, tzinfo=tz)
    end = datetime.combine(slot.date, slot.end_time, tzinfo=tz)

    summary = f'Visita — Colegio Interlaken ({slot.get_visit_type_display()})'
    location = slot.location or 'Campus Interlaken'
    description = (
        f'Visita agendada para {booking.parent_name}. '
        f'Asistentes: {booking.num_attendees}. '
        f'Si necesita reprogramar, comuníquese con el colegio.'
    )
    uid = f'booking-{booking.pk}@interlaken.edu.mx'

    lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Colegio Interlaken//Visitas//ES',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        f'UID:{uid}',
        f'DTSTAMP:{_utc(timezone.now())}',
        f'DTSTART:{_utc(start)}',
        f'DTEND:{_utc(end)}',
        f'SUMMARY:{_escape(summary)}',
        f'DESCRIPTION:{_escape(description)}',
        f'LOCATION:{_escape(location)}',
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR',
    ]
    # iCalendar requires CRLF line breaks.
    return '\r\n'.join(lines) + '\r\n'
