"""
Security headers (IK-SEC C4): CSP is path-scoped — strict on the public
site/API, admin-relaxed for unfold's Alpine.js — and Permissions-Policy
locks down powerful browser features everywhere.
"""
import pytest
from django.urls import reverse

pytestmark = pytest.mark.django_db


class TestSecurityHeaders:
    def test_public_api_gets_strict_csp(self, api_client):
        resp = api_client.get(reverse('health'))
        csp = resp.headers.get('Content-Security-Policy', '')
        assert "default-src 'self'" in csp
        assert "frame-ancestors 'none'" in csp
        assert "object-src 'none'" in csp
        # The public policy must never allow eval.
        assert "'unsafe-eval'" not in csp

    def test_admin_csp_allows_alpine_but_stays_scoped(self, client):
        resp = client.get('/admin/login/')
        csp = resp.headers.get('Content-Security-Policy', '')
        assert "'unsafe-eval'" in csp          # Alpine.js (unfold)
        assert "frame-ancestors 'none'" in csp

    def test_admin_lookalike_public_path_gets_strict_csp(self, client):
        # /administracion is a public SPA route (catch-all serves index.html),
        # NOT Django admin — it must get the strict policy, never unsafe-eval.
        resp = client.get('/administracion')
        csp = resp.headers.get('Content-Security-Policy', '')
        assert "'unsafe-eval'" not in csp

    def test_bare_admin_no_slash_is_public_and_gets_strict_csp(self, client):
        # The admin is mounted at 'admin/' and the SPA catch-all only excludes
        # 'admin/' (with slash) — so '/admin' (no slash) is served the SPA, a
        # PUBLIC page. It must get the strict policy, never the admin's
        # unsafe-eval, otherwise the whole SPA runs under a relaxed CSP there.
        resp = client.get('/admin')
        assert b'<!doctype html>' in resp.content.lower() or resp.status_code == 200
        csp = resp.headers.get('Content-Security-Policy', '')
        assert "'unsafe-eval'" not in csp

    def test_permissions_policy_everywhere(self, api_client):
        resp = api_client.get(reverse('health'))
        pp = resp.headers.get('Permissions-Policy', '')
        assert 'camera=()' in pp
        assert 'geolocation=()' in pp

    def test_report_only_toggle(self, api_client, settings):
        settings.CSP_REPORT_ONLY = True
        resp = api_client.get(reverse('health'))
        assert 'Content-Security-Policy-Report-Only' in resp.headers
        assert 'Content-Security-Policy' not in resp.headers

    def test_kill_switch(self, api_client, settings):
        settings.CSP_ENABLED = False
        resp = api_client.get(reverse('health'))
        assert 'Content-Security-Policy' not in resp.headers
        # Permissions-Policy is independent of the CSP toggle.
        assert 'Permissions-Policy' in resp.headers
