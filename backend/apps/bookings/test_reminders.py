"""
Day-before visit reminders (send_booking_reminders command + service).
"""
from datetime import date, time, timedelta

import pytest
from django.core import mail
from django.core.management import call_command
from django.utils import timezone

from apps.bookings.models import AvailabilitySlot, Booking, VisitType

pytestmark = pytest.mark.django_db


def _slot(on, hour=9):
    return AvailabilitySlot.objects.create(
        visit_type=VisitType.INDIVIDUAL, title='Visita', date=on,
        start_time=time(hour, 0), end_time=time(hour, 30), capacity=5,
        location='Campus Interlaken')


def _booking(on, hour=9, **kw):
    """A booking on ``on`` at ``hour`` (distinct hours avoid the slot
    unique_together clash when several land on the same day)."""
    defaults = dict(parent_name='Ana', parent_email='ana@example.com',
                    num_attendees=1, status=Booking.Status.CONFIRMED)
    defaults.update(kw)
    return Booking.objects.create(slot=_slot(on, hour), **defaults)


class TestReminderCommand:
    def test_reminds_only_tomorrow_active_bookings(self):
        tomorrow = timezone.localdate() + timedelta(days=1)
        today = timezone.localdate()
        next_week = today + timedelta(days=7)

        b_tomorrow = _booking(tomorrow, hour=9)
        _booking(today, hour=9)                                    # today — not reminded
        _booking(next_week, hour=9)                               # future — not reminded
        _booking(tomorrow, hour=11, status=Booking.Status.CANCELLED)  # cancelled — skip

        call_command('send_booking_reminders')

        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == ['ana@example.com']
        assert 'mañana' in mail.outbox[0].subject.lower() or \
               'mañana' in mail.outbox[0].body.lower()
        # .ics attached
        assert mail.outbox[0].attachments[0][0] == 'visita-interlaken.ics'
        b_tomorrow.refresh_from_db()
        assert b_tomorrow.reminder_sent is True

    def test_idempotent_no_double_send(self):
        tomorrow = timezone.localdate() + timedelta(days=1)
        _booking(tomorrow)

        call_command('send_booking_reminders')
        assert len(mail.outbox) == 1
        # Second run must send nothing (reminder_sent guards it).
        call_command('send_booking_reminders')
        assert len(mail.outbox) == 1

    def test_dry_run_sends_nothing(self):
        tomorrow = timezone.localdate() + timedelta(days=1)
        b = _booking(tomorrow)
        call_command('send_booking_reminders', '--dry-run')
        assert len(mail.outbox) == 0
        b.refresh_from_db()
        assert b.reminder_sent is False

    def test_explicit_date(self):
        target = date(2026, 12, 15)
        _booking(target)
        call_command('send_booking_reminders', '--date', '2026-12-15')
        assert len(mail.outbox) == 1
