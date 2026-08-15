"""Pricing bundle (ciclo 2026-2027): seeded values, endpoint shape, cache invalidation."""
from decimal import Decimal

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from .models import (
    PRICING_CACHE_KEY, DaycareRate, EnrollmentFee, ExtracurricularActivity,
    FixedConcept, PricingPolicy, TuitionCost,
)

pytestmark = pytest.mark.django_db

URL = '/api/v1/content/pricing/'


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.delete(PRICING_CACHE_KEY)
    yield
    cache.delete(PRICING_CACHE_KEY)


def test_bundle_shape_and_seeded_2026_values():
    res = APIClient().get(URL)
    assert res.status_code == 200
    data = res.json()
    for key in ('enrollment_fees', 'tuition', 'fixed_concepts',
                'extracurriculars', 'daycare', 'policies'):
        assert key in data, key

    # Inscripción nuevo ingreso vs reinscripción (flyer 2026).
    fees = {(f['section'], f['modality']): f for f in data['enrollment_fees']}
    assert fees[('Secundaria', 'nuevo_ingreso')]['cuota'] == '9600.00'
    assert fees[('Secundaria', 'nuevo_ingreso')]['gastos_administrativos'] == '2500.00'
    assert fees[('Preescolar', 'reinscripcion')]['cuota'] == '5760.00'
    assert fees[('Preescolar', 'reinscripcion')]['gastos_administrativos'] == '2000.00'

    # Colegiaturas actualizadas por 0008 (eran cifras 2024-2025).
    tuition = {row['section']: row['colegiatura'] for row in data['tuition']}
    by_match = {k: v for k, v in tuition.items()}
    assert any(v == '4190.00' for k, v in by_match.items() if 'Maternal' in k)
    assert any(v == '6990.00' for k, v in by_match.items() if 'Secundaria' in k)

    # Seguros obligatorios y estancia con multa sin mensualidad.
    seguros = {c['name']: c for c in data['fixed_concepts']}
    assert seguros['Seguro orfandad']['cost'] == '700.00'
    assert all(c['mandatory'] for c in data['fixed_concepts'])
    multa = [d for d in data['daycare'] if d['monthly_cost'] is None]
    assert multa and 'cancela' in multa[0]['monthly_note']

    assert len(data['extracurriculars']) == 5
    assert len(data['policies']) == 6


def test_inactive_rows_hidden():
    EnrollmentFee.objects.filter(section='Primaria').update(is_active=False)
    cache.delete(PRICING_CACHE_KEY)  # .update() bypasses save(); clear manually
    data = APIClient().get(URL).json()
    assert all(f['section'] != 'Primaria' for f in data['enrollment_fees'])


def test_cache_invalidated_on_save():
    first = APIClient().get(URL).json()
    row = FixedConcept.objects.get(name='Credenciales')
    row.cost = Decimal('999.00')
    row.save()  # save() must clear PRICING_CACHE_KEY
    data = APIClient().get(URL).json()
    creds = [c for c in data['fixed_concepts'] if c['name'] == 'Credenciales'][0]
    assert creds['cost'] == '999.00'
    assert first != data


def test_tuition_save_clears_pricing_bundle_too():
    APIClient().get(URL)  # prime cache
    row = TuitionCost.objects.filter(section__icontains='Primaria').first()
    row.colegiatura = Decimal('6451.00')
    row.save()
    data = APIClient().get(URL).json()
    assert any(t['colegiatura'] == '6451.00' for t in data['tuition'])


def test_policy_and_extras_ordering():
    data = APIClient().get(URL).json()
    orders = [p['order'] for p in data['policies']]
    assert orders == sorted(orders)
    extras = [e['order'] for e in data['extracurriculars']]
    assert extras == sorted(extras)
