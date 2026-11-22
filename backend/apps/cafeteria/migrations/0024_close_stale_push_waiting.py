"""Close «Esperando para cargarla en Loyverse» on top-ups already applied.

Until 2026-11-22 a top-up the app was still waiting to write into Loyverse
kept that label after staff applied it by hand (seen live: Olivia's $50 of
2026-11-22, applied by staff while the app waited on an old $1 load). The
credit path now closes it (``services._credit_topup_locked``); this closes the
ones left behind. Labels only: no amount, balance or status changes.
"""
from django.db import migrations


def close_stale_waiting(apps, schema_editor):
    TopUpRequest = apps.get_model('cafeteria', 'TopUpRequest')
    (TopUpRequest.objects.filter(loyverse_push_state='waiting')
     .exclude(status='paid')
     .update(loyverse_push_state='',
             loyverse_push_note='Aplicada por otra vía antes de la carga automática.'))


class Migration(migrations.Migration):

    dependencies = [
        ('cafeteria', '0023_topup_loyverse_push'),
    ]

    operations = [
        migrations.RunPython(close_stale_waiting, migrations.RunPython.noop),
    ]
