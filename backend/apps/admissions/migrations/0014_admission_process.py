"""Expediente de admisión (Fase 5): the process stages on the lead, the
becas/descuentos agreed and the inscripción payments recorded (record only).

Numbered 0014 on purpose: the documents-by-level branch adds 0013. The
dependency stays on 0012 until that branch merges; the merge repoints it to
('admissions', '0013_…').

Data: the stage is derived from the legacy status (pending → informes,
contacted → visita, enrolled → inscrito, rejected → cerrado «No procedió»),
``stage_changed_at`` / ``closed_at`` / ``enrolled_at`` from ``updated_at``.
Backwards writes the status back from the stage (they are kept in sync, so
this only matters for rows edited in between), then the fields go.
"""

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models
from django.db.models import F


# Same tables as admissions.process (a migration never imports app code).
STATUS_STAGE = {"pending": "informes", "contacted": "visita", "enrolled": "inscrito", "rejected": "cerrado"}
STAGE_STATUS = {"informes": "pending", "visita": "contacted", "examen": "contacted",
                "documentacion": "contacted", "inscrito": "enrolled", "cerrado": "rejected"}


def forwards(apps, schema_editor):
    PreRegistration = apps.get_model("admissions", "PreRegistration")
    since = F("updated_at")
    # .update(): no save(), so updated_at keeps its value.
    for status, stage in STATUS_STAGE.items():
        fields = {"stage": stage, "stage_changed_at": since}
        if stage == "cerrado":
            fields.update(closed_outcome="no_procedio", closed_from_stage="informes", closed_at=since)
        elif stage == "inscrito":
            fields["enrolled_at"] = since
        PreRegistration.objects.filter(status=status).update(**fields)
    PreRegistration.objects.filter(stage_changed_at__isnull=True).update(stage_changed_at=since)


def backwards(apps, schema_editor):
    PreRegistration = apps.get_model("admissions", "PreRegistration")
    for stage, status in STAGE_STATUS.items():
        PreRegistration.objects.filter(stage=stage).exclude(status=status).update(status=status)


class Migration(migrations.Migration):

    dependencies = [
        ('admissions', '0012_ficha_backfill'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AdmissionDiscount',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('inscripcion', 'Descuento en inscripción'), ('beca_colegiatura', 'Beca en colegiatura'), ('descuento_colegiatura', 'Descuento en colegiatura')], max_length=30, verbose_name='Tipo')),
                ('percent', models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True, verbose_name='Porcentaje')),
                ('amount', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True, verbose_name='Monto fijo (MXN)')),
                ('duration', models.CharField(blank=True, choices=[('', 'Sin duración'), ('3_meses', '3 meses'), ('6_meses', '6 meses'), ('ciclo', '1 ciclo'), ('permanente', 'Permanente'), ('personalizado', 'Meses a la medida')], default='', max_length=20, verbose_name='Duración')),
                ('start_month', models.DateField(blank=True, null=True, verbose_name='Desde')),
                ('end_month', models.DateField(blank=True, null=True, verbose_name='Hasta')),
                ('authorized_by', models.CharField(max_length=150, verbose_name='Autorizó')),
                ('note', models.TextField(blank=True, default='', verbose_name='Nota')),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('voided_at', models.DateTimeField(blank=True, null=True)),
                ('void_reason', models.CharField(blank=True, default='', max_length=300)),
            ],
            options={
                'verbose_name': 'Beca o descuento (admisión)',
                'verbose_name_plural': 'Becas y descuentos (admisión)',
                'ordering': ['created_at', 'id'],
            },
        ),
        migrations.CreateModel(
            name='EnrollmentPayment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('paid_on', models.DateField(verbose_name='Fecha de pago')),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10, verbose_name='Monto (MXN)')),
                ('method', models.CharField(choices=[('efectivo', 'Efectivo'), ('transferencia', 'Transferencia'), ('tarjeta', 'Tarjeta'), ('otro', 'Otro')], max_length=20, verbose_name='Forma de pago')),
                ('reference', models.CharField(blank=True, default='', max_length=100, verbose_name='Referencia')),
                ('note', models.CharField(blank=True, default='', max_length=300, verbose_name='Nota')),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('voided_at', models.DateTimeField(blank=True, null=True)),
                ('void_reason', models.CharField(blank=True, default='', max_length=300)),
            ],
            options={
                'verbose_name': 'Pago de inscripción (registro)',
                'verbose_name_plural': 'Pagos de inscripción (registro)',
                'ordering': ['paid_on', 'id'],
            },
        ),
        migrations.AddField(
            model_name='preregistration',
            name='agreements_note',
            field=models.TextField(blank=True, default='', verbose_name='Acuerdos'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='child_age',
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name='Edad'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='closed_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Cerrado el'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='closed_from_stage',
            field=models.CharField(blank=True, default='', max_length=20, verbose_name='Cerrado en la etapa'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='closed_outcome',
            field=models.CharField(blank=True, choices=[('', 'Abierto'), ('no_interesa', 'No le interesa'), ('no_asistio', 'No asistió'), ('no_aceptado', 'No aceptado'), ('no_procedio', 'No procedió')], default='', max_length=20, verbose_name='Motivo de cierre'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='closed_reason',
            field=models.CharField(blank=True, default='', max_length=500, verbose_name='Detalle del cierre'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='costs_sent_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Cuotas enviadas'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='documents_waived',
            field=models.BooleanField(default=False, verbose_name='Documentos dispensados'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='documents_waived_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='documents_waived_reason',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='enrolled_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Inscrito el'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='exam_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Examen'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='exam_date_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='exam_notes',
            field=models.TextField(blank=True, default='', verbose_name='Notas del examen'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='exam_result',
            field=models.CharField(blank=True, choices=[('', 'Sin resultado'), ('aceptado', 'Aceptado'), ('no_aceptado', 'No aceptado')], default='', max_length=20, verbose_name='Resultado del examen'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='exam_result_reason',
            field=models.CharField(blank=True, default='', max_length=500, verbose_name='Motivo del resultado'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='exam_result_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='exam_results_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Entrega de resultados'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='ficha_link_sent_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Liga de ficha enviada'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='informes_outcome',
            field=models.CharField(blank=True, choices=[('', 'Sin registrar'), ('continua_visita', 'Continúa a visita guiada'), ('no_interesa', 'No le interesa')], default='', max_length=20, verbose_name='Resultado de informes'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='previous_school',
            field=models.CharField(blank=True, max_length=200, verbose_name='Colegio de procedencia'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='stage',
            field=models.CharField(choices=[('informes', 'Informes'), ('visita', 'Visita guiada'), ('examen', 'Examen'), ('documentacion', 'Documentación y acuerdos'), ('inscrito', 'Inscrito'), ('cerrado', 'Cerrado')], default='informes', max_length=20, verbose_name='Etapa'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='stage_changed_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='En la etapa desde'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='visit_link_sent_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Liga de visita enviada'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='visit_note',
            field=models.CharField(blank=True, default='', max_length=500, verbose_name='Nota de la visita'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='visit_outcome',
            field=models.CharField(blank=True, choices=[('', 'Sin registrar'), ('agenda_examen', 'Asistió y agenda examen'), ('no_interesa', 'Asistió, no le interesa'), ('no_asistio', 'No asistió')], default='', max_length=20, verbose_name='Resultado de la visita'),
        ),
        migrations.AddField(
            model_name='preregistration',
            name='visit_outcome_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='preregistration',
            name='parent_email',
            field=models.EmailField(blank=True, max_length=254, verbose_name='Correo electrónico'),
        ),
        migrations.AddIndex(
            model_name='preregistration',
            index=models.Index(fields=['stage', '-created_at'], name='adm_prereg_stage_created'),
        ),
        migrations.AddIndex(
            model_name='preregistration',
            index=models.Index(fields=['exam_at'], name='adm_prereg_exam_at'),
        ),
        migrations.AddField(
            model_name='admissiondiscount',
            name='created_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='admissiondiscount',
            name='pre_registration',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='discounts', to='admissions.preregistration'),
        ),
        migrations.AddField(
            model_name='enrollmentpayment',
            name='pre_registration',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='enrollment_payments', to='admissions.preregistration'),
        ),
        migrations.AddField(
            model_name='enrollmentpayment',
            name='recorded_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL),
        ),
        migrations.RunPython(forwards, backwards),
    ]
