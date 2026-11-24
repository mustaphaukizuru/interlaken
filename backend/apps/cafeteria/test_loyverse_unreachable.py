"""QA sweep 2026-11-24 (round 2): when Loyverse cannot be read, the
reconciliation says so once at the top and counts no drift, and every message
the office sees is Spanish (the raw text stays in the server log)."""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance
from apps.cafeteria.services import LoyverseError, loyverse_error_es

pytestmark = pytest.mark.django_db

NO_TOKEN = LoyverseError('LOYVERSE_API_TOKEN is not configured.')


def _linked(n):
    for i in range(n):
        s = StudentProfileFactory(loyverse_id=f'loy-{i}')
        CafeteriaBalance.objects.create(student=s, balance=Decimal('10'))


@pytest.mark.parametrize('raw, expected', [
    ('LOYVERSE_API_TOKEN is not configured.', 'no está configurada'),
    ('401 Client Error: Unauthorized for url', 'rechazó la clave'),
    ('429 Client Error: Too Many Requests', 'exceso de solicitudes'),
    ('HTTPSConnectionPool: Max retries exceeded (Read timed out.)', 'no respondió a tiempo'),
    ('something else', 'No fue posible comunicarse con Loyverse'),
])
def test_loyverse_error_es(raw, expected):
    text = loyverse_error_es(LoyverseError(raw))
    assert expected in text and raw not in text and '—' not in text


@patch('apps.cafeteria.services.get_all_customers', side_effect=NO_TOKEN)
def test_reconcile_reports_the_error_once_and_counts_no_drift(_mock, api_client):
    _linked(3)
    api_client.force_authenticate(AdminFactory())
    resp = api_client.get(reverse('admin-reconcile'))
    assert resp.status_code == 200
    assert 'no está configurada' in resp.data['error']
    assert resp.data['drift_count'] == 0 and resp.data['checked'] == 3
    assert all(r['drift'] is None for r in resp.data['results'])
    only = api_client.get(reverse('admin-reconcile'), {'only': 'drift'})
    assert only.data['count'] == 0 and only.data['results'] == [] and only.data['error']


@patch('apps.cafeteria.services.get_all_customers',
       return_value=[{'id': 'loy-0', 'total_points': 10}])
def test_reconcile_error_is_null_when_loyverse_answers(_mock, api_client):
    _linked(1)
    api_client.force_authenticate(AdminFactory())
    resp = api_client.get(reverse('admin-reconcile'))
    assert resp.data['error'] is None and resp.data['drift_count'] == 0


@patch('apps.cafeteria.services.get_all_customers', side_effect=NO_TOKEN)
def test_reconcile_export_and_roster_sync_say_it_in_spanish(_mock, api_client):
    _linked(1)
    api_client.force_authenticate(AdminFactory())
    resp = api_client.get(reverse('admin-reconcile-export'), {'fmt': 'csv'})
    assert resp.status_code == 502 and 'LOYVERSE_API_TOKEN' not in str(resp.data)
    resp = api_client.post(reverse('admin-sync-roster'), {}, format='json')
    assert resp.status_code == 502
    assert resp.data['detail'].startswith('La conexión con Loyverse no está configurada')


def test_sync_all_502_is_spanish(api_client):
    api_client.force_authenticate(AdminFactory())
    with patch('apps.cafeteria.views.sync_all_balances', side_effect=NO_TOKEN):
        resp = api_client.post(reverse('admin-sync-all'), {}, format='json')
    assert resp.status_code == 502
    assert 'no está configurada' in resp.data['detail']


def test_sync_health_panel_text_is_spanish(api_client):
    api_client.force_authenticate(AdminFactory())
    # No token in tests: the real probe fails with the English message.
    data = api_client.get(reverse('admin-sync-health')).json()
    assert data['loyverse_ok'] is False
    assert data['loyverse_error'].startswith('La conexión con Loyverse no está configurada')
