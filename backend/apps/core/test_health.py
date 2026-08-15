"""
Health endpoint (IK-OPS A11): public liveness probe for uptime monitors.
"""
import pytest
from django.urls import reverse

from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

URL = reverse('health')


class TestHealth:
    def test_anonymous_200_with_checks(self, api_client):
        resp = api_client.get(URL)
        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'ok'
        assert data['checks'] == {'db': True, 'cache': True}
        assert 'time' in data

    def test_probe_is_not_audit_logged(self, api_client):
        before = AuditLog.objects.count()
        api_client.get(URL)
        assert AuditLog.objects.count() == before


class TestHealthz:
    """Root-level /healthz — Render's healthCheckPath (no /api/v1 prefix)."""

    def test_root_healthz_200_with_flat_shape(self, api_client):
        resp = api_client.get('/healthz')
        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'ok'
        assert data['db'] is True
        assert data['cache'] is True

    def test_healthz_is_json_not_spa_html(self, api_client):
        # Must be registered before the SPA catch-all — an HTML index here
        # would make Render's health check green on a broken API.
        resp = api_client.get('/healthz')
        assert resp['Content-Type'].startswith('application/json')
