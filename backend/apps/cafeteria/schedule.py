"""
cafeteria/schedule.py — when a paid online top-up reaches the wallet.

Since 2026-10-18 an online top-up is credited only once staff have loaded it
into the Loyverse POS (``settings.CAFETERIA_TOPUP_APPLY_MODE = 'scheduled'``,
see ``services.complete_online_topup``). Staff do that load every school day
at ``CAFETERIA_TOPUP_APPLY_TIME`` (07:30), so the family is told the exact
moment: "se aplicará el lunes 20 de octubre a las 7:30 a.m.".

A school day is a weekday that is neither a Mexican statutory holiday (Ley
Federal del Trabajo, art. 74) nor covered by a published, school-wide
"Suspensión de clases" / "Vacaciones" entry of the school calendar
(``content.SchoolEvent``). A level-only entry (only preescolar is off) does
not close the cafetería, so it does not move the load.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.utils import timezone

# How far ahead to look for the next school day (a long vacation is ~3 weeks).
SEARCH_DAYS = 60


def apply_mode() -> str:
    """``'scheduled'`` (default) or ``'instant'``; anything else is scheduled."""
    mode = str(getattr(settings, 'CAFETERIA_TOPUP_APPLY_MODE', 'scheduled') or '').strip().lower()
    return 'instant' if mode == 'instant' else 'scheduled'


def is_scheduled() -> bool:
    return apply_mode() == 'scheduled'


def apply_time() -> time:
    """The daily POS load time; a malformed setting falls back to 07:30."""
    raw = str(getattr(settings, 'CAFETERIA_TOPUP_APPLY_TIME', '07:30') or '').strip()
    try:
        hours, minutes = raw.split(':', 1)
        return time(int(hours), int(minutes))
    except (ValueError, TypeError):
        return time(7, 30)


def cutoff() -> timedelta:
    minutes = getattr(settings, 'CAFETERIA_TOPUP_APPLY_CUTOFF_MINUTES', 30)
    try:
        return timedelta(minutes=max(0, int(minutes)))
    except (TypeError, ValueError):
        return timedelta(minutes=30)


def whatsapp_number() -> str:
    """The school WhatsApp as 10 digits ('' when unset)."""
    digits = ''.join(ch for ch in str(getattr(settings, 'CAFETERIA_TOPUP_WHATSAPP', '') or '')
                     if ch.isdigit())
    return digits[-10:] if len(digits) >= 10 else ''


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """The ``n``-th ``weekday`` (Mon=0) of a month."""
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + 7 * (n - 1))


def statutory_holidays(year: int) -> set[date]:
    """Días de descanso obligatorio (LFT art. 74) that fall on fixed rules."""
    days = {
        date(year, 1, 1),                    # Año Nuevo
        _nth_weekday(year, 2, 0, 1),         # Constitución (primer lunes de febrero)
        _nth_weekday(year, 3, 0, 3),         # Benito Juárez (tercer lunes de marzo)
        date(year, 5, 1),                    # Día del Trabajo
        date(year, 9, 16),                   # Independencia
        _nth_weekday(year, 11, 0, 3),        # Revolución (tercer lunes de noviembre)
        date(year, 12, 25),                  # Navidad
    }
    if (year - 2024) % 6 == 0:
        days.add(date(year, 10, 1))          # Transmisión del Poder Ejecutivo Federal
    return days


def _calendar_closures(start: date, end: date) -> set[date]:
    """School-wide closures from the published school calendar in ``[start, end]``."""
    from django.db.models import Q

    from apps.content.models import SchoolEvent

    closed: set[date] = set()
    events = (SchoolEvent.objects
              .filter(is_published=True, level='',
                      kind__in=[SchoolEvent.Kind.HOLIDAY, SchoolEvent.Kind.VACATION],
                      start_date__lte=end)
              .filter(Q(end_date__gte=start) | Q(end_date__isnull=True, start_date__gte=start))
              .only('start_date', 'end_date'))
    for event in events:
        day = max(event.start_date, start)
        last = min(event.end_date or event.start_date, end)
        while day <= last:
            closed.add(day)
            day += timedelta(days=1)
    return closed


class SchoolDays:
    """School-day lookups over a window, with the calendar read once."""

    def __init__(self, start: date, days: int = SEARCH_DAYS):
        self.start = start
        self.end = start + timedelta(days=days)
        self._closed = _calendar_closures(start, self.end)
        self._holidays: dict[int, set[date]] = {}

    def is_school_day(self, day: date) -> bool:
        if day.weekday() >= 5:
            return False
        if day.year not in self._holidays:
            self._holidays[day.year] = statutory_holidays(day.year)
        if day in self._holidays[day.year]:
            return False
        return day not in self._closed

    def first_on_or_after(self, day: date) -> date:
        probe = day
        while probe <= self.end:
            if self.is_school_day(probe):
                return probe
            probe += timedelta(days=1)
        # Nothing open in the window (a misconfigured calendar): never promise
        # a date further than the window, and never loop forever.
        return probe


def is_school_day(day: date) -> bool:
    return SchoolDays(day, days=0).is_school_day(day)


def next_apply_at(paid_at: datetime | None = None) -> datetime:
    """The POS load that will carry a top-up paid at ``paid_at`` (aware datetime).

    Same morning when it was paid on a school day at least ``cutoff()`` before
    the load time, otherwise the load of the next school day.
    """
    local = timezone.localtime(paid_at or timezone.now())
    days = SchoolDays(local.date())
    load_time = apply_time()
    tz = timezone.get_current_timezone()

    today = local.date()
    if days.is_school_day(today):
        slot = timezone.make_aware(datetime.combine(today, load_time), tz)
        if local <= slot - cutoff():
            return slot
    day = days.first_on_or_after(today + timedelta(days=1))
    return timezone.make_aware(datetime.combine(day, load_time), tz)


_WEEKDAYS = ('lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo')
_MONTHS = ('enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
           'septiembre', 'octubre', 'noviembre', 'diciembre')


def format_amount(value) -> str:
    """``$1,234.50`` (es-MX money for messages)."""
    from decimal import Decimal

    return f'${Decimal(str(value or 0)):,.2f}'


def format_apply_at(when: datetime) -> str:
    """``lunes 20 de octubre a las 7:30 a.m.`` (school time zone)."""
    local = timezone.localtime(when)
    hour = local.hour % 12 or 12
    meridiem = 'a.m.' if local.hour < 12 else 'p.m.'
    return (f'{_WEEKDAYS[local.weekday()]} {local.day} de {_MONTHS[local.month - 1]} '
            f'a las {hour}:{local.minute:02d} {meridiem}')


def whatsapp_display() -> str:
    """``55 5379 1188`` for messages ('' when unset)."""
    number = whatsapp_number()
    return f'{number[:2]} {number[2:6]} {number[6:]}' if number else ''


def policy(now: datetime | None = None) -> dict:
    """What the family top-up form needs to promise before paying."""
    scheduled = is_scheduled()
    return {
        'mode': apply_mode(),
        'apply_time': apply_time().strftime('%H:%M'),
        'whatsapp': whatsapp_number(),
        # When a payment made right now would reach the wallet.
        'next_apply_at': next_apply_at(now).isoformat() if scheduled else None,
    }
