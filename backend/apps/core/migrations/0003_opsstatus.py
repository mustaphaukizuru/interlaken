from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0002_auditlog')]
    operations = [
        migrations.CreateModel(
            name='OpsStatus',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('data', models.JSONField(blank=True, default=dict)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'verbose_name': 'Estado operativo', 'verbose_name_plural': 'Estado operativo'},
        ),
    ]
