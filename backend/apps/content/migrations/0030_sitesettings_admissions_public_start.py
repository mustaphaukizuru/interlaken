# Ficha de inscripción (Fase 1): «Permitir iniciar la ficha sin enlace».
#
# Numbered 0030 on purpose: Fase 0 (feat/precios-2027) adds 0029_precios_2027.
# The dependency stays on 0028 until that branch merges; the rebase repoints it
# to ('content', '0029_precios_2027').

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0028_page_draft_revision'),
    ]

    operations = [
        migrations.AddField(
            model_name='sitesettings',
            name='admissions_public_start',
            field=models.BooleanField(
                default=True,
                help_text='Apagado: la ficha de inscripción solo se abre con el enlace que envía el colegio.',
                verbose_name='Permitir iniciar la ficha sin enlace',
            ),
        ),
    ]
