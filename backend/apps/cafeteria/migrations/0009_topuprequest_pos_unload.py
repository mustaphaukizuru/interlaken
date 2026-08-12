# Generated manually for Loyverse POS unload queue after refund/chargeback.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('cafeteria', '0008_topuprequest_pos_loaded'),
    ]

    operations = [
        migrations.AddField(
            model_name='topuprequest',
            name='pos_unload_needed_at',
            field=models.DateTimeField(
                blank=True,
                help_text='When a refund required staff to remove this credit from Loyverse POS.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='topuprequest',
            name='pos_unloaded_at',
            field=models.DateTimeField(
                blank=True,
                help_text='When staff removed this refunded top-up from Loyverse POS.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='topuprequest',
            name='pos_unloaded_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='pos_unloaded_topups',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name='topuprequest',
            index=models.Index(
                fields=['pos_unload_needed_at', 'pos_unloaded_at'],
                name='cafeteria_topup_pos_unload',
            ),
        ),
    ]
