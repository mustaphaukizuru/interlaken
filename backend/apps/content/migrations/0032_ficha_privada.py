"""Ficha de inscripción privada (2026-11-21).

The ficha de inscripción reaches a family only through the personal link the
school sends once the child took the admission exam and was admitted. So
«Permitir iniciar la ficha sin enlace» is now off by default and is turned off
on the site settings that exist (the Ajustes switch stays for administrators).

Backwards: the default goes back to on and the setting is turned on again,
which was the value every site had before this migration (the switch shipped
on in 0030 and production never turned it off).
"""
from django.db import migrations, models


def turn_off(apps, schema_editor):
    SiteSettings = apps.get_model('content', 'SiteSettings')
    SiteSettings.objects.update(admissions_public_start=False)


def turn_on(apps, schema_editor):
    SiteSettings = apps.get_model('content', 'SiteSettings')
    SiteSettings.objects.update(admissions_public_start=True)


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0031_sitesettings_tpl_process'),
    ]

    operations = [
        migrations.AlterField(
            model_name='sitesettings',
            name='admissions_public_start',
            field=models.BooleanField(
                default=False,
                help_text=('Apagado (recomendado): la ficha de inscripción solo se abre con el enlace personal '
                           'que el colegio envía a cada familia admitida.'),
                verbose_name='Permitir iniciar la ficha sin enlace',
            ),
        ),
        migrations.RunPython(turn_off, turn_on),
    ]
