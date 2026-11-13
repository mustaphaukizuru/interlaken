"""Low-balance alert level: $50 -> $20 (owner, 2026-11-12).

New wallets start at $20. Existing wallets still on the old $50 default move to
$20 as well; a level a family or the staff set to anything else is left alone.
The old default and a deliberate $50 are indistinguishable, so both move.
"""
from decimal import Decimal

from django.db import migrations, models

OLD = Decimal('50.00')
NEW = Decimal('20.00')


def lower_default_wallets(apps, schema_editor):
    CafeteriaBalance = apps.get_model('cafeteria', 'CafeteriaBalance')
    CafeteriaBalance.objects.filter(low_balance_threshold=OLD).update(low_balance_threshold=NEW)


class Migration(migrations.Migration):

    dependencies = [
        ('cafeteria', '0020_topup_scheduled_apply'),
    ]

    operations = [
        migrations.AlterField(
            model_name='cafeteriabalance',
            name='low_balance_threshold',
            field=models.DecimalField(decimal_places=2, default=20, max_digits=8),
        ),
        # Not reversible on purpose: after the update a wallet that was moved
        # cannot be told apart from one somebody set to $20 by hand.
        migrations.RunPython(lower_default_wallets, migrations.RunPython.noop),
    ]
