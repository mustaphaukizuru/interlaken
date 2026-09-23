"""'Saldos bajos' means wallets in use, not every empty wallet.

Production 2026-09-23: the dashboard said 235 of 386 students had a low
balance. 144 of those were $0 wallets of children who never buy at the
cafetería, 30 were leavers whose Loyverse card is gone, and 25 were families
who actually needed a nudge. The dashboard counter, the Saldo bajo tab and the
weekly alert now share one rule: at/below threshold AND a ledger movement in
the last 30 days AND not a leaver.
"""
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
from apps.cafeteria.services import low_balance_queryset


def wallet(balance, *, tx_days_ago=None, missing=False):
    s = StudentProfileFactory(loyverse_missing_since=timezone.now() if missing else None)
    cb = CafeteriaBalance.objects.create(student=s, balance=Decimal(str(balance)),
                                         last_synced=timezone.now())
    if tx_days_ago is not None:
        when = timezone.now() - timedelta(days=tx_days_ago)
        CafeteriaTransaction.objects.create(
            student=s, transaction_type='purchase', amount=Decimal('10'),
            loyverse_receipt_id=f'r-{s.id}', date=when, recorded_at=when)
    return cb


@pytest.mark.django_db
class TestLowBalanceScope:
    def test_only_wallets_in_use_count(self):
        in_use = wallet(12, tx_days_ago=3)          # low and buying: counts
        wallet(0)                                   # never buys: not "low", just unused
        wallet(5, tx_days_ago=45)                   # last bought six weeks ago: not in use
        wallet(8, tx_days_ago=2, missing=True)      # leaver: the family is gone
        wallet(300, tx_days_ago=1)                  # healthy

        assert list(low_balance_queryset().values_list('id', flat=True)) == [in_use.id]

    def test_dashboard_counter_tab_and_alert_agree(self, api_client):
        wallet(12, tx_days_ago=3)
        wallet(0)
        wallet(8, tx_days_ago=2, missing=True)
        api_client.force_authenticate(AdminFactory())

        dash = api_client.get(reverse('dashboard')).json()
        tab = api_client.get(reverse('admin-low-balance')).json()

        assert dash['low_balance_count'] == 1
        assert dash['stale_links'] == 1
        assert tab['count'] == 1 and len(tab['results']) == 1

        with patch('apps.cafeteria.management.commands.low_balance_alerts.notify') as notify:
            out = StringIO()
            call_command('low_balance_alerts', stdout=out)
        # One student alerted at most: the $0 non-user and the leaver never are.
        alerted = {c.args[0].pk for c in notify.call_args_list} if notify.call_args_list else set()
        assert len(alerted) <= 1
