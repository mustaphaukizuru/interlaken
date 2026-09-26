"""Data Ops Phase 8: CMS lists on the list contract, exports, bulk, imports, .ics."""

import io
from datetime import date, timedelta

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from apps.accounts.factories import AdminFactory, UserFactory
from apps.accounts.models import User
from apps.content.forms import FormDefinition, FormSubmission, build_search_text
from apps.content.media import MediaAsset
from apps.content.models import SchoolEvent, Testimonial
from apps.content.navigation import Redirect
from apps.content.ops import ICS_CACHE_KEY, TESTIMONIALS_CACHE_KEY, referenced_media_ids
from apps.content.pages import Page
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db


def _body(resp) -> str:
    raw = b"".join(resp.streaming_content) if resp.streaming else resp.content
    return raw.decode("utf-8-sig")


def _csv(text: str, name="archivo.csv"):
    upload = io.BytesIO(text.encode("utf-8"))
    upload.name = name
    return upload


def _png(color=(64, 26, 142), name="a.png"):
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(buf, format="PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


def _bulk(client, url_name, action, ids=(), **extra):
    body = {"action": action, "ids": list(ids), **extra}
    return client.post(reverse(url_name), body, format="json")


# ── Calendario ────────────────────────────────────────────
class TestCalendar:
    def _events(self):
        a = SchoolEvent.objects.create(
            title="Examen bimestral", kind="exam", start_date=date(2026, 10, 5), level="primaria"
        )
        b = SchoolEvent.objects.create(
            title="Vacaciones de invierno",
            kind="vacation",
            start_date=date(2026, 12, 18),
            end_date=date(2027, 1, 6),
            is_published=False,
        )
        c = SchoolEvent.objects.create(
            title="Junta de padres", kind="meeting", start_date=date(2026, 9, 1)
        )
        return a, b, c

    def test_list_contract_search_filters_ordering(self, admin_client):
        a, b, c = self._events()
        url = reverse("admin-calendar")
        r = admin_client.get(url)
        assert r.data["count"] == 3
        assert [e["id"] for e in r.data["results"]] == [c.pk, a.pk, b.pk]  # start_date asc
        assert [e["id"] for e in admin_client.get(url + "?ordering=-start").data["results"]] == [
            b.pk,
            a.pk,
            c.pk,
        ]
        assert [e["id"] for e in admin_client.get(url + "?q=junta").data["results"]] == [c.pk]
        assert admin_client.get(url + "?kind=exam").data["count"] == 1
        assert admin_client.get(url + "?published=0").data["results"][0]["id"] == b.pk
        assert admin_client.get(url + "?level=primaria").data["count"] == 1
        # Overlap: the vacation (Dec 18 – Jan 6) is inside January.
        assert [
            e["id"]
            for e in admin_client.get(url + "?from=2027-01-01&to=2027-01-31").data["results"]
        ] == [b.pk]
        assert len(admin_client.get(url + "?page_size=1").data["results"]) == 1

    def test_export_csv_and_xlsx_are_audited(self, admin_client):
        self._events()
        r = admin_client.get(reverse("admin-calendar-export") + "?fmt=csv&kind=exam")
        text = _body(r)
        assert "Examen bimestral" in text and "Vacaciones" not in text
        x = admin_client.get(reverse("admin-calendar-export") + "?fmt=xlsx")
        assert x.status_code == 200 and x.content[:2] == b"PK"
        assert AuditLog.objects.filter(object_type="export:content.schoolevent").count() == 2
        assert admin_client.post(reverse("admin-calendar-export"), {}).status_code == 405

    def test_bulk_publish_dry_run_then_commit(self, admin_client):
        a, b, c = self._events()
        dry = _bulk(admin_client, "admin-calendar-bulk", "publish", [a.pk, b.pk], dry_run=True)
        assert dry.data["ok"] == 1 and dry.data["skipped"][0]["id"] == a.pk
        b.refresh_from_db()
        assert b.is_published is False
        cache.set(ICS_CACHE_KEY, "stale")
        r = _bulk(admin_client, "admin-calendar-bulk", "publish", [a.pk, b.pk])
        assert r.data["ok"] == 1
        b.refresh_from_db()
        assert b.is_published is True
        assert cache.get(ICS_CACHE_KEY) is None
        assert AuditLog.objects.filter(
            object_type="content.schoolevent", object_id=str(b.pk)
        ).exists()
        assert AuditLog.objects.filter(object_type="bulk:content.schoolevent").exists()
        r = _bulk(
            admin_client,
            "admin-calendar-bulk",
            "delete",
            all_matching=True,
            filters={"kind": "exam"},
        )
        assert r.data["ok"] == 1 and not SchoolEvent.objects.filter(pk=a.pk).exists()
        deleted = AuditLog.objects.get(action="delete", object_type="content.schoolevent")
        assert deleted.object_id == str(a.pk)

    def test_single_crud_is_audited(self, admin_client):
        r = admin_client.post(
            reverse("admin-calendar"),
            {"title": "Kermés", "kind": "event", "start_date": "2026-11-07"},
            format="json",
        )
        pk = r.data["id"]
        admin_client.patch(
            reverse("admin-calendar-detail", args=[pk]), {"title": "Kermés 2026"}, format="json"
        )
        admin_client.delete(reverse("admin-calendar-detail", args=[pk]))
        actions = list(
            AuditLog.objects.filter(object_type="content.schoolevent", object_id=str(pk))
            .order_by("pk")
            .values_list("action", flat=True)
        )
        assert actions == ["create", "update", "delete"]

    def test_import_dry_run_dedupe_and_commit(self, admin_client):
        SchoolEvent.objects.create(
            title="Junta de padres", kind="meeting", start_date=date(2026, 9, 1)
        )
        csv = (
            "titulo,tipo,inicio,fin,nivel,descripcion,publicado\r\n"
            "Junta de padres,junta,01/09/2026,,todos,Salón 3,sí\r\n"
            "Día de muertos,suspension,02/11/2026,,,,\r\n"
            "Día de muertos,suspension,02/11/2026,,,,\r\n"
            "Mal,evento,05/11/2026,01/11/2026,,,\r\n"
            "Sin fecha,evento,,,,,\r\n"
        )
        url = reverse("admin-calendar-import")
        dry = admin_client.post(url, {"file": _csv(csv), "dry_run": "1"}, format="multipart")
        assert dry.status_code == 200, dry.data
        actions = [row["action"] for row in dry.data["rows"]]
        assert actions == ["actualizar", "crear", "error", "error", "error"]
        assert "Duplicado de la fila 3" in dry.data["rows"][2]["errors"][0]
        refused = admin_client.post(url, {"file": _csv(csv), "dry_run": "0"}, format="multipart")
        assert refused.status_code == 400
        report = admin_client.post(url, {"file": _csv(csv), "report": "csv"}, format="multipart")
        assert "resultado" in report.content.decode("utf-8-sig")
        done = admin_client.post(
            url, {"file": _csv(csv), "dry_run": "0", "valid_only": "1"}, format="multipart"
        )
        assert done.status_code == 200 and done.data["dry_run"] is False
        assert SchoolEvent.objects.get(title="Junta de padres").description == "Salón 3"
        holiday = SchoolEvent.objects.get(title="Día de muertos")
        assert holiday.kind == "holiday" and holiday.is_published is True
        assert AuditLog.objects.filter(object_type="import:content.schoolevent").exists()

    def test_import_template(self, admin_client):
        r = admin_client.get(reverse("admin-calendar-import-template") + "?fmt=csv")
        assert r.content.decode("utf-8-sig").startswith(
            "titulo,tipo,inicio,fin,nivel,descripcion,publicado"
        )

    def test_ics_feed_published_only_folded_and_cached(self, api_client):
        today = date.today()
        long_desc = "Ceremonia de clausura con entrega de reconocimientos, " * 3
        SchoolEvent.objects.create(
            title="Clausura",
            kind="event",
            start_date=today + timedelta(days=10),
            end_date=today + timedelta(days=11),
            description=long_desc,
        )
        SchoolEvent.objects.create(
            title="Oculto", kind="event", start_date=today + timedelta(days=3), is_published=False
        )
        r = api_client.get(reverse("school-calendar-ics"))
        assert r.status_code == 200 and r["Content-Type"].startswith("text/calendar")
        assert "max-age=600" in r["Cache-Control"]
        body = r.content.decode("utf-8")
        assert "Clausura" in body and "Oculto" not in body
        start = (today + timedelta(days=10)).strftime("%Y%m%d")
        end = (today + timedelta(days=12)).strftime("%Y%m%d")  # DTEND is exclusive
        assert f"DTSTART;VALUE=DATE:{start}" in body and f"DTEND;VALUE=DATE:{end}" in body
        assert all(len(line.encode("utf-8")) <= 75 for line in body.split("\r\n"))
        assert "\r\n " in body  # the long DESCRIPTION was folded
        assert cache.get(ICS_CACHE_KEY) == body


# ── Testimonios ───────────────────────────────────────────
class TestTestimonials:
    def test_list_bulk_and_inline_order(self, admin_client):
        t1 = Testimonial.objects.create(quote="Excelente", author="Ana", order=2)
        t2 = Testimonial.objects.create(
            quote="Muy bien", author="Luis", order=1, is_published=False
        )
        url = reverse("admin-testimonials")
        assert [t["id"] for t in admin_client.get(url).data["results"]] == [t2.pk, t1.pk]
        assert admin_client.get(url + "?q=luis").data["count"] == 1
        assert admin_client.get(url + "?published=1").data["results"][0]["id"] == t1.pk
        cache.set(TESTIMONIALS_CACHE_KEY, ["stale"])
        r = _bulk(admin_client, "admin-testimonials-bulk", "publish", [t1.pk, t2.pk])
        assert r.data["ok"] == 1 and len(r.data["skipped"]) == 1
        assert cache.get(TESTIMONIALS_CACHE_KEY) is None
        admin_client.patch(
            reverse("admin-testimonial-detail", args=[t1.pk]), {"order": 0}, format="json"
        )
        assert AuditLog.objects.filter(
            object_type="content.testimonial", object_id=str(t1.pk), changes__order=[2, 0]
        ).exists()
        assert "Excelente" in _body(admin_client.get(reverse("admin-testimonials-export")))
        r = _bulk(admin_client, "admin-testimonials-bulk", "delete", [t1.pk, t2.pk])
        assert r.data["ok"] == 2 and Testimonial.objects.count() == 0


# ── Redirecciones ─────────────────────────────────────────
class TestRedirects:
    def test_list_import_bulk_export(self, admin_client):
        Redirect.objects.create(from_path="/viejo", to_path="/nuevo")
        url = reverse("admin-redirects")
        assert admin_client.get(url).data["count"] == 1
        csv = (
            "de,a,permanente\r\n"
            "/viejo,/nuevo,sí\r\n"
            "/inscripciones/,/admisiones,no\r\n"
            "/inscripciones,/otra,\r\n"
            "/api/x,/y,\r\n"
        )
        imp = reverse("admin-redirects-import")
        dry = admin_client.post(imp, {"file": _csv(csv)}, format="multipart")
        assert [r["action"] for r in dry.data["rows"]] == ["omitir", "crear", "error", "error"]
        admin_client.post(
            imp, {"file": _csv(csv), "dry_run": "0", "valid_only": "1"}, format="multipart"
        )
        created = Redirect.objects.get(from_path="/inscripciones")
        assert created.permanent is False
        assert admin_client.get(url + "?q=inscrip").data["count"] == 1
        assert admin_client.get(url + "?permanent=0").data["count"] == 1
        assert "/inscripciones" in _body(admin_client.get(reverse("admin-redirects-export")))
        r = _bulk(admin_client, "admin-redirects-bulk", "delete", [created.pk])
        assert r.data["ok"] == 1 and Redirect.objects.count() == 1


# ── Páginas ───────────────────────────────────────────────
BLOCKS = [{"id": "a", "type": "rich_text", "props": {"html": "<p>Hola</p>"}}]


class TestPages:
    def test_list_contract_and_bulk_rules(self, admin_client, admin_user):
        draft = Page.objects.create(slug="borrador", title="Borrador", draft_blocks=BLOCKS)
        empty = Page.objects.create(slug="vacia", title="Vacía", template="landing")
        live = Page.objects.create(slug="viva", title="Viva", draft_blocks=BLOCKS)
        live.publish(admin_user)
        url = reverse("admin-pages")
        r = admin_client.get(url)
        assert r.data["count"] == 3 and [p["slug"] for p in r.data["results"]] == [
            "borrador",
            "vacia",
            "viva",
        ]
        assert admin_client.get(url + "?status=published").data["results"][0]["id"] == live.pk
        assert admin_client.get(url + "?template=landing").data["count"] == 1
        assert admin_client.get(url + "?q=viva").data["count"] == 1

        pub = _bulk(
            admin_client, "admin-pages-bulk", "publish", [draft.pk, empty.pk, live.pk], dry_run=True
        )
        assert pub.data["ok"] == 1
        assert [f["id"] for f in pub.data["failed"]] == [empty.pk]  # no blocks: check error
        assert [s["id"] for s in pub.data["skipped"]] == [live.pk]
        _bulk(admin_client, "admin-pages-bulk", "publish", [draft.pk])
        draft.refresh_from_db()
        assert draft.status == "published"

        _bulk(admin_client, "admin-pages-bulk", "unpublish", [live.pk])
        live.refresh_from_db()
        assert live.status == "draft"
        delete = _bulk(admin_client, "admin-pages-bulk", "delete", [empty.pk, live.pk])
        assert delete.data["ok"] == 1 and delete.data["skipped"][0]["id"] == live.pk
        assert not Page.objects.filter(pk=empty.pk).exists()
        assert "Borrador" in _body(admin_client.get(reverse("admin-pages-export")))

    def test_staff_lists_but_cannot_bulk_or_export(self, api_client):
        staff = UserFactory(role=User.Role.STAFF)
        api_client.force_authenticate(staff)
        Page.objects.create(slug="x", title="X")
        assert api_client.get(reverse("admin-pages")).data["count"] == 1
        assert _bulk(api_client, "admin-pages-bulk", "delete", [1]).status_code == 403
        assert api_client.get(reverse("admin-pages-export")).status_code == 403


# ── Medios ────────────────────────────────────────────────
class TestMedia:
    def test_duplicate_upload_is_409_with_existing(self, admin_client, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        first = admin_client.post(reverse("admin-media"), {"file": _png()}, format="multipart")
        assert first.status_code == 201
        again = admin_client.post(
            reverse("admin-media"), {"file": _png(name="otra.png")}, format="multipart"
        )
        assert again.status_code == 409
        assert (
            again.data["existing"]["id"] == first.data["id"] and "Ya existe" in again.data["detail"]
        )
        assert MediaAsset.objects.count() == 1
        assert (
            AuditLog.objects.filter(action="create", object_type="content.mediaasset").count() == 1
        )

    def test_references_filters_and_bulk(self, admin_client, settings, tmp_path, admin_user):
        settings.MEDIA_ROOT = str(tmp_path)
        used = MediaAsset.objects.create(filename="usada.png", content_type="image/png", size=10)
        seo = MediaAsset.objects.create(filename="seo.png", content_type="image/png", size=10)
        free = MediaAsset.objects.create(
            filename="libre.jpg", content_type="image/jpeg", size=99, alt="x"
        )
        Page.objects.create(
            slug="p",
            title="P",
            draft_blocks=[
                {"id": "g", "type": "gallery", "props": {"images": [{"image": used.pk}]}}
            ],
            seo={"og_image": f"/api/v1/content/media/{seo.pk}/lg/"},
        )
        assert referenced_media_ids() >= {used.pk, seo.pk}
        url = reverse("admin-media")
        rows = {m["id"]: m for m in admin_client.get(url).data["results"]}
        assert rows[used.pk]["referenced"] is True and rows[free.pk]["referenced"] is False
        assert [m["id"] for m in admin_client.get(url + "?unreferenced=1").data["results"]] == [
            free.pk
        ]
        assert admin_client.get(url + "?type=jpeg").data["count"] == 1
        assert admin_client.get(url + "?missing_alt=1").data["count"] == 2
        assert [m["id"] for m in admin_client.get(url + "?ordering=-size").data["results"]][
            0
        ] == free.pk

        tag = _bulk(
            admin_client,
            "admin-media-bulk",
            "add_tag",
            [used.pk, free.pk],
            payload={"tag": "Campus"},
        )
        assert tag.data["ok"] == 2
        used.refresh_from_db()
        assert used.tags == "campus"
        assert _bulk(
            admin_client, "admin-media-bulk", "add_tag", [used.pk], payload={"tag": "campus"}
        ).data["skipped"]
        delete = _bulk(admin_client, "admin-media-bulk", "delete", [used.pk, seo.pk, free.pk])
        assert delete.data["ok"] == 1 and len(delete.data["skipped"]) == 2
        assert list(MediaAsset.objects.order_by("pk").values_list("pk", flat=True)) == [
            used.pk,
            seo.pk,
        ]
        assert "usada.png" in _body(admin_client.get(reverse("admin-media-export")))


# ── Formularios y envíos ─────────────────────────────────
FIELDS = [
    {"key": "nombre", "label": "Nombre", "type": "text", "required": True},
    {"key": "acepta", "label": "Acepta", "type": "checkbox"},
]


class TestForms:
    def _form(self, **kw):
        return FormDefinition.objects.create(
            slug=kw.pop("slug", "informes"), title=kw.pop("title", "Informes"), fields=FIELDS, **kw
        )

    def test_search_text_is_maintained(self):
        form = self._form()
        sub = FormSubmission.objects.create(
            form=form, data={"nombre": "Lucía Pérez", "acepta": True}, page="/contacto"
        )
        assert sub.search_text == "/contacto Lucía Pérez"
        assert build_search_text({"a": 3, "b": False, "c": ""}) == "3"

    def test_submissions_paginated_search_bulk(self, admin_client):
        form = self._form()
        other = self._form(slug="otro", title="Otro")
        a = FormSubmission.objects.create(form=form, data={"nombre": "Lucía"})
        b = FormSubmission.objects.create(form=form, data={"nombre": "Mario"}, is_handled=True)
        FormSubmission.objects.create(form=other, data={"nombre": "Lucía"})
        url = reverse("admin-form-submissions", args=[form.pk])
        assert admin_client.get(url).data["count"] == 2
        assert [s["id"] for s in admin_client.get(url + "?q=lucía").data["results"]] == [a.pk]
        assert [s["id"] for s in admin_client.get(url + "?handled=1").data["results"]] == [b.pk]
        assert admin_client.get(reverse("admin-form-submissions", args=[999])).status_code == 404

        r = _bulk(
            admin_client,
            "admin-form-submissions-bulk",
            "mark_handled",
            all_matching=True,
            filters={"form": form.pk},
        )
        assert r.data["requested"] == 2 and r.data["ok"] == 1 and len(r.data["skipped"]) == 1
        r = _bulk(admin_client, "admin-form-submissions-bulk", "reopen", [a.pk, b.pk])
        assert r.data["ok"] == 2
        export = _body(
            admin_client.get(
                reverse("admin-form-submissions-export", args=[form.pk]) + f"?ids={a.pk}"
            )
        )
        assert "Nombre" in export and "Lucía" in export and "Mario" not in export
        r = _bulk(admin_client, "admin-form-submissions-bulk", "delete", [a.pk])
        assert r.data["ok"] == 1 and FormSubmission.objects.filter(form=form).count() == 1

    def test_forms_list_and_bulk_delete_guard(self, admin_client):
        busy = self._form()
        idle = self._form(slug="vacio", title="Vacío")
        FormSubmission.objects.create(form=busy, data={"nombre": "x"})
        r = admin_client.get(reverse("admin-forms") + "?ordering=-submissions")
        assert [f["id"] for f in r.data["results"]] == [busy.pk, idle.pk]
        assert r.data["results"][0]["submissions_count"] == 1
        d = _bulk(admin_client, "admin-forms-bulk", "delete", [busy.pk, idle.pk])
        assert d.data["ok"] == 1 and d.data["skipped"][0]["id"] == busy.pk
        assert "Informes" in _body(admin_client.get(reverse("admin-forms-export")))


# ── query budgets ─────────────────────────────────────────
@pytest.mark.parametrize("n", [2, 6])
def test_list_query_budgets(api_client, django_assert_num_queries, n):
    admin = AdminFactory()
    api_client.force_authenticate(admin)
    form = FormDefinition.objects.create(slug="f", title="F", fields=FIELDS)
    for i in range(n):
        SchoolEvent.objects.create(title=f"E{i}", start_date=date(2026, 10, i + 1))
        Testimonial.objects.create(quote="q", author=f"A{i}")
        Redirect.objects.create(from_path=f"/r{i}", to_path="/x")
        FormSubmission.objects.create(form=form, data={"nombre": f"N{i}"})
        Page.objects.create(slug=f"p{i}", title=f"P{i}")
    # count + page for each list; forms inbox also resolves the form (1).
    for name, args, budget in (
        ("admin-calendar", [], 2),
        ("admin-testimonials", [], 2),
        ("admin-redirects", [], 2),
        ("admin-pages", [], 2),
        ("admin-forms", [], 2),
        ("admin-form-submissions", [form.pk], 3),
    ):
        with django_assert_num_queries(budget):
            assert api_client.get(reverse(name, args=args)).status_code == 200


# ── C2: backend whitelists == frontend *_ORDERING_KEYS ────
def test_ordering_whitelists_match_the_frontend_constants():
    import re
    from pathlib import Path

    from apps.content.forms import FORM_ORDERING, SUBMISSION_ORDERING
    from apps.content.media import MEDIA_ORDERING
    from apps.content.navigation import REDIRECT_ORDERING
    from apps.content.pages import PAGE_ORDERING
    from apps.content.views import CALENDAR_ORDERING, TESTIMONIAL_ORDERING
    from apps.portal.views import ANNOUNCEMENT_ORDERING

    source = (
        Path(__file__).resolve().parents[3] / "frontend/src/hooks/queries/AdminContentQueries.ts"
    )
    if not source.exists():  # backend-only checkout (Docker build context)
        pytest.skip("frontend sources not available")
    text = source.read_text(encoding="utf-8")

    def keys(name):
        match = re.search(rf"{name} = \[([^\]]*)\]", text)
        assert match, name
        return set(re.findall(r"'([^']+)'", match.group(1)))

    assert keys("ANNOUNCEMENT_ORDERING_KEYS") == set(ANNOUNCEMENT_ORDERING)
    assert keys("PAGE_ORDERING_KEYS") == set(PAGE_ORDERING)
    assert keys("MEDIA_ORDERING_KEYS") == set(MEDIA_ORDERING)
    assert keys("FORM_ORDERING_KEYS") == set(FORM_ORDERING)
    assert keys("SUBMISSION_ORDERING_KEYS") == set(SUBMISSION_ORDERING)
    assert keys("REDIRECT_ORDERING_KEYS") == set(REDIRECT_ORDERING)
    assert keys("TESTIMONIAL_ORDERING_KEYS") == set(TESTIMONIAL_ORDERING)
    assert keys("CALENDAR_ORDERING_KEYS") == set(CALENDAR_ORDERING)
