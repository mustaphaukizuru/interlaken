"""Staff notice for paid top-ups already in Loyverse but not verified (2026-11-18).

Two nullable/defaulted columns on ``TopUpRequest``: no data migration, no table
rewrite on PostgreSQL (a constant default is stored in the catalog).
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cafeteria', '0021_low_balance_threshold_20'),
    ]

    operations = [
        migrations.AddField(
            model_name='topuprequest',
            name='verify_alert_at',
            field=models.DateTimeField(
                blank=True, null=True,
                help_text='Last staff notice that this top-up is in Loyverse but not verified.'),
        ),
        migrations.AddField(
            model_name='topuprequest',
            name='verify_alert_count',
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
