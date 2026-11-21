# Expediente de admisión (Fase 5): editable WhatsApp/email message templates.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0030_sitesettings_admissions_public_start'),
    ]

    operations = [
        migrations.AddField(
            model_name='sitesettings',
            name='tpl_process',
            field=models.JSONField(blank=True, default=dict, verbose_name='Plantillas del proceso de admisión'),
        ),
    ]
