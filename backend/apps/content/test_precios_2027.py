"""Migration 0029 (precios 2027): changes only the values that still hold the
old amount, leaves everything else alone, and is reversible."""
from decimal import Decimal
from importlib import import_module

import pytest
from django.apps import apps as global_apps

from apps.content.models import EnrollmentFee, PricingPolicy, TuitionCost

pytestmark = pytest.mark.django_db

mig = import_module('apps.content.migrations.0029_precios_2027')


def _fee(section, modality='nuevo_ingreso'):
    return EnrollmentFee.objects.get(section=section, modality=modality).cuota


def test_seeded_state_has_2027_prices():
    """After every migration the seeded tables carry the 2027 figures."""
    assert _fee('Preescolar') == Decimal('7000.00')
    assert _fee('Primaria') == Decimal('9000.00')
    assert _fee('Secundaria') == Decimal('9600.00')          # unchanged
    assert _fee('Preescolar', 'reinscripcion') == Decimal('5760.00')  # unchanged
    assert TuitionCost.objects.get(section='Primaria').colegiatura == Decimal('6650.00')
    assert TuitionCost.objects.get(section='Secundaria').colegiatura == Decimal('7200.00')
    assert TuitionCost.objects.get(section='Sección Maternal').colegiatura == Decimal('4190.00')
    texts = ' '.join(PricingPolicy.objects.values_list('text', flat=True))
    assert 'antes del 1 de junio de 2027' in texts and 'junio de 2026' not in texts


def test_backwards_restores_old_values():
    mig.backwards(global_apps, None)
    assert _fee('Preescolar') == Decimal('6800.00')
    assert _fee('Primaria') == Decimal('8800.00')
    assert TuitionCost.objects.get(section='Primaria').colegiatura == Decimal('6450.00')
    assert TuitionCost.objects.get(section='Secundaria').colegiatura == Decimal('6990.00')
    assert PricingPolicy.objects.filter(text__contains='junio de 2026').exists()


def test_values_edited_by_the_school_are_kept():
    """A price the office already changed in «Costos y precios» is not overwritten."""
    mig.backwards(global_apps, None)
    EnrollmentFee.objects.filter(section='Primaria', modality='nuevo_ingreso').update(cuota=Decimal('9100.00'))
    TuitionCost.objects.filter(section='Secundaria').update(colegiatura=Decimal('7300.00'))
    mig.forwards(global_apps, None)
    assert _fee('Primaria') == Decimal('9100.00')
    assert TuitionCost.objects.get(section='Secundaria').colegiatura == Decimal('7300.00')
    assert _fee('Preescolar') == Decimal('7000.00')  # still at the old amount → updated
