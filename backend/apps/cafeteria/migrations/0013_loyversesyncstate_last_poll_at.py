from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('cafeteria', '0012_loyversesyncstate_last_webhook')]
    operations = [
        migrations.AddField(model_name='loyversesyncstate', name='last_poll_at',
                            field=models.DateTimeField(blank=True, null=True, verbose_name='Último sondeo')),
    ]
