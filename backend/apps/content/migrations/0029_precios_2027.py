"""Precios 2027 (hoja de precios del colegio, 2026-11-20).

Cambia solo las cifras que la hoja marca a mano: la inscripción de nuevo ingreso
de Preescolar y Primaria y la colegiatura de Primaria y Secundaria, y la fecha
de devolución de la política de pagos. Cada valor cambia SOLO si todavía tiene
el valor anterior: si el colegio ya lo editó en «Costos y precios», se respeta.
Reversible con los mismos cuidados.
"""
from decimal import Decimal

from django.core.cache import cache
from django.db import migrations

# (sección, modalidad, anterior, nuevo)
FEES = (
    ('Preescolar', 'nuevo_ingreso', Decimal('6800.00'), Decimal('7000.00')),
    ('Primaria', 'nuevo_ingreso', Decimal('8800.00'), Decimal('9000.00')),
)
# (sección, anterior, nuevo)
TUITION = (
    ('Primaria', Decimal('6450.00'), Decimal('6650.00')),
    ('Secundaria', Decimal('6990.00'), Decimal('7200.00')),
)
POLICY_OLD = 'antes del 1 de junio de 2026'
POLICY_NEW = 'antes del 1 de junio de 2027'

# Same keys as content.models (the public price endpoints cache their bundle).
CACHE_KEYS = ('content.pricing-bundle.v1', 'content.tuition-costs.v1')


def _apply(apps, *, forward: bool):
    EnrollmentFee = apps.get_model('content', 'EnrollmentFee')
    TuitionCost = apps.get_model('content', 'TuitionCost')
    PricingPolicy = apps.get_model('content', 'PricingPolicy')

    for section, modality, old, new in FEES:
        src, dst = (old, new) if forward else (new, old)
        EnrollmentFee.objects.filter(section=section, modality=modality, cuota=src).update(cuota=dst)
    for section, old, new in TUITION:
        src, dst = (old, new) if forward else (new, old)
        TuitionCost.objects.filter(section=section, colegiatura=src).update(colegiatura=dst)
    src, dst = (POLICY_OLD, POLICY_NEW) if forward else (POLICY_NEW, POLICY_OLD)
    for policy in PricingPolicy.objects.filter(text__contains=src):
        policy.text = policy.text.replace(src, dst)
        policy.save(update_fields=['text'])

    for key in CACHE_KEYS:
        cache.delete(key)


def forwards(apps, schema_editor):
    _apply(apps, forward=True)


def backwards(apps, schema_editor):
    _apply(apps, forward=False)


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0028_page_draft_revision'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
