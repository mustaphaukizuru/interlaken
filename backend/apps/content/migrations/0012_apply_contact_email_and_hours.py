"""
Data migration (BACKLOG P0-6 / P0-9, school instructions 2026-08-21): the
public contact address becomes info@interlaken.com.mx and the office hours
become "Lunes a Viernes 7:30 - 15:00". Only rows still holding the previous
defaults are touched; anything the school already edited in Ajustes stays.
"""
from django.db import migrations

OLD_EMAILS = {'colegio@interlaken.com.mx', 'colegio@interlaken.edu.mx', 'admisiones@interlaken.edu.mx', ''}
OLD_HOURS = {'Lunes–Viernes 8:00–16:00 hrs', 'Lunes-Viernes 8:00-16:00 hrs', ''}

NEW_EMAIL = 'info@interlaken.com.mx'
NEW_HOURS = 'Lunes a Viernes 7:30 - 15:00'


def forwards(apps, schema_editor):
    SiteSettings = apps.get_model('content', 'SiteSettings')
    for row in SiteSettings.objects.all():
        changed = []
        if (row.contact_email or '').strip().lower() in OLD_EMAILS:
            row.contact_email = NEW_EMAIL
            changed.append('contact_email')
        if (row.office_hours or '').strip() in OLD_HOURS:
            row.office_hours = NEW_HOURS
            changed.append('office_hours')
        if changed:
            row.save(update_fields=changed)


class Migration(migrations.Migration):
    dependencies = [
        ('content', '0011_contact_email_and_office_hours'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
