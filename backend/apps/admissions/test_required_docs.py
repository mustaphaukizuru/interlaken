"""Fase 4: required documents by school level.

The seeded list (migration 0013, forward and backward), the level of a
registration, the computed status of each document, the console CRUD and its
permissions, the staff checklist with manual states, the reminder (email and
WhatsApp), uploads by key with several files, and the public list.
"""

import importlib

import pytest
from django.apps import apps as django_apps
from django.core import mail
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, UserFactory
from apps.accounts.models import User
from apps.admissions.models import (
    Registration,
    RegistrationDocument,
    RegistrationDocumentState,
    RequiredDocument,
)
from apps.admissions.required_docs import (
    MAX_FILES_PER_DOCUMENT,
    build_checklist,
    documents_complete,
    registration_level,
)
from apps.admissions.tokens import issue_session
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

PRIMARIA = {
    "ficha",
    "fotografia",
    "acta-nacimiento",
    "curp-alumno",
    "curp-padres",
    "ine-padres",
    "comprobante-domicilio",
    "boleta-sep",
    "boleta-interna",
    "certificado-preescolar",
    "constancia-no-adeudo",
}


@pytest.fixture(autouse=True)
def _env(settings, tmp_path):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.MEDIA_ROOT = str(tmp_path)


@pytest.fixture
def admin(api_client):
    api_client.force_authenticate(AdminFactory())
    return api_client


def _reg(**o):
    base = dict(
        child_first_name="Beto",
        child_last_name="Prueba",
        child_dob="2018-01-01",
        level="primaria",
        grade_applying="2° Primaria",
        parent1_name="Tutora Prueba",
        parent1_email="tutora@test.mx",
        parent1_phone="55 1111 2222",
        status=Registration.Status.SUBMITTED,
    )
    base.update(o)
    return Registration.objects.create(**base)


def _rd(key):
    return RequiredDocument.objects.get(key=key)


def _file(reg, key, status="pending", note="", name="archivo.pdf"):
    d = RegistrationDocument(
        registration=reg,
        doc_type="other",
        required_document=_rd(key),
        filename=name,
        status=status,
        review_note=note,
        is_verified=status == "approved",
    )
    d.file.save(name, ContentFile(b"%PDF-1.4"), save=False)
    d.save()
    return d


def _items(reg, **kw):
    reg = Registration.objects.prefetch_related("documents", "document_states").get(pk=reg.pk)
    return {i["key"]: i for i in build_checklist(reg, **kw)["items"]}


def _approve_all(reg, level="primaria"):
    for rd in RequiredDocument.objects.filter(kind="upload"):
        if level in rd.levels:
            _file(reg, rd.key, status="approved")


# ── the seeded list ──────────────────────────────────────────────────────
class TestSeed:
    def test_per_level_counts_match_the_flyers(self):
        docs = list(RequiredDocument.objects.all())
        assert len(docs) == 13
        per_level = {
            lvl: {d.key for d in docs if lvl in d.levels}
            for lvl in ("preescolar", "primaria", "secundaria")
        }
        # 9 documents + the ficha; 10 + the ficha; 10 + the ficha.
        assert len(per_level["preescolar"]) == 10
        assert per_level["primaria"] == PRIMARIA
        assert len(per_level["secundaria"]) == 11
        assert "cartilla-vacunacion" in per_level["preescolar"] - per_level["primaria"]
        assert "certificado-primaria" in per_level["secundaria"] - per_level["primaria"]
        assert "constancia-no-adeudo" not in per_level["preescolar"]

    def test_rows_carry_kind_physical_note_and_order(self):
        ficha = _rd("ficha")
        assert ficha.kind == "ficha" and ficha.order == 1
        acta = _rd("acta-nacimiento")
        assert acta.physical_note == "Original y 2 copias" and acta.link_url.startswith(
            "https://www.gob.mx/"
        )
        assert (
            _rd("ine-padres").multiple_files is True and _rd("fotografia").multiple_files is False
        )
        assert [d.key for d in RequiredDocument.objects.all()][-1] == "constancia-no-adeudo"


class TestMigration:
    def _mig(self):
        return importlib.import_module("apps.admissions.migrations.0013_required_documents")

    def test_backwards_then_forwards_relinks_legacy_uploads(self):
        reg = _reg()
        legacy = RegistrationDocument.objects.create(
            registration=reg,
            doc_type="birth_cert",
            filename="acta.pdf",
            file=SimpleUploadedFile("acta.pdf", b"%PDF"),
        )
        other = RegistrationDocument.objects.create(
            registration=reg,
            doc_type="other",
            filename="x.pdf",
            file=SimpleUploadedFile("x.pdf", b"%PDF"),
        )
        RegistrationDocumentState.objects.create(
            registration=reg, required_document=_rd("ine-padres"), state="no_aplica"
        )

        self._mig().backwards(django_apps, None)
        assert (
            RequiredDocument.objects.count() == 0 and RegistrationDocumentState.objects.count() == 0
        )
        legacy.refresh_from_db()
        assert legacy.required_document_id is None

        self._mig().forwards(django_apps, None)
        self._mig().forwards(django_apps, None)  # idempotent
        assert RequiredDocument.objects.count() == 13
        legacy.refresh_from_db()
        other.refresh_from_db()
        assert legacy.required_document.key == "acta-nacimiento"
        assert other.required_document_id is None


# ── level and status ─────────────────────────────────────────────────────
class TestLevel:
    @pytest.mark.parametrize(
        "level,grade,expected",
        [
            ("preescolar", "Maternal", "preescolar"),
            ("", "Maternal", "preescolar"),
            ("primaria", "3° Secundaria", "secundaria"),
            ("Preescolar", "", "preescolar"),
            ("maternal", "Kinder", "preescolar"),
            ("", "", ""),
        ],
    )
    def test_registration_level(self, level, grade, expected):
        assert registration_level(Registration(level=level, grade_applying=grade)) == expected

    def test_preescolar_and_unknown_level_lists(self):
        pre = _items(_reg(level="preescolar", grade_applying="Maternal"))
        assert (
            "cartilla-vacunacion" in pre and "certificado-preescolar" not in pre and len(pre) == 10
        )
        unknown = _items(_reg(level="", grade_applying=""))
        # Only what every level asks for: never another level's certificate.
        assert "cartilla-vacunacion" not in unknown and "constancia-no-adeudo" not in unknown
        assert len(unknown) == 9


class TestStatus:
    def test_each_status_in_precedence(self):
        reg = _reg()
        _file(reg, "fotografia", status="approved")
        _file(reg, "acta-nacimiento", status="pending")
        _file(reg, "curp-alumno", status="rejected", note="No se lee")
        _file(reg, "boleta-sep", status="approved")
        RegistrationDocumentState.objects.create(
            registration=reg, required_document=_rd("boleta-sep"), state="entregado_fisico"
        )
        _file(reg, "comprobante-domicilio", status="approved")
        RegistrationDocumentState.objects.create(
            registration=reg,
            required_document=_rd("comprobante-domicilio"),
            state="no_aplica",
            note="Vive con los abuelos",
        )
        items = _items(reg)
        assert items["ficha"]["status"] == "aprobado"  # the ficha was sent
        assert items["fotografia"]["status"] == "aprobado"
        assert items["acta-nacimiento"]["status"] == "en_revision"
        assert items["curp-alumno"]["status"] == "rechazado" and items["curp-alumno"][
            "reasons"
        ] == ["No se lee"]
        assert items["boleta-sep"]["status"] == "entregado_fisico"
        assert items["comprobante-domicilio"]["status"] == "no_aplica"
        assert items["comprobante-domicilio"]["manual"]["note"] == "Vive con los abuelos"
        assert items["ine-padres"]["status"] == "falta" and items["ine-padres"]["can_upload"]

    def test_counts_missing_and_complete(self):
        reg = _reg()
        _file(reg, "curp-alumno", status="rejected", note="No se lee")
        RegistrationDocumentState.objects.create(
            registration=reg, required_document=_rd("ine-padres"), state="no_aplica"
        )
        reg = Registration.objects.prefetch_related("documents", "document_states").get(pk=reg.pk)
        c = build_checklist(reg)
        assert c["level"] == "primaria" and c["counts"]["total"] == 10  # 11 minus «No aplica»
        assert c["counts"]["done"] == 1 and c["counts"]["not_applicable"] == 1
        assert c["complete"] is False
        assert "CURP del alumno (por corregir: No se lee)" in c["missing"]
        assert "INE de papá y mamá" not in c["missing"] and "Ficha de inscripción" not in " ".join(
            c["missing"]
        )

    def test_draft_ficha_is_missing_and_said_to_be_online(self):
        reg = _reg(status=Registration.Status.DRAFT)
        reg = Registration.objects.prefetch_related("documents", "document_states").get(pk=reg.pk)
        c = build_checklist(reg)
        assert c["items"][0]["key"] == "ficha" and c["items"][0]["status"] == "falta"
        assert c["missing"][0] == "Ficha de inscripción (se llena en línea)"

    def test_several_files_need_every_one_approved(self):
        reg = _reg()
        _file(reg, "ine-padres", status="approved", name="papa.pdf")
        bad = _file(reg, "ine-padres", status="rejected", note="Falta el reverso", name="mama.pdf")
        assert _items(reg)["ine-padres"]["status"] == "rechazado"
        bad.status, bad.review_note = "approved", ""
        bad.save()
        assert _items(reg)["ine-padres"]["status"] == "aprobado"

    def test_documents_complete(self):
        reg = _reg()
        assert documents_complete(reg) is False
        _approve_all(reg)
        assert documents_complete(reg) is True
        # A file from before Fase 4 (legacy doc_type only) still counts for its document.
        reg2 = _reg(child_first_name="Legado")
        _approve_all(reg2)
        reg2.documents.filter(required_document__key="acta-nacimiento").delete()
        assert documents_complete(reg2) is False
        RegistrationDocument.objects.create(
            registration=reg2,
            doc_type="birth_cert",
            filename="a.pdf",
            file=SimpleUploadedFile("a.pdf", b"%PDF"),
            status="approved",
            is_verified=True,
        )
        assert documents_complete(reg2) is True


# ── permissions ──────────────────────────────────────────────────────────
ADMIN_URLS = [
    ("get", "admin-required-documents", ()),
    ("post", "admin-required-documents-reorder", ()),
    ("get", "register-checklist", ("reg",)),
    ("post", "register-checklist-reminder", ("reg",)),
]


class TestPermissions:
    @pytest.mark.parametrize("method,name,args", ADMIN_URLS)
    def test_families_teachers_and_anonymous_are_refused(self, api_client, method, name, args):
        reg = _reg()
        url = reverse(name, args=[reg.pk] if args else [])
        assert getattr(api_client, method)(url, {}, format="json").status_code == 401
        api_client.force_authenticate(ParentFactory())
        assert getattr(api_client, method)(url, {}, format="json").status_code == 403
        api_client.force_authenticate(UserFactory(role=User.Role.STAFF, staff_areas=["cafeteria"]))
        assert getattr(api_client, method)(url, {}, format="json").status_code == 403

    def test_the_admisiones_area_reaches_the_console(self, api_client):
        reg = _reg()
        api_client.force_authenticate(UserFactory(role=User.Role.STAFF, staff_areas=["admisiones"]))
        assert api_client.get(reverse("admin-required-documents")).status_code == 200
        assert api_client.get(reverse("register-checklist", args=[reg.pk])).status_code == 200
        url = reverse("register-checklist-state", args=[reg.pk, "ine-padres"])
        assert api_client.put(url, {"state": "no_aplica"}, format="json").status_code == 200

    def test_public_list_needs_no_login(self, api_client):
        assert api_client.get(reverse("required-documents")).status_code == 200


# ── console CRUD ─────────────────────────────────────────────────────────
class TestConsoleList:
    URL = "admin-required-documents"

    def test_list_includes_inactive_with_upload_counts(self, admin):
        _rd("boleta-interna").__class__.objects.filter(key="boleta-interna").update(active=False)
        _file(_reg(), "acta-nacimiento")
        rows = {r["key"]: r for r in admin.get(reverse(self.URL)).data}
        assert len(rows) == 13 and rows["boleta-interna"]["active"] is False
        assert rows["acta-nacimiento"]["upload_count"] == 1

    def test_create_auto_key_goes_last_and_is_audited(self, admin):
        resp = admin.post(
            reverse(self.URL),
            {
                "name": "Carta de buena conducta",
                "levels": ["secundaria", "primaria", "primaria"],
                "physical_note": " Original ",
                "kind": "ficha",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["key"] == "carta-de-buena-conducta" and resp.data["kind"] == "upload"
        assert (
            resp.data["levels"] == ["primaria", "secundaria"]
            and resp.data["physical_note"] == "Original"
        )
        assert resp.data["order"] == 14
        assert AuditLog.objects.filter(
            object_type="admissions.requireddocument",
            action="create",
            object_id=str(resp.data["id"]),
        ).exists()
        again = admin.post(
            reverse(self.URL),
            {"name": "Carta de buena conducta", "levels": ["primaria"]},
            format="json",
        )
        assert again.data["key"] == "carta-de-buena-conducta-2"

    def test_create_needs_a_name_and_a_level(self, admin):
        resp = admin.post(reverse(self.URL), {"name": " ", "levels": []}, format="json")
        assert resp.status_code == 400 and "name" in resp.data and "levels" in resp.data

    def test_update_is_audited_and_the_key_never_changes(self, admin):
        rd = _rd("constancia-no-adeudo")
        url = reverse("admin-required-document", args=[rd.pk])
        resp = admin.patch(
            url,
            {"key": "otra", "name": "Constancia de no adeudo escolar", "active": False},
            format="json",
        )
        assert resp.status_code == 200 and resp.data["key"] == "constancia-no-adeudo"
        log = AuditLog.objects.filter(
            object_type="admissions.requireddocument", action="update"
        ).last()
        assert log.changes["active"] == [True, False] and "name" in log.changes

    def test_delete_rules(self, admin):
        ficha = _rd("ficha")
        assert admin.delete(reverse("admin-required-document", args=[ficha.pk])).status_code == 409
        acta = _rd("acta-nacimiento")
        _file(_reg(), "acta-nacimiento")
        resp = admin.delete(reverse("admin-required-document", args=[acta.pk]))
        assert resp.status_code == 409 and resp.data["code"] == "has_uploads"
        free = _rd("boleta-interna")
        assert admin.delete(reverse("admin-required-document", args=[free.pk])).status_code == 204
        assert not RequiredDocument.objects.filter(key="boleta-interna").exists()
        assert AuditLog.objects.filter(
            object_type="admissions.requireddocument", action="delete"
        ).exists()

    def test_reorder(self, admin):
        last = _rd("constancia-no-adeudo")
        first = _rd("ficha")
        resp = admin.post(
            reverse("admin-required-documents-reorder"), {"ids": [last.pk, first.pk]}, format="json"
        )
        assert resp.status_code == 200
        keys = [r["key"] for r in resp.data]
        assert keys[:3] == ["constancia-no-adeudo", "ficha", "fotografia"]
        assert [r["order"] for r in resp.data] == list(range(1, 14))
        bad = admin.post(
            reverse("admin-required-documents-reorder"), {"ids": [last.pk, last.pk]}, format="json"
        )
        assert bad.status_code == 400


# ── checklist, manual states, reminder ──────────────────────────────────
class TestChecklistApi:
    def test_checklist_payload(self, admin):
        reg = _reg()
        _file(reg, "curp-alumno", status="rejected", note="Borrosa")
        RegistrationDocument.objects.create(
            registration=reg,
            doc_type="other",
            filename="extra.pdf",
            file=SimpleUploadedFile("extra.pdf", b"%PDF"),
        )
        data = admin.get(reverse("register-checklist", args=[reg.pk])).data
        assert data["level"] == "primaria" and data["complete"] is False
        assert data["counts"]["total"] == 11 and data["whatsapp_phone"] == "525511112222"
        curp = next(i for i in data["items"] if i["key"] == "curp-alumno")
        assert curp["files"][0]["review_note"] == "Borrosa"
        assert curp["files"][0]["download_url"].endswith("/download/")
        assert [f["filename"] for f in data["other_files"]] == ["extra.pdf"]

    def test_set_and_clear_a_manual_state(self, admin):
        reg = _reg()
        url = reverse("register-checklist-state", args=[reg.pk, "acta-nacimiento"])
        bad = admin.put(url, {"state": "aprobado"}, format="json")
        assert bad.status_code == 400
        resp = admin.put(
            url, {"state": "entregado_fisico", "note": "Original cotejado"}, format="json"
        )
        acta = next(i for i in resp.data["items"] if i["key"] == "acta-nacimiento")
        assert (
            acta["status"] == "entregado_fisico" and acta["manual"]["note"] == "Original cotejado"
        )
        assert acta["manual"]["updated_by"]
        log = AuditLog.objects.filter(object_type="admissions.registrationdocumentstate").last()
        assert log.action == "create" and log.changes["state"] == [None, "entregado_fisico"]
        resp = admin.put(url, {"state": "no_aplica"}, format="json")
        assert (
            next(i for i in resp.data["items"] if i["key"] == "acta-nacimiento")["status"]
            == "no_aplica"
        )
        resp = admin.delete(url)
        assert (
            next(i for i in resp.data["items"] if i["key"] == "acta-nacimiento")["status"]
            == "falta"
        )
        assert not RegistrationDocumentState.objects.exists()
        assert AuditLog.objects.filter(
            object_type="admissions.registrationdocumentstate", action="delete"
        ).exists()

    def test_email_reminder_lists_exactly_the_missing_ones(self, admin):
        reg = _reg()
        _approve_all(reg)
        reg.documents.filter(required_document__key__in=["ine-padres", "curp-alumno"]).delete()
        _file(reg, "curp-alumno", status="rejected", note="No se lee")
        mail.outbox.clear()
        resp = admin.post(reverse("register-checklist-reminder", args=[reg.pk]), {}, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data["missing"] == [
            "CURP del alumno (por corregir: No se lee)",
            "INE de papá y mamá",
        ]
        body = mail.outbox[-1].body
        assert (
            "• INE de papá y mamá" in body and "• CURP del alumno (por corregir: No se lee)" in body
        )
        assert "Acta de nacimiento" not in body
        assert f"/inscripcion/documentos?rid={reg.pk}&token=" in body
        assert AuditLog.objects.filter(
            object_type="admissions.registration",
            object_id=str(reg.pk),
            context="admissions: recordatorio de documentos",
        ).exists()

    def test_whatsapp_reminder_sends_no_email(self, admin):
        reg = _reg(contact_phone="+52 55 3333 4444")
        mail.outbox.clear()
        resp = admin.post(
            reverse("register-checklist-reminder", args=[reg.pk]),
            {"channel": "whatsapp"},
            format="json",
        )
        assert resp.status_code == 200 and mail.outbox == []
        assert resp.data["whatsapp_phone"] == "525533334444"
        assert "• Fotografía reciente tamaño infantil" in resp.data["whatsapp_text"]
        assert resp.data["upload_url"] in resp.data["whatsapp_text"]
        reg.refresh_from_db()
        assert reg.invite_token_hash and reg.invite_used_at is None

    def test_nothing_missing_is_refused(self, admin):
        reg = _reg()
        _approve_all(reg)
        resp = admin.post(reverse("register-checklist-reminder", args=[reg.pk]), {}, format="json")
        assert resp.status_code == 400 and resp.data["code"] == "nothing_missing"


# ── family page: list and uploads ───────────────────────────────────────
def _pdf(name="doc.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4 data", content_type="application/pdf")


class TestFamilyUploads:
    def _post(self, api_client, reg, token, **data):
        return api_client.post(
            reverse("register-docs", args=[reg.pk]),
            data,
            format="multipart",
            HTTP_X_SESSION_TOKEN=token,
        )

    def test_the_list_is_the_level_with_statuses(self, api_client):
        reg = _reg(level="preescolar", grade_applying="Maternal")
        token = issue_session(reg)
        data = api_client.get(
            reverse("register-docs-list", args=[reg.pk]), HTTP_X_SESSION_TOKEN=token
        ).data
        assert data["level"] == "preescolar" and len(data["items"]) == 10
        assert (
            data["limits"]["max_bytes"] == 10 * 1024 * 1024
            and ".pdf" in data["limits"]["extensions"]
        )
        assert all("note" not in (i["manual"] or {}) for i in data["items"])

    def test_single_file_replaces(self, api_client):
        reg = _reg()
        token = issue_session(reg)
        assert (
            self._post(
                api_client, reg, token, required_key="fotografia", file=_pdf("a.pdf")
            ).status_code
            == 201
        )
        resp = self._post(api_client, reg, token, required_key="fotografia", file=_pdf("b.pdf"))
        assert resp.status_code == 201 and resp.data["required_key"] == "fotografia"
        assert list(reg.documents.values_list("filename", flat=True)) == ["b.pdf"]
        doc = reg.documents.get()
        assert doc.required_document.key == "fotografia" and doc.doc_type == "photo"

    def test_several_files_add_and_replace_a_rejected_one(self, api_client):
        reg = _reg()
        token = issue_session(reg)
        resp = self._post(
            api_client, reg, token, required_key="ine-padres", file=[_pdf("p.pdf"), _pdf("m.pdf")]
        )
        assert resp.status_code == 201 and len(resp.data["documents"]) == 2
        mama = reg.documents.get(filename="m.pdf")
        mama.status, mama.review_note = "rejected", "Falta el reverso"
        mama.save()
        resp = self._post(
            api_client, reg, token, required_key="ine-padres", file=_pdf("m2.pdf"), replaces=mama.pk
        )
        assert resp.status_code == 201
        assert sorted(reg.documents.values_list("filename", flat=True)) == ["m2.pdf", "p.pdf"]
        assert reg.documents.get(filename="m2.pdf").doc_type == "other"

    def test_upload_refusals(self, api_client, settings):
        reg = _reg()
        token = issue_session(reg)
        assert (
            self._post(api_client, reg, token, required_key="ficha", file=_pdf()).status_code == 400
        )
        # Not asked for primaria.
        assert (
            self._post(
                api_client, reg, token, required_key="cartilla-vacunacion", file=_pdf()
            ).status_code
            == 400
        )
        assert (
            self._post(api_client, reg, token, required_key="nope", file=_pdf()).status_code == 400
        )
        resp = self._post(
            api_client, reg, token, required_key="fotografia", file=[_pdf("a.pdf"), _pdf("b.pdf")]
        )
        assert resp.status_code == 400 and "un solo archivo" in resp.data["detail"]
        bad = SimpleUploadedFile("x.svg", b"<svg/>", content_type="image/svg+xml")
        assert (
            self._post(api_client, reg, token, required_key="fotografia", file=bad).status_code
            == 400
        )
        settings.MAX_DOCUMENT_UPLOAD_SIZE = 4
        assert (
            self._post(api_client, reg, token, required_key="fotografia", file=_pdf()).status_code
            == 400
        )
        assert not reg.documents.exists()

    def test_an_approved_document_cannot_be_replaced_by_the_family(self, api_client):
        reg = _reg()
        _file(reg, "fotografia", status="approved")
        token = issue_session(reg)
        resp = self._post(api_client, reg, token, required_key="fotografia", file=_pdf())
        assert resp.status_code == 400 and "aprobado" in resp.data["detail"]
        RegistrationDocumentState.objects.create(
            registration=reg, required_document=_rd("acta-nacimiento"), state="entregado_fisico"
        )
        assert (
            self._post(
                api_client, reg, token, required_key="acta-nacimiento", file=_pdf()
            ).status_code
            == 400
        )

    def test_file_cap_per_document(self, api_client):
        reg = _reg()
        for i in range(MAX_FILES_PER_DOCUMENT):
            _file(reg, "boleta-sep", name=f"b{i}.pdf")
        resp = self._post(
            api_client, reg, issue_session(reg), required_key="boleta-sep", file=_pdf()
        )
        assert resp.status_code == 400 and str(MAX_FILES_PER_DOCUMENT) in resp.data["detail"]

    def test_legacy_doc_type_still_works_and_is_linked(self, api_client):
        reg = _reg()
        resp = self._post(api_client, reg, issue_session(reg), doc_type="birth_cert", file=_pdf())
        assert resp.status_code == 201 and resp.data["required_key"] == "acta-nacimiento"
        assert reg.documents.get().required_document.key == "acta-nacimiento"

    def test_staff_may_upload_any_active_document(self, admin):
        reg = _reg()
        resp = admin.post(
            reverse("register-docs", args=[reg.pk]),
            {"required_key": "cartilla-vacunacion", "file": _pdf()},
            format="multipart",
        )
        assert resp.status_code == 201


class TestReviewNote:
    def test_rejecting_needs_a_reason(self, admin):
        doc = _file(_reg(), "fotografia")
        url = reverse("document-verify", args=[doc.pk])
        assert admin.patch(url, {"status": "rejected"}, format="json").status_code == 400
        assert (
            admin.patch(
                url, {"status": "rejected", "review_note": "Borrosa"}, format="json"
            ).status_code
            == 200
        )


# ── public list ──────────────────────────────────────────────────────────
class TestPublicList:
    def test_all_levels_and_one_level(self, api_client):
        RequiredDocument.objects.filter(key="boleta-interna").update(active=False)
        data = api_client.get(reverse("required-documents")).data
        assert {lvl["value"]: lvl["count"] for lvl in data["levels"]} == {
            "preescolar": 9,
            "primaria": 10,
            "secundaria": 10,
        }
        assert len(data["results"]) == 12 and "boleta-interna" not in {
            r["key"] for r in data["results"]
        }
        acta = next(r for r in data["results"] if r["key"] == "acta-nacimiento")
        assert set(acta) == {
            "key",
            "name",
            "description",
            "physical_note",
            "levels",
            "kind",
            "multiple_files",
            "link_url",
            "link_label",
        }
        pre = api_client.get(reverse("required-documents"), {"level": "preescolar"}).data
        keys = [r["key"] for r in pre["results"]]
        assert (
            "cartilla-vacunacion" in keys
            and "certificado-preescolar" not in keys
            and keys[0] == "ficha"
        )
        assert api_client.get(reverse("required-documents"), {"level": "kinder"}).status_code == 400
