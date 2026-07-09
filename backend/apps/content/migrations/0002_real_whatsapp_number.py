# Replace the wrong placeholder contact number with the school's real one
# (5215553791188, confirmed 2026-07-08). Only rows still holding the old
# placeholder are touched — values already edited by staff are preserved.
from django.db import migrations

OLD_TO_NEW = {
    'phone_display': ('(55) 1234-5678', '(55) 5379-1188'),
    'phone_e164': ('+525512345678', '+525553791188'),
    'whatsapp_number': ('5215512345678', '5215553791188'),
}


def forwards(apps, schema_editor):
    SiteSettings = apps.get_model('content', 'SiteSettings')
    try:
        obj = SiteSettings.objects.get(pk=1)
    except SiteSettings.DoesNotExist:
        return
    changed = []
    for field, (old, new) in OLD_TO_NEW.items():
        if getattr(obj, field) == old:
            setattr(obj, field, new)
            changed.append(field)
    if changed:
        obj.save(update_fields=changed + ['updated_at'])


class Migration(migrations.Migration):
    dependencies = [
        ('content', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
