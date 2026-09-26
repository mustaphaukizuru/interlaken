"""
Data Ops Phase 7: the ARCO console on the list contract.

Server-side ``is_overdue`` + ``overdue_count`` over the whole filtered set,
``q`` / status (``open``) / type / overdue / dates filters, ordering incl.
the statutory deadline, the transition-guarded and audited status endpoint
(note required to close or to reopen), bulk ``in_review`` and the export.
"""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.core.models import AuditLog
from apps.legal.filters import ARCO_ORDERING
from apps.legal.models import ArcoRequest

pytestmark = pytest.mark.django_db

LIST = reverse("legal-admin-arco")
EXPORT = reverse("legal-admin-arco-export")
BULK = reverse("legal-admin-arco-bulk")

# Mirrors ARCO_ORDERING_KEYS in frontend/src/hooks/queries/arco.ts.
FRONTEND_ORDERING_KEYS = {"date", "deadline", "status", "type", "requester"}


def _arco(email, *, status="received", rtype="access", days=10, details="", name=""):
    return ArcoRequest.objects.create(
        requester_email=email,
        requester_name=name,
        request_type=rtype,
        status=status,
        details=details,
        statutory_deadline=timezone.localdate() + timedelta(days=days),
    )


@pytest.fixture
def queue():
    return {
        "late": _arco("late@t.mx", days=-3, rtype="cancellation", details="Borrar mis datos"),
        "review": _arco("review@t.mx", status="in_review", days=5, name="Rosa Pérez"),
        "late_review": _arco("old@t.mx", status="in_review", days=-1),
        "closed": _arco("closed@t.mx", status="resolved", days=-30),
    }


def _ids(resp):
    return [r["id"] for r in resp.data["results"]]


def _status_url(arco):
    return reverse("legal-admin-arco-status", args=[arco.pk])


def test_ordering_keys_match_the_frontend_constant():
    assert set(ARCO_ORDERING) == FRONTEND_ORDERING_KEYS


class TestList:
    def test_overdue_is_server_side_and_counts_the_whole_set(self, admin_client, queue):
        resp = admin_client.get(LIST, {"status": "open", "page_size": 1})
        assert resp.data["count"] == 3
        # Two open requests are overdue even though the page shows one row.
        assert resp.data["overdue_count"] == 2
        rows = {r["id"]: r for r in admin_client.get(LIST).data["results"]}
        assert rows[queue["late"].id]["is_overdue"] is True
        assert rows[queue["closed"].id]["is_overdue"] is False  # closed never counts

    def test_filters(self, admin_client, queue):
        assert set(_ids(admin_client.get(LIST, {"overdue": "1"}))) == {
            queue["late"].id,
            queue["late_review"].id,
        }
        assert _ids(admin_client.get(LIST, {"type": "cancellation"})) == [queue["late"].id]
        assert _ids(admin_client.get(LIST, {"status": "resolved"})) == [queue["closed"].id]
        assert admin_client.get(LIST, {"status": "bogus"}).data["count"] == 4

    def test_q_over_email_name_and_details(self, admin_client, queue):
        assert _ids(admin_client.get(LIST, {"q": "borrar"})) == [queue["late"].id]
        assert _ids(admin_client.get(LIST, {"q": "rosa"})) == [queue["review"].id]
        assert _ids(admin_client.get(LIST, {"q": "closed@"})) == [queue["closed"].id]

    def test_ordering_by_deadline(self, admin_client, queue):
        assert _ids(admin_client.get(LIST, {"ordering": "deadline"})) == [
            queue["closed"].id,
            queue["late"].id,
            queue["late_review"].id,
            queue["review"].id,
        ]

    @pytest.mark.parametrize("n", [3, 12])
    def test_query_budget_is_constant(self, api_client, django_assert_num_queries, n):
        for i in range(n):
            _arco(f"p{i}@t.mx", days=-i)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(3):  # count + page + overdue_count
            assert api_client.get(LIST, {"q": "t.mx", "ordering": "deadline"}).status_code == 200


class TestStatus:
    def test_resolve_requires_a_note(self, admin_client, queue):
        resp = admin_client.post(_status_url(queue["late"]), {"status": "resolved"}, format="json")
        assert resp.status_code == 400
        queue["late"].refresh_from_db()
        assert queue["late"].status == "received"

    def test_resolve_is_audited_with_the_note(self, admin_client, queue):
        resp = admin_client.post(
            _status_url(queue["late"]),
            {"status": "resolved", "resolution_note": "Datos cancelados."},
            format="json",
        )
        assert resp.status_code == 200 and resp.data["status"] == "resolved"
        entry = AuditLog.objects.get(context="legal.arco.status", object_id=str(queue["late"].id))
        assert entry.changes["status"] == ["received", "resolved"]
        assert entry.changes["note"] == "Datos cancelados."

    def test_transition_table_is_enforced(self, admin_client, queue):
        resp = admin_client.post(
            _status_url(queue["review"]), {"status": "received"}, format="json"
        )
        assert resp.status_code == 400
        resp = admin_client.post(
            _status_url(queue["review"]), {"status": "in_review"}, format="json"
        )
        assert resp.status_code == 400  # same state

    def test_reopen_needs_a_note_and_clears_resolved_at(self, admin_client, queue):
        closed = queue["closed"]
        assert (
            admin_client.post(
                _status_url(closed), {"status": "in_review"}, format="json"
            ).status_code
            == 400
        )
        resp = admin_client.post(
            _status_url(closed),
            {"status": "in_review", "resolution_note": "El titular aportó documentos."},
            format="json",
        )
        assert resp.status_code == 200
        closed.refresh_from_db()
        assert closed.status == "in_review" and closed.resolved_at is None
        entry = AuditLog.objects.get(context="legal.arco.status", object_id=str(closed.id))
        assert entry.changes["note"] == "El titular aportó documentos."


class TestBulk:
    def test_in_review_only_moves_received(self, admin_client, queue):
        ids = [queue["late"].id, queue["review"].id, queue["closed"].id]
        plan = admin_client.post(
            BULK, {"action": "in_review", "ids": ids, "dry_run": True}, format="json"
        )
        assert plan.status_code == 200 and plan.data["ok"] == 1 and len(plan.data["skipped"]) == 2
        resp = admin_client.post(BULK, {"action": "in_review", "ids": ids}, format="json")
        assert resp.data["ok"] == 1
        queue["late"].refresh_from_db()
        queue["closed"].refresh_from_db()
        assert queue["late"].status == "in_review" and queue["closed"].status == "resolved"
        assert AuditLog.objects.filter(object_type="bulk:legal.arcorequest").exists()

    def test_only_in_review_is_offered(self, admin_client, queue):
        resp = admin_client.post(
            BULK, {"action": "resolved", "ids": [queue["late"].id]}, format="json"
        )
        assert resp.status_code == 400

    def test_parent_is_403(self, api_client, queue):
        api_client.force_authenticate(ParentFactory())
        assert (
            api_client.post(BULK, {"action": "in_review", "ids": [1]}, format="json").status_code
            == 403
        )
        assert api_client.get(EXPORT).status_code == 403


class TestExport:
    def test_csv_honours_filters_and_is_audited(self, admin_client, queue):
        resp = admin_client.get(EXPORT, {"fmt": "csv", "status": "open", "ordering": "deadline"})
        lines = b"".join(resp.streaming_content).decode("utf-8-sig").strip().split("\r\n")
        assert lines[0].startswith("Recibida,Derecho,Solicitante,Correo")
        assert len(lines) == 4 and "late@t.mx" in lines[1] and lines[1].count(",Sí,") == 1
        assert AuditLog.objects.get(object_type="export:arco").changes["rows"] == 3

    def test_pdf(self, admin_client, queue):
        resp = admin_client.get(EXPORT, {"fmt": "pdf"})
        assert resp.status_code == 200 and resp.content.startswith(b"%PDF")
