"""
find_orphan_payments — REPORT-ONLY audit of stuck PENDING payments.

An "orphan" is a Payment that was created for a checkout that never produced a
usable hosted-page URL, so the parent could never pay and no webhook will ever
finalise it. The hosted-page URL is not persisted on the model, so we approximate
an orphan as: status == PENDING and no gateway transaction id was ever recorded
(the payment never advanced past creation).

This command NEVER mutates a payment — money records are only reported. Use it to
find rows left behind before the create_checkout hardening, then reconcile by hand.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.payments.models import Payment


class Command(BaseCommand):
    help = 'Report (never mutate) PENDING payments that appear orphaned (no checkout advanced).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--older-than-minutes', type=int, default=0,
            help='Only report payments created at least N minutes ago (default 0 = all).',
        )

    def handle(self, *args, **options):
        cutoff_minutes = options['older_than_minutes']
        qs = Payment.objects.filter(
            status=Payment.Status.PENDING,
        ).filter(
            # never got a gateway tx id → never advanced past creation
            gateway_tx_id__isnull=True,
        ) | Payment.objects.filter(
            status=Payment.Status.PENDING, gateway_tx_id='',
        )
        qs = qs.distinct().order_by('created_at')

        if cutoff_minutes > 0:
            cutoff = timezone.now() - timedelta(minutes=cutoff_minutes)
            qs = qs.filter(created_at__lte=cutoff)

        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.SUCCESS('No orphan PENDING payments found.'))
            return

        self.stdout.write(self.style.WARNING(
            f'{total} orphan PENDING payment(s) found (REPORT ONLY — nothing was changed):'
        ))
        for p in qs:
            err = ''
            if isinstance(p.gateway_raw, dict) and p.gateway_raw.get('error'):
                err = f" error={p.gateway_raw['error']!r}"
            self.stdout.write(
                f'  id={p.id} user={p.user_id} type={p.payment_type} '
                f'amount={p.amount} {p.currency} gateway={p.gateway} '
                f'created={p.created_at:%Y-%m-%d %H:%M}{err}'
            )
        self.stdout.write(
            'Review these manually; this command does not modify money records.'
        )
