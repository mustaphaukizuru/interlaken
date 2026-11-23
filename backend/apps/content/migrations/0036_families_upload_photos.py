"""SiteSettings.families_upload_photos (2026-11-22): «Las familias pueden subir
la foto de la credencial». Off by default: a school decision (photos of minors)."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0035_automatic_years'),
    ]

    operations = [
        migrations.AddField(
            model_name='sitesettings',
            name='families_upload_photos',
            field=models.BooleanField(default=False, verbose_name='Las familias pueden subir la foto de la credencial'),
        ),
    ]
