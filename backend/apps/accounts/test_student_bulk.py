"""
Roster on the Data Ops contracts, part 2: the FilterSet (English names and the
Spanish aliases), ``ordering=balance`` inside the 2-query budget, and the C5
bulk endpoint (status under the transition table with the wallet-balance
warning on withdrawal, grade, group, sync_loyverse, all_matching, audit).
"""

from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.accounts.models import StudentProfile
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

LIST = reverse("students")
BULK = reverse("admin-student-bulk")


def _ids(resp):
    return [r["id"] for r in resp.data["results"]]


def _bulk(client, action, ids=(), value=None, **extra):
    body = {"action": action, "ids": list(ids), **extra}
    if value is not None:
        body["payload"] = {"value": value}
    return client.post(BULK, body, format="json")


@pytest.fixture
def roster():
    from apps.cafeteria.models import CafeteriaBalance

    a = StudentProfileFactory(grade="1° Primaria", group="A", user__password=None)
    b = StudentProfileFactory(grade="2° Secundaria", group="B", loyverse_id="", user__password=None)
    c = StudentProfileFactory(grade="1° Primaria", group="B", user__password=None)
    b.enrollment_date = "2024-08-26"
    b.save(update_fields=["enrollment_date"])
    CafeteriaBalance.objects.create(student=a, balance=Decimal("80.00"))
    CafeteriaBalance.objects.create(student=c, balance=Decimal("5.00"))
    return a, b, c


class TestFilters:
    def test_english_names_and_spanish_aliases_agree(self, admin_client, roster):
        a, b, c = roster
        for en, es, value in (
            ("level", "nivel", "primaria"),
            ("grade", "grado", "1° Primaria"),
            ("group", "grupo", "b"),
            ("status", "estado", "active"),
        ):
            assert _ids(admin_client.get(LIST, {en: value})) == _ids(
                admin_client.get(LIST, {es: value})
            )
        assert set(_ids(admin_client.get(LIST, {"group": "b"}))) == {b.id, c.id}

    def test_linked_access_and_enrollment_dates(self, admin_client, roster):
        a, b, c = roster
        assert _ids(admin_client.get(LIST, {"linked": "0"})) == [b.id]
        assert set(_ids(admin_client.get(LIST, {"vinculado": "1"}))) == {a.id, c.id}
        assert set(_ids(admin_client.get(LIST, {"acceso": "never"}))) == {a.id, b.id, c.id}
        assert set(_ids(admin_client.get(LIST, {"access": "nopass"}))) == {a.id, b.id, c.id}
        assert _ids(admin_client.get(LIST, {"enrolled_from": "2024-08-01"})) == [b.id]
        assert _ids(admin_client.get(LIST, {"enrolled_to": "2024-07-01"})) == []

    def test_unknown_values_are_ignored_not_400(self, admin_client, roster):
        resp = admin_client.get(LIST, {"estado": "archivado", "nivel": "universidad"})
        assert resp.status_code == 200 and resp.data["count"] == 3

    def test_balance_column_and_ordering(self, admin_client, roster):
        a, b, c = roster
        resp = admin_client.get(LIST, {"ordering": "-balance"})
        assert _ids(resp) == [a.id, c.id, b.id]
        assert resp.data["results"][0]["balance"] == "80.00"
        assert resp.data["results"][2]["balance"] == "0.00"
        assert _ids(admin_client.get(LIST, {"ordering": "balance"})) == [b.id, c.id, a.id]

    def test_parents_get_no_filters_and_no_balance_field(self, api_client, roster, parent_user):
        a, *_ = roster
        a.parents.add(parent_user)
        api_client.force_authenticate(parent_user)
        resp = api_client.get(LIST, {"grado": "2° Secundaria"})
        assert _ids(resp) == [a.id] and "balance" not in resp.data["results"][0]

    @pytest.mark.parametrize("n", [4, 12])
    def test_balance_sort_stays_in_the_two_query_budget(
        self, api_client, django_assert_num_queries, n
    ):
        for _ in range(n):
            StudentProfileFactory(user__password=None)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(2):
            resp = api_client.get(LIST, {"ordering": "-balance", "nivel": "primaria"})
        assert resp.data["count"] == n


class TestBulkStatus:
    def test_withdraw_dry_run_warns_about_wallet_balances(self, admin_client, roster):
        a, b, c = roster
        resp = _bulk(admin_client, "status", [a.id, b.id, c.id], "withdrawn", dry_run=True)
        assert resp.status_code == 200
        body = resp.data
        assert body["dry_run"] is True and body["ok"] == 3
        assert [w["id"] for w in body["warnings"]] == [a.id, c.id]
        assert body["warnings"][0]["balance"] == "80.00"
        assert "$80.00" in body["warnings"][0]["message"]
        assert StudentProfile.objects.filter(status="withdrawn").count() == 0

    def test_withdraw_commits_archives_and_audits_per_row(self, admin_client, roster):
        a, b, c = roster
        resp = _bulk(admin_client, "status", [a.id, b.id], "withdrawn")
        assert resp.data["ok"] == 2 and "warnings" not in resp.data
        a.refresh_from_db()
        assert a.status == "withdrawn" and not a.is_active and not a.user.is_active
        rows = AuditLog.objects.filter(context="bulk:accounts.studentprofile:status")
        assert rows.count() == 2
        assert rows.first().changes["status"] == ["active", "withdrawn"]
        assert AuditLog.objects.filter(object_type="bulk:accounts.studentprofile").count() == 1
        # Nothing is ever deleted: the archive is a status.
        assert StudentProfile.objects.count() == 3

    def test_same_status_is_skipped(self, admin_client, roster):
        a, *_ = roster
        body = _bulk(admin_client, "status", [a.id], "active").data
        assert body["ok"] == 0 and body["skipped"][0]["id"] == a.id

    def test_all_matching_uses_the_list_filters(self, admin_client, roster):
        a, b, c = roster
        body = _bulk(
            admin_client,
            "status",
            value="on_leave",
            all_matching=True,
            filters={"nivel": "primaria"},
            dry_run=True,
        ).data
        assert body["requested"] == 2 and body["ok"] == 2

    def test_invalid_value_is_400(self, admin_client, roster):
        assert _bulk(admin_client, "status", [roster[0].id], "archived").status_code == 400
        assert _bulk(admin_client, "grade", [roster[0].id], "").status_code == 400
        assert _bulk(admin_client, "group", [roster[0].id], "ABCDEF").status_code == 400
        assert _bulk(admin_client, "delete", [roster[0].id]).status_code == 400


class TestBulkFields:
    def test_grade_and_group(self, admin_client, roster):
        a, b, c = roster
        body = _bulk(admin_client, "grade", [a.id, c.id], "2° Primaria").data
        assert body["ok"] == 2
        body = _bulk(admin_client, "group", [a.id, b.id], "c").data
        assert body["ok"] == 2
        a.refresh_from_db()
        assert (a.grade, a.group) == ("2° Primaria", "C")
        skipped = _bulk(admin_client, "group", [a.id], "C").data
        assert skipped["ok"] == 0 and skipped["skipped"][0]["reason"] == "Ya tiene ese grupo."


class TestBulkSyncLoyverse:
    def test_seeds_linked_unseeded_students_and_skips_the_rest(self, admin_client, roster):
        a, b, c = roster
        fresh = StudentProfileFactory(user__password=None)
        with patch(
            "apps.cafeteria.services.sync_student_balance", return_value=Decimal("42.00")
        ) as seed:
            plan = _bulk(admin_client, "sync_loyverse", [a.id, b.id, fresh.id], dry_run=True).data
            assert plan["ok"] == 2 and plan["skipped"][0]["id"] == b.id
            seed.assert_not_called()
            body = _bulk(admin_client, "sync_loyverse", [a.id, b.id, fresh.id]).data
        assert body["ok"] == 2 and seed.call_count == 2
        assert {s["id"] for s in body["skipped"]} == {b.id}

    def test_loyverse_errors_fail_the_row_only(self, admin_client, roster):
        from apps.cafeteria.services import LoyverseError

        a, _, c = roster
        with patch("apps.cafeteria.services.sync_student_balance", side_effect=LoyverseError("x")):
            body = _bulk(admin_client, "sync_loyverse", [a.id, c.id]).data
        assert body["ok"] == 0 and len(body["failed"]) == 2
        assert body["failed"][0]["error"].startswith("Loyverse no respondió")


class TestAccess:
    def test_parent_is_403(self, api_client, parent_user, roster):
        api_client.force_authenticate(parent_user)
        assert _bulk(api_client, "grade", [roster[0].id], "x").status_code == 403

    def test_ids_cap_is_413(self, admin_client):
        assert _bulk(admin_client, "grade", range(1, 502), "x").status_code == 413
