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


def _fold(line: str) -> str:
    """Fold a content line to ≤75 octets per RFC 5545 §3.1.

    Long lines (a long parent name / location easily pushes DESCRIPTION past
    75) are split with CRLF + a single leading space; continuation lines carry
    that space so their own payload budget is 74 octets. Splits fall on
    character boundaries so a multi-byte UTF-8 char (é, ñ) is never cut in half.
    """
    if len(line.encode('utf-8')) <= 75:
        return line
    chunks, current = [], b''
    for ch in line:
        ch_bytes = ch.encode('utf-8')
        budget = 75 if not chunks else 74  # continuations lose 1 octet to space
        if current and len(current) + len(ch_bytes) > budget:
            chunks.append(current)
            current = ch_bytes
        else:
            current += ch_bytes
    chunks.append(current)
    first = chunks[0].decode('utf-8')
    rest = (' ' + c.decode('utf-8') for c in chunks[1:])
    return '\r\n'.join([first, *rest])


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
    # iCalendar requires CRLF line breaks, and each content line folded to
    # ≤75 octets (RFC 5545 §3.1) — short lines pass through _fold unchanged.
    return '\r\n'.join(_fold(line) for line in lines) + '\r\n'
