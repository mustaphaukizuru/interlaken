"""
Data migration: pone los datos de contacto CONFIRMADOS por el cliente en la
fila existente de SiteSettings — pero solo donde todavía tenga los valores
placeholder originales (o vacío, en el caso de Facebook). Nunca sobrescribe
datos que el colegio ya haya capturado en el admin.
"""
from django.db import migrations

OLD_ADDRESS = 'Tlalnepantla de Baz, Estado de México'
OLD_MAPS = 'https://maps.google.com/?q=Tlalnepantla+de+Baz'

NEW_ADDRESS = 'Av. de los Reyes 67, Residencial el Dorado, Tlalnepantla, Estado de México'
NEW_MAPS = 'https://maps.app.goo.gl/Xd241Sht8TmrMHUe6'
NEW_FACEBOOK = 'https://www.facebook.com/colegiointerlaken'


def apply_real_data(apps, schema_editor):
    SiteSettings = apps.get_model('content', 'SiteSettings')
    for row in SiteSettings.objects.all():
        changed = []
        if row.address in ('', OLD_ADDRESS):
            row.address = NEW_ADDRESS
            changed.append('address')
        if row.maps_url in ('', OLD_MAPS):
            row.maps_url = NEW_MAPS
            changed.append('maps_url')
        if row.facebook_url == '':
            row.facebook_url = NEW_FACEBOOK
            changed.append('facebook_url')
        if changed:
            row.save(update_fields=changed)


def noop(apps, schema_editor):
    pass   # los placeholders no merecen restauración


class Migration(migrations.Migration):
    dependencies = [
        ('content', '0003_alter_sitesettings_address_and_more'),
    ]

    operations = [
        migrations.RunPython(apply_real_data, noop),
    ]
