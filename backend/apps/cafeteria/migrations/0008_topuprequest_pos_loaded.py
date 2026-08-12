# Generated manually for online top-up POS load queue.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('cafeteria', '0007_alter_balanceadjustment_student_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='topuprequest',
            name='pos_loaded_at',
            field=models.DateTimeField(
                blank=True,
                help_text='When staff loaded this online top-up into Loyverse POS.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='topuprequest',
            name='pos_loaded_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='pos_loaded_topups',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name='topuprequest',
            index=models.Index(
                fields=['method', 'status', 'pos_loaded_at'],
                name='cafeteria_topup_pos_queue',
            ),
        ),
    ]
