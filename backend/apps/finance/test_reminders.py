"""Cron tuition dunning: ``send_payment_reminders`` windows + idempotency."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.finance import services
from apps.finance.models import FeeSchedule, Invoice
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db

PERIOD = "2026-08"


def _schedule():
    return FeeSchedule.objects.create(
        name="Primaria", grade="", monthly_amount=Decimal("2500.00"),
        due_day=15, late_fee_type=FeeSchedule.LateFeeType.FIXED,
        late_fee_amount=Decimal("100"), late_fee_grace_days=0, active=True,
    )


def _invoice(*, due_offset_days: int, status=Invoice.Status.PENDING, parents=True):
    _schedule()
    parent = ParentFactory() if parents else None
    student = StudentProfileFactory(parents=[parent] if parent else [])
    services.generate_invoices(PERIOD)
    inv = Invoice.objects.get(student=student, period=PERIOD)
    inv.due_date = timezone.localdate() + timedelta(days=due_offset_days)
    inv.status = status
    inv.save(update_fields=["due_date", "status", "updated_at"])
    return inv, student


class TestSendPaymentReminders:
    def test_pre_due_window_notifies_once(self, settings):
        settings.TUITION_REMINDER_BEFORE_DAYS = 3
        settings.TUITION_REMINDER_OVERDUE_DAYS = 1
        inv, student = _invoice(due_offset_days=2)

        first = services.send_payment_reminders()
        assert first == {"before": 1, "overdue": 0}
        inv.refresh_from_db()
        assert inv.reminder_before_sent_at is not None
        guardian = student.parents.first()
        assert guardian is not None
        assert Notification.objects.filter(
            user=guardian,
            notif_type=Notification.NotifType.PAYMENT,
            title__icontains="Recordatorio",
        ).exists()

        second = services.send_payment_reminders()
        assert second == {"before": 0, "overdue": 0}

    def test_overdue_window_notifies_once(self, settings):
        settings.TUITION_REMINDER_BEFORE_DAYS = 3
        settings.TUITION_REMINDER_OVERDUE_DAYS = 1
        inv, _ = _invoice(due_offset_days=-3, status=Invoice.Status.OVERDUE)

        first = services.send_payment_reminders()
        assert first == {"before": 0, "overdue": 1}
        inv.refresh_from_db()
        assert inv.reminder_overdue_sent_at is not None

        second = services.send_payment_reminders()
        assert second == {"before": 0, "overdue": 0}

    def test_outside_windows_is_noop(self, settings):
        settings.TUITION_REMINDER_BEFORE_DAYS = 3
        settings.TUITION_REMINDER_OVERDUE_DAYS = 1
        # Due in 10 days — outside pre-due window.
        _invoice(due_offset_days=10)
        assert services.send_payment_reminders() == {"before": 0, "overdue": 0}

    def test_settled_and_cancelled_are_skipped(self, settings):
        settings.TUITION_REMINDER_BEFORE_DAYS = 3
        settings.TUITION_REMINDER_OVERDUE_DAYS = 1
        paid, _ = _invoice(due_offset_days=1)
        services.mark_invoice_paid(paid)
        cancelled, _ = _invoice(due_offset_days=1)
        cancelled.status = Invoice.Status.CANCELLED
        cancelled.save(update_fields=["status", "updated_at"])

        assert services.send_payment_reminders() == {"before": 0, "overdue": 0}
        paid.refresh_from_db()
        cancelled.refresh_from_db()
        assert paid.reminder_before_sent_at is None
        assert cancelled.reminder_before_sent_at is None
