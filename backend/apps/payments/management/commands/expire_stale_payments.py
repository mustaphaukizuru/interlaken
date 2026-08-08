"""
expire_stale_payments — fail open PENDING checkouts older than the TTL.

Parents who abandon an HPP session leave PENDING rows that block reuse and
clutter orphan reports. This command marks those sessions FAILED so a later
initiate can open a fresh checkout. Use --dry-run to report without mutating.
"""
from django.core.management.base import BaseCommand

from apps.payments.services import (
    DEFAULT_OPEN_CHECKOUT_MINUTES,
    expire_stale_checkouts,
    open_checkout_ttl_minutes,
)


class Command(BaseCommand):
    help = 'Mark stale open PENDING payment checkouts as FAILED.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--older-than-minutes', type=int, default=None,
            help=(
                f'Fail PENDING checkouts older than N minutes '
                f'(default: OPEN_CHECKOUT_TTL_MINUTES or {DEFAULT_OPEN_CHECKOUT_MINUTES}).'
            ),
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report how many would be expired without mutating.',
        )

    def handle(self, *args, **options):
        minutes = options['older_than_minutes']
        if minutes is None:
            minutes = open_checkout_ttl_minutes()

        if options['dry_run']:
            from datetime import timedelta

            from django.db.models import Q
            from django.utils import timezone

            from apps.payments.models import Payment

            cutoff = timezone.now() - timedelta(minutes=minutes)
            n = Payment.objects.filter(
                status=Payment.Status.PENDING,
                created_at__lt=cutoff,
            ).filter(
                Q(gateway_tx_id__isnull=True) | Q(gateway_tx_id=''),
            ).count()
            self.stdout.write(
                self.style.WARNING(
                    f'DRY RUN: would expire {n} PENDING checkout(s) older than {minutes}m.'
                )
            )
            return

        n = expire_stale_checkouts(older_than_minutes=minutes)
        self.stdout.write(self.style.SUCCESS(
            f'Expired {n} stale PENDING checkout(s) (older than {minutes}m).'
        ))
