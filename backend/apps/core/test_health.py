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
