"""
low_balance_alerts — notify parents whose child's cafeteria balance is low.

Scheduled by deploy/crontab.example (daily).

Dedup: an alert is (re)sent only when the balance is low AND we haven't alerted
within ``CAFETERIA_LOW_BALANCE_ALERT_COOLDOWN_DAYS`` (default 7). When a balance
recovers above its threshold the marker is cleared, so the next drop re-alerts.

No alert while paid card top-ups on their way (``services.pending_paid_totals``)
would bring the balance to the threshold or above: the family already paid
(2026-11-18 incident). Such a wallet is not stamped, so it is alerted on a
later run if that money never arrives.
"""
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import F
from django.utils import timezone

from apps.accounts.family import family_notify_recipients
from apps.cafeteria.models import CafeteriaBalance
from apps.portal.models import Notification
from apps.portal.services import copy_to_family, notify


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

        # Only wallets at/below their threshold AND in use (a movement in the
        # last 30 days), the same rule as the dashboard and the Saldo bajo tab:
        # a child who never buys at the cafetería must not get a weekly nag
        # about an empty wallet, and a leaver's family must not get one at all.
        from apps.cafeteria.schedule import format_amount
        from apps.cafeteria.services import (
            family_cafeteria_path,
            low_balance_queryset,
            pending_covers_low_balance,
            pending_paid_totals,
        )
        balances = list(low_balance_queryset().select_related('student__user'))
        # Paid card top-ups on their way (one query for the whole list): a
        # family that already paid enough is not told «Saldo bajo».
        pending = pending_paid_totals([cb.student_id for cb in balances]) if balances else {}
        skipped_pending = 0
        for cb in balances:
            recently_alerted = (
                cb.last_low_balance_alert_at is not None
                and cb.last_low_balance_alert_at > cutoff
            )
            if recently_alerted and not force:
                continue
            if pending_covers_low_balance(cb, pending.get(cb.student_id, Decimal('0'))):
                # Not stamped: if that money never arrives, the next run alerts.
                skipped_pending += 1
                continue

            student = cb.student
            title = 'Saldo bajo en cafetería'
            message = (
                f'El saldo de cafetería de {student.user.full_name} es de '
                f'{format_amount(cb.balance)}, por debajo del mínimo de '
                f'{format_amount(cb.low_balance_threshold)}. Le recomendamos recargar para '
                f'evitar contratiempos a la hora del almuerzo.'
            )

            sent_to_someone = False
            for parent in family_notify_recipients(student):
                use_wa = bool(getattr(parent, 'whatsapp', '') or '')
                # An urgent alert (WARNING): sent whatever the family muted, as
                # the Avisos tab promises for «saldo muy bajo».
                notify(parent, Notification.NotifType.WARNING, title, message,
                       whatsapp=use_wa, fanout=False, tone='warning',
                       url=family_cafeteria_path(student),
                       cta_label='Recargar saldo')
                notified_parents += 1
                sent_to_someone = True

            # Any other account of the child's family sees it in the bell (no extra email).
            copy_to_family(student, Notification.NotifType.WARNING, title, message)

            if sent_to_someone:
                alerted_students += 1

            cb.last_low_balance_alert_at = now
            cb.save(update_fields=['last_low_balance_alert_at'])

        self.stdout.write(self.style.SUCCESS(
            f'Low-balance alerts: {alerted_students} student(s) below threshold, '
            f'{notified_parents} parent notification(s) sent, '
            f'{skipped_pending} skipped (paid top-up on its way), '
            f'{cleared} recovered marker(s) cleared.'
        ))
