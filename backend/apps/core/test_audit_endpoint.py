"""
GET /api/v1/core/admin/audit/ — read-only audit viewer (Admin console v2):
admin-only (parent → 403, anonymous → 401), paginated, filterable by
actor / action / context / target / date.
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.core.audit import record

pytestmark = pytest.mark.django_db

URL_NAME = "core-admin-audit"


@pytest.fixture
def entries(db):
    admin = AdminFactory(email="ada@test.mx")
    other = AdminFactory(email="otro@test.mx")
    s1, s2 = StudentProfileFactory(), StudentProfileFactory()
    record("update", s1, {"reason": "uno"}, actor=admin, context="finance.mark_paid")
    record("update", s2, {"reason": "dos"}, actor=other, context="cafeteria.adjust")
    record("create", s2, {"reason": "tres"}, actor_label="system:webhook", context="payments")
    return {"admin": admin, "other": other, "s1": s1, "s2": s2}


class TestPermissions:
    def test_anonymous_is_401(self, api_client):
        assert api_client.get(reverse(URL_NAME)).status_code == 401

    def test_parent_is_403(self, api_client, parent_user):
        api_client.force_authenticate(user=parent_user)
        assert api_client.get(reverse(URL_NAME)).status_code == 403

    def test_admin_gets_paginated_list(self, admin_client, entries):
        resp = admin_client.get(reverse(URL_NAME))
        assert resp.status_code == 200
        assert "results" in resp.data and "count" in resp.data
        # Factories themselves emit signal-audited rows; ours must be present.
        contexts = {r["context"] for r in resp.data["results"]}
        assert "finance.mark_paid" in contexts


class TestFilters:
    def test_filter_by_action(self, admin_client, entries):
        resp = admin_client.get(reverse(URL_NAME), {"action": "permission"})
        assert resp.status_code == 200
        assert all(r["action"] == "permission" for r in resp.data["results"])

    def test_filter_by_actor(self, admin_client, entries):
        resp = admin_client.get(reverse(URL_NAME), {"actor": "ada@test.mx"})
        assert resp.status_code == 200
        assert resp.data["count"] >= 1
        assert all("ada@test.mx" in r["actor_label"] for r in resp.data["results"])

    def test_filter_by_context(self, admin_client, entries):
        resp = admin_client.get(reverse(URL_NAME), {"context": "cafeteria.adjust"})
        assert resp.status_code == 200
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["changes"]["reason"] == "dos"

    def test_filter_by_target(self, admin_client, entries):
        s1 = entries["s1"]
        resp = admin_client.get(reverse(URL_NAME), {
            "object_type": "accounts.studentprofile", "object_id": str(s1.pk),
            "context": "finance.mark_paid",
        })
        assert resp.status_code == 200
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["object_id"] == str(s1.pk)

    def test_invalid_date_is_ignored_not_500(self, admin_client, entries):
        resp = admin_client.get(reverse(URL_NAME), {"from": "garbage"})
        assert resp.status_code == 200

    def test_date_range(self, admin_client, entries):
        resp = admin_client.get(reverse(URL_NAME), {"from": "2099-01-01"})
        assert resp.status_code == 200
        assert resp.data["count"] == 0
