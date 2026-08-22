"""Drop the retired tuition-billing tables.

The school does not bill colegiatura/inscripción through the app; the only
money path is the cafetería wallet. Order respects FKs: dependents first.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0005_invoice_finance_inv_status_4d056c_idx'),
        ('payments', '0004_retire_tuition_enrollment_types'),
    ]

    operations = [
        migrations.DeleteModel(name='InvoiceAdjustment'),
        migrations.DeleteModel(name='InvoicePayment'),
        migrations.DeleteModel(name='InvoiceLineItem'),
        migrations.DeleteModel(name='Invoice'),
        migrations.DeleteModel(name='Discount'),
        migrations.DeleteModel(name='FeeSchedule'),
    ]
