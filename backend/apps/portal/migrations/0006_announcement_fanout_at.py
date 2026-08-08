# Generated manually for announcement activate fan-out idempotency.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('portal', '0005_notification_delivered_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='announcement',
            name='fanout_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
