"""
Admisiones on the Data Ops contracts (Phase 4): FilterSets, the inscripciones
list contract, single-row transition guards + audit, bulk actions (pre-registros,
inscripciones, documentos), the fair-sheet import, the bounded pipeline and the
cycle default.
"""

import io
from datetime import timedelta

import pytest
from django.core import mail
from django.core.files.base import ContentFile
from django.urls import reverse
from django.utils import timezone
from openpyxl import Workbook

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.admissions.models import (
    PreRegistration,
    Registration,
    RegistrationDocument,
    current_school_cycle,
)
from apps.admissions.services import RETENTION_PLACEHOLDER
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _locmem(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"


@pytest.fixture
def admin(api_client):
    user = AdminFactory()
    api_client.force_authenticate(user)
    return user


def _pre(**o):
    base = dict(
        child_first_name="Ana",
        child_last_name="Pérez",
        child_dob="2019-01-01",
        level=PreRegistration.Level.PRIMARY,
        grade_applying="Primaria 1°",
        parent_name="Luis Pérez",
        parent_email="luis@test.mx",
        parent_phone="5550000000",
    )
    base.update(o)
    return PreRegistration.objects.create(**base)


def _reg(**o):
    base = dict(
        child_first_name="Beto",
        child_last_name="Ruiz",
        child_dob="2018-01-01",
        level="primaria",
        grade_applying="Primaria 2°",
        parent1_name="Marta Ruiz",
        parent1_email="marta@test.mx",
        parent1_phone="5551111111",
        status=Registration.Status.SUBMITTED,
    )
    base.update(o)
    return Registration.objects.create(**base)


def _doc(reg, doc_type, **o):
    d = RegistrationDocument(registration=reg, doc_type=doc_type, filename=f"{doc_type}.pdf", **o)
    d.file.save(f"{doc_type}.pdf", ContentFile(b"x"), save=False)
    d.save()
    return d


def _names(resp):
    return [r["child_name"] for r in resp.data["results"]]


# ── cycle default ─────────────────────────────────────────
class TestCycleDefault:
    def test_models_default_to_the_running_cycle(self):
        year = timezone.localdate().year
        assert current_school_cycle() == f"{year}-{year + 1}"
        assert _pre().cycle == current_school_cycle()
        assert _reg().cycle == current_school_cycle()

    def test_public_registration_create_stamps_current_cycle(self, api_client):
        resp = api_client.post(
            reverse("register-create"),
            {
                "child_first_name": "Eva",
                "child_last_name": "Luna",
                "child_dob": "2018-05-01",
                "level": "primaria",
                "grade_applying": "Primaria 1°",
                "parent1_name": "Rosa",
                "parent1_email": "rosa@test.mx",
                "parent1_phone": "5512345678",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert Registration.objects.get().cycle == current_school_cycle()


# ── pre-registros list filters ────────────────────────────
class TestPreRegistrationFilters:
    URL = reverse("pre-register")

    def test_status_level_cycle_visit_and_dates(self, api_client, admin):
        old = _pre(child_first_name="Vieja", cycle="2024-2025")
        old.created_at = timezone.now() - timedelta(days=40)
        old.save()
        _pre(child_first_name="Contactada", status="contacted", wants_visit=True)
        _pre(child_first_name="Secu", level=PreRegistration.Level.SECONDARY)
        get = lambda **p: _names(api_client.get(self.URL, p))  # noqa: E731
        assert get(status="contacted") == ["Contactada Pérez"]
        assert get(level="secundaria") == ["Secu Pérez"]
        assert get(cycle="2024-2025") == ["Vieja Pérez"]
        assert get(wants_visit="true") == ["Contactada Pérez"]
        since = (timezone.localdate() - timedelta(days=7)).isoformat()
        assert "Vieja Pérez" not in get(**{"from": since})
        until = (timezone.localdate() - timedelta(days=30)).isoformat()
        assert get(to=until) == ["Vieja Pérez"]

    def test_bad_choice_is_400(self, api_client, admin):
        assert api_client.get(self.URL, {"status": "nope"}).status_code == 400

    def test_list_carries_cycle_and_visit(self, api_client, admin):
        _pre(wants_visit=True)
        row = api_client.get(self.URL).data["results"][0]
        assert row["cycle"] == current_school_cycle() and row["wants_visit"] is True


# ── inscripciones list contract ───────────────────────────
class TestRegistrationList:
    URL = reverse("register-create")

    def test_q_over_names_curp_emails_phones(self, api_client, admin):
        _reg(child_curp="RUXB180101HDFZZZ01")
        _reg(child_first_name="Carla", parent2_email="papa@otro.mx", parent1_phone="5559999999")
        get = lambda q: _names(api_client.get(self.URL, {"q": q}))  # noqa: E731
        assert get("ruxb18") == ["Beto Ruiz"]
        assert get("papa@otro") == ["Carla Ruiz"]
        assert get("5559999999") == ["Carla Ruiz"]
        assert get("marta@test.mx carla") == ["Carla Ruiz"]

    def test_filters_and_ordering(self, api_client, admin):
        _reg(child_first_name="Zeta", status="reviewing", level="secundaria")
        _reg(child_first_name="Alfa", cycle="2024-2025")
        assert _names(api_client.get(self.URL, {"status": "reviewing"})) == ["Zeta Ruiz"]
        assert _names(api_client.get(self.URL, {"level": "Secundaria"})) == ["Zeta Ruiz"]
        assert _names(api_client.get(self.URL, {"cycle": "2024-2025"})) == ["Alfa Ruiz"]
        assert _names(api_client.get(self.URL, {"ordering": "child"})) == ["Alfa Ruiz", "Zeta Ruiz"]
        assert _names(api_client.get(self.URL, {"ordering": "-child"})) == [
            "Zeta Ruiz",
            "Alfa Ruiz",
        ]

    def test_documents_pending(self, api_client, admin, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        done = _reg(child_first_name="Completa")
        for code in (
            "birth_cert",
            "curp_doc",
            "photo",
            "report_card",
            "proof_addr",
            "vaccination",
        ):
            _doc(done, code, is_verified=True, status="approved")
        partial = _reg(child_first_name="Parcial")
        _doc(partial, "birth_cert", is_verified=True, status="approved")
        _doc(partial, "photo")
        assert _names(api_client.get(self.URL, {"documents_pending": "true"})) == ["Parcial Ruiz"]
        assert _names(api_client.get(self.URL, {"documents_pending": "false"})) == ["Completa Ruiz"]

    @pytest.mark.parametrize("n", [3, 12])
    def test_query_budget(self, api_client, django_assert_num_queries, n, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        for i in range(n):
            _doc(_reg(parent1_email=f"p{i}@test.mx"), "photo")
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(3):  # count + page + documents prefetch
            resp = api_client.get(self.URL, {"q": "test.mx", "ordering": "-child", "page_size": 50})
        assert resp.data["count"] == n and resp.data["results"][0]["doc_count"] == 1


# ── single-row guards + audit ─────────────────────────────
class TestSingleRowGuards:
    def test_prereg_patch_audited_and_guarded(self, api_client, admin):
        pre = _pre(status="rejected")
        url = reverse("pre-register-detail", args=[pre.pk])
        bad = api_client.patch(url, {"status": "enrolled"}, format="json")
        assert bad.status_code == 400 and "No se puede pasar" in str(bad.data)
        no_note = api_client.patch(url, {"status": "pending"}, format="json")
        assert no_note.status_code == 400 and "motivo" in str(no_note.data)
        ok = api_client.patch(url, {"status": "pending", "note": "Se reabre"}, format="json")
        assert ok.status_code == 200, ok.data
        pre.refresh_from_db()
        assert pre.status == "pending"
        log = AuditLog.objects.filter(object_type="admissions.preregistration").latest("id")
        assert (
            log.changes["status"] == ["rejected", "pending"] and log.changes["note"] == "Se reabre"
        )
        assert log.actor == admin

    def test_prereg_notes_only_patch(self, api_client, admin):
        pre = _pre(status="enrolled")
        resp = api_client.patch(
            reverse("pre-register-detail", args=[pre.pk]), {"notes": "Llamar"}, format="json"
        )
        assert resp.status_code == 200
        pre.refresh_from_db()
        assert pre.notes == "Llamar" and pre.status == "enrolled"

    def test_registration_status_guard_audit_and_notify(self, api_client, admin):
        reg = _reg()
        url = reverse("register-status", args=[reg.pk])
        assert api_client.patch(url, {"status": "complete"}, format="json").status_code == 400
        mail.outbox.clear()
        ok = api_client.patch(url, {"status": "rejected", "notify": False}, format="json")
        assert ok.status_code == 200 and mail.outbox == []
        assert AuditLog.objects.filter(
            object_type="admissions.registration", object_id=str(reg.pk), actor=admin
        ).exists()
        back = api_client.patch(url, {"status": "reviewing"}, format="json")
        assert back.status_code == 400  # reverse needs a note
        back = api_client.patch(url, {"status": "reviewing", "note": "Error"}, format="json")
        assert back.status_code == 200
        ok = api_client.patch(url, {"status": "approved"}, format="json")
        assert ok.status_code == 200 and any("aprobada" in m.subject.lower() for m in mail.outbox)

    def test_draft_is_frozen_for_the_console(self, api_client, admin):
        reg = _reg(status="draft")
        resp = api_client.patch(
            reverse("register-status", args=[reg.pk]), {"status": "approved"}, format="json"
        )
        assert resp.status_code == 400

    def test_document_verify_is_audited(self, api_client, admin, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        doc = _doc(_reg(), "photo")
        resp = api_client.patch(
            reverse("document-verify", args=[doc.pk]), {"status": "approved"}, format="json"
        )
        assert resp.status_code == 200
        log = AuditLog.objects.get(object_type="admissions.registrationdocument")
        assert log.changes["status"] == ["pending", "approved"]


# ── bulk: pre-registros ───────────────────────────────────
def _bulk(api_client, name, body):
    return api_client.post(reverse(name), body, format="json")


class TestPreRegistrationBulk:
    def test_set_status_dry_run_plan_then_commit(self, api_client, admin):
        a, b = _pre(), _pre(child_first_name="Beto")
        done = _pre(child_first_name="Inscrito", status="enrolled")
        body = {
            "action": "set_status",
            "ids": [a.pk, b.pk, done.pk],
            "payload": {"status": "contacted"},
        }
        plan = _bulk(api_client, "pre-register-bulk", {**body, "dry_run": True})
        assert plan.status_code == 200
        assert plan.data["ok"] == 2 and [s["id"] for s in plan.data["skipped"]] == [done.pk]
        assert PreRegistration.objects.filter(status="contacted").count() == 0
        resp = _bulk(api_client, "pre-register-bulk", body)
        assert resp.data["ok"] == 2
        assert PreRegistration.objects.filter(status="contacted").count() == 2
        rows = AuditLog.objects.filter(object_type="admissions.preregistration", action="update")
        assert rows.count() == 2  # one per row (no duplicate from the service)
        assert AuditLog.objects.filter(object_type="bulk:admissions.preregistration").count() == 1

    def test_reverse_needs_note_only_at_commit(self, api_client, admin):
        pre = _pre(status="contacted")
        body = {"action": "set_status", "ids": [pre.pk], "payload": {"status": "pending"}}
        assert _bulk(api_client, "pre-register-bulk", {**body, "dry_run": True}).data["ok"] == 1
        failed = _bulk(api_client, "pre-register-bulk", body).data
        assert failed["ok"] == 0 and "motivo" in failed["failed"][0]["error"]
        body["payload"]["note"] = "Revertir"
        assert _bulk(api_client, "pre-register-bulk", body).data["ok"] == 1
        pre.refresh_from_db()
        assert pre.status == "pending"

    def test_invalid_target_is_400(self, api_client, admin):
        pre = _pre()
        resp = _bulk(
            api_client,
            "pre-register-bulk",
            {"action": "set_status", "ids": [pre.pk], "payload": {"status": "x"}},
        )
        assert resp.status_code == 400

    def test_all_matching_uses_list_filters(self, api_client, admin):
        _pre(level="secundaria")
        _pre(level="secundaria", child_first_name="Otra")
        keep = _pre(level="primaria")
        resp = _bulk(
            api_client,
            "pre-register-bulk",
            {
                "action": "set_status",
                "all_matching": True,
                "filters": {"level": "secundaria"},
                "payload": {"status": "rejected"},
            },
        )
        assert resp.data["requested"] == 2 and resp.data["ok"] == 2
        keep.refresh_from_db()
        assert keep.status == "pending"

    def test_bulk_invite(self, api_client, admin):
        a = _pre()
        rejected = _pre(child_first_name="No", status="rejected")
        mail.outbox.clear()
        resp = _bulk(
            api_client, "pre-register-bulk", {"action": "invite", "ids": [a.pk, rejected.pk]}
        )
        assert resp.data["ok"] == 1 and resp.data["skipped"][0]["id"] == rejected.pk
        a.refresh_from_db()
        assert a.status == "contacted"
        assert a.registrations.filter(status="draft").count() == 1
        assert [m.to for m in mail.outbox] == [["luis@test.mx"]]

    def test_families_are_forbidden(self, api_client):
        api_client.force_authenticate(ParentFactory())
        for name in ("pre-register-bulk", "register-bulk", "document-bulk"):
            assert _bulk(api_client, name, {"action": "x", "ids": [1]}).status_code == 403


# ── bulk: inscripciones + documentos ──────────────────────
class TestRegistrationBulk:
    def test_approve_notify_flag_and_skips(self, api_client, admin):
        a, b = _reg(), _reg(child_first_name="Dos", parent1_email="dos@test.mx")
        draft = _reg(status="draft")
        mail.outbox.clear()
        body = {"action": "approve", "ids": [a.pk, b.pk, draft.pk], "payload": {"notify": False}}
        plan = _bulk(api_client, "register-bulk", {**body, "dry_run": True}).data
        assert plan["ok"] == 2 and plan["skipped"][0]["id"] == draft.pk
        resp = _bulk(api_client, "register-bulk", body).data
        assert resp["ok"] == 2 and mail.outbox == []
        assert Registration.objects.filter(status="approved").count() == 2

    def test_reject_emails_by_default(self, api_client, admin):
        reg = _reg()
        mail.outbox.clear()
        resp = _bulk(api_client, "register-bulk", {"action": "reject", "ids": [reg.pk]})
        assert resp.data["ok"] == 1 and [m.to for m in mail.outbox] == [["marta@test.mx"]]

    def test_reviewing_reverse_requires_note(self, api_client, admin):
        reg = _reg(status="approved")
        resp = _bulk(api_client, "register-bulk", {"action": "reviewing", "ids": [reg.pk]}).data
        assert resp["ok"] == 0 and resp["failed"]
        resp = _bulk(
            api_client,
            "register-bulk",
            {"action": "reviewing", "ids": [reg.pk], "payload": {"note": "Falta firma"}},
        ).data
        assert resp["ok"] == 1

    def test_request_docs(self, api_client, admin, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        needs = _reg()
        complete = _reg(child_first_name="Todo")
        for code in ("birth_cert", "curp_doc", "photo", "report_card", "proof_addr", "vaccination"):
            _doc(complete, code, is_verified=True, status="approved")
        mail.outbox.clear()
        body = {"action": "request_docs", "ids": [needs.pk, complete.pk]}
        plan = _bulk(api_client, "register-bulk", {**body, "dry_run": True}).data
        assert plan["ok"] == 1 and plan["skipped"][0]["id"] == complete.pk
        resp = _bulk(api_client, "register-bulk", body).data
        assert resp["ok"] == 1 and len(mail.outbox) == 1
        assert "/inscripcion/documentos?rid=" in mail.outbox[0].body


class TestDocumentBulk:
    def test_approve_and_reject_one_email_per_registration(
        self, api_client, admin, settings, tmp_path
    ):
        settings.MEDIA_ROOT = str(tmp_path)
        reg = _reg()
        d1, d2, d3 = _doc(reg, "photo"), _doc(reg, "curp_doc"), _doc(reg, "birth_cert")
        ok = _bulk(api_client, "document-bulk", {"action": "approve", "ids": [d1.pk]}).data
        assert ok["ok"] == 1
        d1.refresh_from_db()
        assert d1.is_verified and d1.status == "approved"
        no_note = _bulk(api_client, "document-bulk", {"action": "reject", "ids": [d2.pk]})
        assert no_note.status_code == 400
        mail.outbox.clear()
        resp = _bulk(
            api_client,
            "document-bulk",
            {"action": "reject", "ids": [d2.pk, d3.pk], "payload": {"note": "Ilegible"}},
        ).data
        assert resp["ok"] == 2 and len(mail.outbox) == 1
        assert "CURP: Ilegible" in mail.outbox[0].body
        d2.refresh_from_db()
        assert d2.status == "rejected" and not d2.is_verified and d2.review_note == "Ilegible"
        again = _bulk(api_client, "document-bulk", {"action": "approve", "ids": [d1.pk]}).data
        assert again["skipped"]


# ── import (fair sheets) ──────────────────────────────────
HEADER = (
    "nombre_alumno,apellidos_alumno,fecha_nacimiento,nivel,grado,nombre_tutor,"
    "correo,telefono,origen,mensaje"
)


def _upload(api_client, text, **data):
    f = io.BytesIO(text.encode("utf-8"))
    f.name = "feria.csv"
    return api_client.post(reverse("pre-register-import"), {"file": f, **data}, format="multipart")


def _dob(age):
    return f"01/03/{timezone.localdate().year - age}"


class TestPreRegistrationImport:
    def test_template_csv_and_xlsx(self, api_client, admin):
        csv_resp = api_client.get(reverse("pre-register-import-template"), {"fmt": "csv"})
        assert csv_resp.status_code == 200
        assert csv_resp.content.decode("utf-8-sig").splitlines()[0] == HEADER
        xlsx = api_client.get(reverse("pre-register-import-template"), {"fmt": "xlsx"})
        assert xlsx.status_code == 200 and xlsx.content[:2] == b"PK"

    def test_dry_run_warns_on_duplicates_and_derives_level(self, api_client, admin):
        _pre(
            child_first_name="Ana",
            child_last_name="Pérez",
            child_dob=f"{timezone.localdate().year - 7}-03-01",
            parent_email="Luis@Test.mx",
        )
        _pre(parent_email=RETENTION_PLACEHOLDER, child_first_name="Purgada")
        rows = [
            HEADER,
            f"Ana,Pérez,{_dob(7)},,Primaria 1°,Luis,luis@test.mx,555,Feria,",
            f"Beto,Gómez,{_dob(7)},primaria,1°,Rosa,rosa@test.mx,,,",
            f"Beto,Gómez,{_dob(7)},primaria,1°,Rosa,ROSA@test.mx,,,",
            "Mal,Fecha,31/02/2019,primaria,1°,Rosa,x@test.mx,,,",
            f"Sin,Nivel,{_dob(7)},,1°,Rosa,y@test.mx,,,",
        ]
        resp = _upload(api_client, "\n".join(rows))
        assert resp.status_code == 200, resp.data
        by_line = {r["line"]: r for r in resp.data["rows"]}
        assert by_line[2]["action"] == "crear" and by_line[2]["data"]["nivel"] == "primaria"
        assert any("Ya existe" in w for w in by_line[2]["warnings"])
        assert by_line[3]["action"] == "crear" and not by_line[3]["warnings"]
        assert (
            by_line[4]["action"] == "crear" and "Duplicado de la fila 3." in by_line[4]["warnings"]
        )
        assert by_line[5]["action"] == "error"
        assert by_line[6]["action"] == "error"
        assert resp.data["counts"] == {"crear": 3, "actualizar": 0, "omitir": 0, "error": 2}
        assert PreRegistration.objects.count() == 2  # dry run wrote nothing

    def test_commit_valid_only_no_emails_pending_current_cycle(self, api_client, admin):
        mail.outbox.clear()
        rows = [
            HEADER,
            f"Ana,Pérez,{_dob(7)},primaria,Primaria 1°,Luis,luis@test.mx,555,Feria,Hola",
            "Mal,Fecha,99/99/2019,primaria,1°,Rosa,x@test.mx,,,",
        ]
        refused = _upload(api_client, "\n".join(rows), dry_run="0")
        assert refused.status_code == 400
        resp = _upload(api_client, "\n".join(rows), dry_run="0", valid_only="1")
        assert resp.status_code == 200, resp.data
        pre = PreRegistration.objects.get()
        assert pre.status == "pending" and pre.cycle == current_school_cycle()
        assert pre.referral_source == "Feria" and pre.message == "Hola"
        assert mail.outbox == []
        assert AuditLog.objects.filter(object_type="import:pre-registros").exists()
        assert AuditLog.objects.filter(
            object_type="admissions.preregistration", context="import:pre-registros"
        ).exists()

    def test_xlsx_upload_and_error_report(self, api_client, admin):
        wb = Workbook()
        ws = wb.active
        ws.append(HEADER.split(","))
        ws.append(["Eva", "Luna", _dob(8), "Primaria", "Primaria 2°", "Rosa", "e@x.mx", "", "", ""])
        ws.append(["", "Sin nombre", _dob(8), "Primaria", "2°", "Rosa", "e2@x.mx", "", "", ""])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        buf.name = "feria.xlsx"
        resp = api_client.post(
            reverse("pre-register-import"), {"file": buf, "report": "csv"}, format="multipart"
        )
        assert resp.status_code == 200
        text = resp.content.decode("utf-8-sig")
        assert text.splitlines()[0].endswith("fila,resultado,errores,avisos")
        assert "Falta nombre_alumno" in text.splitlines()[1]

    def test_missing_required_header_is_400(self, api_client, admin):
        resp = _upload(api_client, "nombre_alumno,correo\nAna,a@x.mx")
        assert resp.status_code == 400 and "expected_headers" in resp.data


# ── pipeline bound ────────────────────────────────────────
class TestPipelineBound:
    def test_old_complete_hidden_unless_all(self, api_client, admin):
        recent = _reg(child_first_name="Reciente", status="complete")
        old = _reg(child_first_name="Antigua", status="complete")
        Registration.objects.filter(pk=old.pk).update(
            updated_at=timezone.now() - timedelta(days=120)
        )
        _reg(child_first_name="Rechazada", status="rejected")

        def complete_names(params):
            data = api_client.get(reverse("admissions-pipeline"), params).data
            col = next(c for c in data["columns"] if c["status"] == "complete")
            return data, {c["child_name"] for c in col["cards"]}

        data, names = complete_names({})
        assert names == {"Reciente Ruiz"} and data["bounded"] is True
        assert data["complete_window_days"] == 90
        data, names = complete_names({"all": "1"})
        assert names == {"Reciente Ruiz", "Antigua Ruiz"} and data["bounded"] is False
        assert recent.pk


# ── C2: ordering whitelist == frontend constants ──────────
def test_ordering_keys_match_the_frontend_constants():
    """frontend/src/hooks/queries/admissions.ts PREREG_ORDERING_KEYS / REG_ORDERING_KEYS."""
    from apps.admissions.views import PREREGISTRATION_ORDERING, REGISTRATION_ORDERING

    assert list(PREREGISTRATION_ORDERING) == [
        "created_at",
        "child",
        "level",
        "grade",
        "status",
        "parent",
    ]
    assert list(REGISTRATION_ORDERING) == [
        "created_at",
        "updated_at",
        "submitted_at",
        "child",
        "level",
        "status",
    ]
