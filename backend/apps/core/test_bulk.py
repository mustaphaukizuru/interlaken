"""
apps.core.bulk — the bulk contract (Data Ops C5): request/response shape,
dry-run without side effects, per-row isolation, transition-table skips,
note-required reverses, the 500-id and 2,000-match caps → 413, per-row +
summary audit and batched side effects.
"""

import pytest
from rest_framework import generics
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.accounts.factories import AdminFactory
from apps.admissions.models import PreRegistration
from apps.core.bulk import AdminBulkView, BulkAction, BulkSkip, run_bulk, status_action
from apps.core.listing import AdminListMixin
from apps.core.models import AuditLog, ContactMessage
from apps.core.serializers import ContactMessageAdminSerializer

pytestmark = pytest.mark.django_db


# ── fixtures: a contact-inbox bulk endpoint ───────────────
def _mark(instance, payload, actor):
    if instance.name == "BOOM":
        raise RuntimeError("fila envenenada")
    if instance.is_handled:
        raise BulkSkip("Ya estaba atendido.")
    instance.is_handled = True
    instance.save(update_fields=["is_handled"])
    return {"is_handled": [False, True]}


def _plan(instance, payload):
    if instance.is_handled:
        raise BulkSkip("Ya estaba atendido.")


CALLS = []


def _after(instances, payload, actor):
    CALLS.append([i.pk for i in instances])


MARK = BulkAction(
    "mark_handled", "Marcar atendido", _mark, plan=_plan, side_effects="batched", after=_after
)
REOPEN = BulkAction(
    "reopen", "Reabrir", lambda i, p, a: None, requires_note=True, side_effects="none"
)


class ContactListView(AdminListMixin, generics.ListAPIView):
    serializer_class = ContactMessageAdminSerializer
    queryset = ContactMessage.objects.all()
    search_fields = ("name",)
    ordering = {"name": "name"}
    default_ordering = "name"

    def get_queryset(self):
        qs = super().get_queryset()
        handled = self.request.query_params.get("handled")
        if handled in ("0", "1"):
            qs = qs.filter(is_handled=(handled == "1"))
        return qs


class ContactBulkView(AdminBulkView):
    entity = "core.contactmessage"
    list_view_class = ContactListView
    actions = {MARK.name: MARK, REOPEN.name: REOPEN}


def _post(body, user=None, view=ContactBulkView):
    request = APIRequestFactory().post("/x/bulk/", body, format="json")
    force_authenticate(request, user=user or AdminFactory())
    return view.as_view()(request)


def _msgs():
    return [
        ContactMessage.objects.create(
            name=n, email=f"{n.lower()}@x.mx", subject="s", message="m", is_handled=(n == "Done")
        )
        for n in ("Ana", "Beto", "Done", "BOOM")
    ]


class TestContract:
    def test_response_shape_and_per_row_isolation(self):
        ana, beto, done, boom = _msgs()
        CALLS.clear()
        resp = _post({"action": "mark_handled", "ids": [ana.pk, beto.pk, done.pk, boom.pk, 999999]})
        assert resp.status_code == 200
        assert resp.data == {
            "action": "mark_handled",
            "requested": 5,
            "ok": 2,
            "failed": [
                {"id": boom.pk, "error": "Error inesperado: fila envenenada"},
                {"id": 999999, "error": "No encontrado."},
            ],
            "skipped": [{"id": done.pk, "reason": "Ya estaba atendido."}],
            "dry_run": False,
        }
        assert ContactMessage.objects.filter(is_handled=True).count() == 3
        assert CALLS == [[ana.pk, beto.pk]]  # batched side effects, once, ok rows only

    def test_per_row_and_summary_audit(self):
        ana, beto, done, boom = _msgs()
        admin = AdminFactory()
        _post(
            {"action": "mark_handled", "ids": [ana.pk, done.pk], "payload": {"note": "limpieza"}},
            user=admin,
        )
        rows = AuditLog.objects.filter(
            object_type="core.contactmessage", context="bulk:core.contactmessage:mark_handled"
        )
        assert rows.count() == 1
        entry = rows.get()
        assert entry.object_id == str(ana.pk) and entry.actor == admin
        assert entry.changes == {
            "bulk": "mark_handled",
            "note": "limpieza",
            "is_handled": [False, True],
        }
        summary = AuditLog.objects.get(object_type="bulk:core.contactmessage")
        assert summary.object_id == "mark_handled"
        assert summary.changes == {
            "requested": 2,
            "ok": 1,
            "failed": 0,
            "skipped": 1,
            "payload": {"note": "limpieza"},
        }

    def test_dry_run_reports_the_plan_without_writes(self):
        ana, beto, done, boom = _msgs()
        resp = _post({"action": "mark_handled", "ids": [ana.pk, done.pk, boom.pk], "dry_run": True})
        assert resp.data["dry_run"] is True
        assert resp.data["ok"] == 2 and resp.data["failed"] == []
        assert resp.data["skipped"] == [{"id": done.pk, "reason": "Ya estaba atendido."}]
        assert ContactMessage.objects.filter(is_handled=True).count() == 1
        assert not AuditLog.objects.filter(object_type__startswith="bulk:").exists()

    def test_validation_errors(self):
        ana = _msgs()[0]
        assert _post({"action": "nope", "ids": [ana.pk]}).status_code == 400
        assert _post({"action": "mark_handled"}).status_code == 400
        resp = _post({"action": "reopen", "ids": [ana.pk]})
        assert resp.status_code == 400 and resp.data == {"note": ["Indique el motivo."]}
        assert (
            _post({"action": "reopen", "ids": [ana.pk], "payload": {"note": "x"}}).data["ok"] == 1
        )

    def test_ids_cap_is_413(self):
        resp = _post({"action": "mark_handled", "ids": list(range(1, 502))})
        assert resp.status_code == 413
        assert resp.data == {"detail": "Acote los filtros: el límite es 500 filas."}

    def test_all_matching_reuses_the_list_filters_and_is_capped(self):
        ana, beto, done, boom = _msgs()
        resp = _post(
            {
                "action": "mark_handled",
                "all_matching": True,
                "filters": {"handled": "0", "q": "a"},
                "dry_run": True,
            }
        )
        # Unhandled rows whose name contains "a": Ana and Beto? No: Beto has no "a".
        assert resp.data["requested"] == 1 and resp.data["ok"] == 1

        class Capped(ContactBulkView):
            max_matching = 1

        resp = _post({"action": "mark_handled", "all_matching": True, "filters": {}}, view=Capped)
        assert resp.status_code == 413
        assert resp.data == {"detail": "Acote los filtros: el límite es 1 filas."}

    def test_throttle_scope_and_permissions(self, parent_user):
        assert ContactBulkView.throttle_scope == "admin-bulk"
        assert _post({"action": "mark_handled", "ids": [1]}, user=parent_user).status_code == 403


# ── transition-table actions ──────────────────────────────
ENTITY = "admissions.preregistration"
CONTACT = status_action("contact", "Marcar contactado", entity=ENTITY, target="contacted")
BACK_TO_PENDING = status_action("pending", "Regresar a pendiente", entity=ENTITY, target="pending")


def _pre(status):
    return PreRegistration.objects.create(
        child_first_name="A",
        child_last_name="B",
        child_dob="2019-01-01",
        level="primaria",
        grade_applying="1",
        parent_name="P",
        parent_email="p@x.mx",
        parent_phone="1",
        status=status,
    )


class TestStatusActions:
    def test_table_skips_and_applies(self):
        pending, contacted, enrolled = _pre("pending"), _pre("contacted"), _pre("enrolled")
        result = run_bulk(
            PreRegistration.objects.all(),
            [pending.pk, contacted.pk, enrolled.pk],
            CONTACT,
            {},
            AdminFactory(),
            entity=ENTITY,
        )
        assert result["ok"] == 1
        assert result["skipped"] == [
            {"id": contacted.pk, "reason": "Ya está en estado «Contactado»."},
            {"id": enrolled.pk, "reason": "No se puede pasar de «Inscrito» a «Contactado»."},
        ]
        pending.refresh_from_db()
        assert pending.status == "contacted"
        entry = AuditLog.objects.get(
            object_type="admissions.preregistration",
            object_id=str(pending.pk),
            context="bulk:admissions.preregistration:contact",
        )
        assert entry.changes["status"] == ["pending", "contacted"]

    def test_reverse_requires_a_note_and_dry_run_agrees(self):
        rejected = _pre("rejected")
        plan = run_bulk(
            PreRegistration.objects.all(),
            [rejected.pk],
            BACK_TO_PENDING,
            {},
            AdminFactory(),
            entity=ENTITY,
            dry_run=True,
        )
        assert plan["failed"] == [
            {"id": rejected.pk, "error": "Indique el motivo para revertir el estado."}
        ]
        real = run_bulk(
            PreRegistration.objects.all(),
            [rejected.pk],
            BACK_TO_PENDING,
            {},
            AdminFactory(),
            entity=ENTITY,
        )
        assert real["failed"] == plan["failed"]
        rejected.refresh_from_db()
        assert rejected.status == "rejected"
        ok = run_bulk(
            PreRegistration.objects.all(),
            [rejected.pk],
            BACK_TO_PENDING,
            {"note": "la familia volvió a llamar"},
            AdminFactory(),
            entity=ENTITY,
        )
        assert ok["ok"] == 1
        rejected.refresh_from_db()
        assert rejected.status == "pending"
        entry = AuditLog.objects.get(object_id=str(rejected.pk), context__startswith="bulk:")
        assert entry.changes["note"] == "la familia volvió a llamar"

    def test_chunks_lock_and_process_every_row(self):
        rows = [_pre("pending") for _ in range(7)]
        result = run_bulk(
            PreRegistration.objects.all(),
            [r.pk for r in rows],
            CONTACT,
            {},
            AdminFactory(),
            entity=ENTITY,
            chunk=3,
        )
        assert result["ok"] == 7
        assert PreRegistration.objects.filter(status="contacted").count() == 7
