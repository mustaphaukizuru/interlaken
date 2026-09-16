from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('cafeteria', '0011_cafeteriatransaction_cafeteria_c_student_d6f136_idx_and_more')]
    operations = [
        migrations.AddField(model_name='loyversesyncstate', name='last_webhook_at',
                            field=models.DateTimeField(blank=True, null=True, verbose_name='Última entrega de webhook')),
        migrations.AddField(model_name='loyversesyncstate', name='last_webhook_type',
                            field=models.CharField(blank=True, default='', max_length=40)),
    ]
