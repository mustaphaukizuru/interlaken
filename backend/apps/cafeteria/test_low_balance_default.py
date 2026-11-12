"""Low-balance alert level is $20 by default (owner, 2026-11-12).

A family is warned once the wallet reaches $20 or less, so exactly $20.00
already counts as low and $20.01 does not.
"""
import importlib
from decimal import Decimal

import pytest
from django.apps import apps as django_apps

from apps.accounts.factories import StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance

pytestmark = pytest.mark.django_db


def test_new_wallet_starts_at_20():
    cb = CafeteriaBalance.objects.create(student=StudentProfileFactory(), balance=Decimal("100"))
    cb.refresh_from_db()
    assert cb.low_balance_threshold == Decimal("20.00")


@pytest.mark.parametrize(
    ("balance", "low"),
    [("20.01", False), ("20.00", True), ("19.99", True), ("0", True)],
)
def test_alert_fires_when_balance_reaches_20(balance, low):
    cb = CafeteriaBalance.objects.create(student=StudentProfileFactory(), balance=Decimal(balance))
    assert cb.is_low_balance is low


def test_migration_moves_only_wallets_on_the_old_50():
    old_default = CafeteriaBalance.objects.create(
        student=StudentProfileFactory(), balance=Decimal("100"), low_balance_threshold=Decimal("50"))
    family_set = CafeteriaBalance.objects.create(
        student=StudentProfileFactory(), balance=Decimal("100"), low_balance_threshold=Decimal("100"))

    migration = importlib.import_module("apps.cafeteria.migrations.0021_low_balance_threshold_20")
    migration.lower_default_wallets(django_apps, None)

    old_default.refresh_from_db()
    family_set.refresh_from_db()
    assert old_default.low_balance_threshold == Decimal("20.00")
    assert family_set.low_balance_threshold == Decimal("100.00")
