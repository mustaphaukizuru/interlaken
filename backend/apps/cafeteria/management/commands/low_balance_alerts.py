"""
low_balance_alerts — notify parents whose child's cafeteria balance is low.

Scheduled by .github/workflows/scheduled-tasks.yml (daily).

Dedup: an alert is (re)sent only when the balance is low AND we haven't alerted
within ``CAFETERIA_LOW_BALANCE_ALERT_COOLDOWN_DAYS`` (default 7). When a balance
recovers above its threshold the marker is cleared, so the next drop re-alerts.
"""
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import F
from django.utils import timezone

from apps.accounts.family import family_notify_recipients
from apps.cafeteria.models import CafeteriaBalance
from apps.portal.models import Notification
from apps.portal.services import notify


class Command(BaseCommand):
    help = 'Notify parents of students whose cafeteria balance is below threshold.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force', action='store_true',
            help='Ignore the cooldown and re-alert every currently-low student.',
        )

    def handle(self, *args, **options):
        cooldown_days = getattr(settings, 'CAFETERIA_LOW_BALANCE_ALERT_COOLDOWN_DAYS', 7)
        now = timezone.now()
        cutoff = now - timedelta(days=cooldown_days)
        force = options['force']

        alerted_students = 0
        notified_parents = 0

        # Recovered balances: clear the dedup marker in ONE UPDATE so a future
        # drop re-alerts (was a per-row Python check + save over the full roster).
        cleared = (CafeteriaBalance.objects
                   .filter(balance__gt=F('low_balance_threshold'),
                           last_low_balance_alert_at__isnull=False)
                   .update(last_low_balance_alert_at=None))

        # Only rows at/below their own threshold — the same SQL filter
        # AdminLowBalanceView uses — instead of scanning every balance.
        balances = (CafeteriaBalance.objects
                    .select_related('student__user')
                    .filter(balance__lte=F('low_balance_threshold')))
        for cb in balances:
            recently_alerted = (
                cb.last_low_balance_alert_at is not None
                and cb.last_low_balance_alert_at > cutoff
            )
            if recently_alerted and not force:
                continue

            student = cb.student
            title = 'Saldo bajo en cafetería'
            message = (
                f'El saldo de cafetería de {student.user.full_name} es de '
                f'${cb.balance:.2f}, por debajo del mínimo de '
                f'${cb.low_balance_threshold:.2f}. Le recomendamos recargar para '
                f'evitar contratiempos a la hora del almuerzo.'
            )

            sent_to_someone = False
            for parent in family_notify_recipients(student):
                use_wa = bool(getattr(parent, 'whatsapp', '') or '')
                notify(parent, Notification.NotifType.CAFETERIA, title, message,
                       whatsapp=use_wa)
                notified_parents += 1
                sent_to_someone = True

            if sent_to_someone:
                alerted_students += 1

            cb.last_low_balance_alert_at = now
            cb.save(update_fields=['last_low_balance_alert_at'])

        self.stdout.write(self.style.SUCCESS(
            f'Low-balance alerts: {alerted_students} student(s) below threshold, '
            f'{notified_parents} parent notification(s) sent, '
            f'{cleared} recovered marker(s) cleared.'
        ))
