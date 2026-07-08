"""
send_payment_reminders — remind parents before due and after an invoice is overdue.

cPanel cron target (daily). Each reminder is deduped per invoice, so running daily
never spams. Windows come from ``TUITION_REMINDER_BEFORE_DAYS`` /
``TUITION_REMINDER_OVERDUE_DAYS``. Delivers via email + in-app (and WhatsApp intent).
"""
from django.core.management.base import BaseCommand

from apps.finance.services import send_payment_reminders


class Command(BaseCommand):
    help = 'Send pre-due and overdue tuition payment reminders (deduped per invoice).'

    def handle(self, *args, **options):
        result = send_payment_reminders()
        self.stdout.write(self.style.SUCCESS(
            f"send_payment_reminders: {result['before']} pre-due reminder(s), "
            f"{result['overdue']} overdue reminder(s) sent."
        ))
