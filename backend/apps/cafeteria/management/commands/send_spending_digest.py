"""
send_spending_digest — one cafeteria spending summary per family (F15).

Instead of (or alongside) a ping per purchase, this sends each guardian a single
roll-up of their children's cafeteria spend for the period:

    python manage.py send_spending_digest --period daily      # today (default)
    python manage.py send_spending_digest --period weekly     # Mon–now this week

Pairs with ``CAFETERIA_PURCHASE_DIGEST=True`` (which suppresses the per-purchase
alert). With the setting off (production default) families already get one
notice per purchase, so the scheduled run does nothing; ``--force`` sends it
anyway for a deliberate one-off. Families with no spend in the window are
skipped, so quiet days send nothing.
"""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Count, Sum
from django.utils import timezone

from apps.accounts.family import family_notify_recipients
from apps.cafeteria.models import CafeteriaTransaction
from apps.portal.models import Notification
from apps.portal.services import notify


class Command(BaseCommand):
    help = "Send each family a daily/weekly cafeteria spending digest."

    def add_arguments(self, parser):
        parser.add_argument(
            '--period', choices=['daily', 'weekly'], default='daily',
            help='Window to summarise: daily (today) or weekly (Mon–now).',
        )
        parser.add_argument(
            '--force', action='store_true',
            help='Send even when CAFETERIA_PURCHASE_DIGEST is off (families also get per-purchase notices).',
        )

    def handle(self, *args, **options):
        from django.conf import settings

        # With per-purchase notices on (the default) the 18:00 digest repeated
        # every purchase in a second email to every family that bought that day.
        if not getattr(settings, 'CAFETERIA_PURCHASE_DIGEST', False) and not options['force']:
            self.stdout.write('CAFETERIA_PURCHASE_DIGEST is off: per-purchase notices are on, no digest sent.')
            return
        period = options['period']
        now = timezone.localtime()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        if period == 'weekly':
            start = start_of_day - timedelta(days=now.weekday())
            when_es = 'esta semana'
        else:
            start = start_of_day
            when_es = 'hoy'

        # Per-student spend in the window (purchases only).
        rows = (
            CafeteriaTransaction.objects
            .filter(transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                    date__gte=start)
            .values('student')
            .annotate(total=Sum('amount'), count=Count('id'))
        )
        if not rows:
            self.stdout.write(self.style.SUCCESS(
                f'Spending digest ({period}): no purchases in window — nothing to send.'))
            return

        from apps.accounts.models import StudentProfile
        students = {
            s.pk: s for s in StudentProfile.objects.filter(
                pk__in=[r['student'] for r in rows]).select_related('user')
        }
        spend = {r['student']: (r['total'] or Decimal('0'), r['count']) for r in rows}

        # Group children under each guardian so a parent of two kids gets ONE digest.
        # Keyed by guardian pk → {'user', 'lines': [(name, total, count)], 'total'}.
        families: dict[int, dict] = defaultdict(
            lambda: {'user': None, 'lines': [], 'total': Decimal('0')})
        for student_pk, (total, count) in spend.items():
            student = students.get(student_pk)
            if student is None:
                continue
            for parent in family_notify_recipients(student):
                bucket = families[parent.pk]
                bucket['user'] = parent
                bucket['lines'].append((student.user.full_name, total, count))
                bucket['total'] += total

        title = f'Resumen de cafetería ({when_es})'
        sent = 0
        for bucket in families.values():
            parent = bucket['user']
            if parent is None:
                continue
            parts = [
                f'{name}: ${total:.2f} en {count} '
                f'{"compra" if count == 1 else "compras"}'
                for name, total, count in bucket['lines']
            ]
            message = (
                f'Gasto en cafetería {when_es}: ' + '; '.join(parts)
                + f'. Total: ${bucket["total"]:.2f}.'
            )
            use_wa = bool(getattr(parent, 'whatsapp', '') or '')
            notify(parent, Notification.NotifType.CAFETERIA, title, message, fanout=False,
                   whatsapp=use_wa)
            sent += 1

        self.stdout.write(self.style.SUCCESS(
            f'Spending digest ({period}): {len(spend)} student(s) with spend, '
            f'{sent} family digest(s) sent.'))
