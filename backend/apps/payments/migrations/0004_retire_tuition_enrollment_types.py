"""Retire the tuition / enrollment payment types.

The app only sells cafetería wallet top-ups. Any historical rows that were
typed ``tuition`` or ``enrollment`` are folded into ``other`` (the description
keeps the original label) so no row is lost and the choice set can shrink.
"""
from django.db import migrations, models

RETIRED = {'tuition': 'Colegiatura', 'enrollment': 'Inscripción'}


def fold_retired_types(apps, schema_editor):
    Payment = apps.get_model('payments', 'Payment')
    for code, label in RETIRED.items():
        for p in Payment.objects.filter(payment_type=code).iterator():
            prefix = f'[{label}] '
            if not p.description.startswith(prefix):
                p.description = (prefix + p.description)[:255]
            p.payment_type = 'other'
            p.save(update_fields=['payment_type', 'description'])


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0003_payment_payments_pa_status_343680_idx_and_more'),
    ]

    operations = [
        migrations.RunPython(fold_retired_types, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='payment',
            name='payment_type',
            field=models.CharField(
                choices=[('cafeteria', 'Recarga Cafetería'), ('other', 'Otro')],
                max_length=20),
        ),
    ]
