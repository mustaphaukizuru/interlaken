"""
Carga masiva de alumnos on the Data Ops import contract (C4): template,
CSV + XLSX, dry run identical to the commit (including the email checks the
old importer only made at commit time), normalised matrícula, case-insensitive
guardian match, error report, per-row + summary audit, caps, time budget.
"""

import csv
import io
import time

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.accounts.models import StudentProfile, User
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

URL = reverse("import-students")
TEMPLATE_URL = reverse("import-students-template")

HEADER = (
    "matricula,nombre,apellidos,grado,grupo,email_alumno,loyverse_id,"
    "nombre_padre,email_padre,telefono_padre\n"
)


def _csv(*lines, header=HEADER):
    f = io.BytesIO((header + "\n".join(lines)).encode("utf-8-sig"))
    f.name = "alumnos.csv"
    return f


def _xlsx(rows):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    buf.name = "alumnos.xlsx"
    return buf


def _post(client, file, dry_run="1", **extra):
    return client.post(URL, {"file": file, "dry_run": dry_run, **extra}, format="multipart")


@pytest.fixture
def admin(api_client):
    api_client.force_authenticate(AdminFactory())
    return api_client


class TestAccess:
    def test_parent_403(self, api_client, parent_user):
        api_client.force_authenticate(parent_user)
        assert _post(api_client, _csv()).status_code == 403

    def test_anonymous_401(self, api_client):
        assert _post(api_client, _csv()).status_code == 401


class TestTemplate:
    @pytest.mark.parametrize("fmt", ["csv", "xlsx"])
    def test_template_has_the_headers_and_an_example(self, admin, fmt):
        resp = admin.get(TEMPLATE_URL, {"fmt": fmt})
        assert resp.status_code == 200
        if fmt == "csv":
            rows = list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))
            assert rows[0][:4] == ["matricula", "nombre", "apellidos", "grado"]
            assert rows[1][0] == "09932"
        else:
            assert resp.content[:2] == b"PK"


class TestDryRunAndCommit:
    def test_dry_run_writes_nothing(self, admin):
        resp = _post(admin, _csv("INT-001,Ana,García,3° Primaria,A,,,Luis García,luis@x.mx,555"))
        assert resp.status_code == 200
        body = resp.json()
        assert body["dry_run"] is True and body["counts"]["crear"] == 1
        assert body["rows"][0]["warnings"] == ["Se creará la cuenta del tutor luis@x.mx."]
        assert StudentProfile.objects.count() == 0
        assert not User.objects.filter(email="luis@x.mx").exists()

    def test_commit_creates_links_and_audits(self, admin):
        resp = _post(
            admin,
            _csv("INT-001,Ana,García,3° Primaria,A,,LV-9,Luis García,luis@x.mx,555"),
            dry_run="0",
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["counts"]["crear"] == 1
        profile = StudentProfile.objects.get(student_id="INT-001")
        assert profile.grade == "3° Primaria" and profile.loyverse_id == "LV-9"
        assert profile.user.role == User.Role.STUDENT
        assert profile.user.email == "int-001@alumnos.interlaken.edu.mx"
        assert not profile.user.has_usable_password()
        parent = User.objects.get(email="luis@x.mx")
        assert parent.role == User.Role.PARENT and parent.whatsapp == "555"
        assert not parent.has_usable_password()
        assert set(profile.parents.all()) == {profile.user, parent}
        assert AuditLog.objects.filter(
            context="import:students", object_type="accounts.studentprofile", action="create"
        ).exists()
        summary = AuditLog.objects.get(object_type="import:students")
        assert summary.action == "import" and summary.changes["counts"]["crear"] == 1

    def test_reimport_updates_then_is_a_no_op(self, admin):
        row = "INT-001,Ana,García,3° Primaria,A,,,Luis García,luis@x.mx,555"
        _post(admin, _csv(row), dry_run="0")
        changed = "INT-001,Ana,García,4° Primaria,B,,,Luis García,LUIS@X.MX,555"
        body = _post(admin, _csv(changed), dry_run="0").json()
        assert body["counts"]["actualizar"] == 1 and body["counts"]["crear"] == 0
        assert User.objects.filter(email__iexact="luis@x.mx").count() == 1
        profile = StudentProfile.objects.get(student_id="INT-001")
        assert (profile.grade, profile.group) == ("4° Primaria", "B")
        assert profile.parents.count() == 2
        again = _post(admin, _csv(changed)).json()
        assert again["counts"]["omitir"] == 1 and again["rows"][0]["warnings"] == ["Sin cambios."]

    def test_guardian_email_matches_case_insensitively(self, admin):
        parent = ParentFactory(email="mama@example.com")
        _post(admin, _csv("X1,Ana,Ruiz,1° Primaria,,,,,MAMA@Example.com,"), dry_run="0")
        assert parent in StudentProfile.objects.get(student_id="X1").parents.all()
        assert User.objects.filter(email__iexact="mama@example.com").count() == 1

    def test_email_collision_is_caught_by_the_dry_run(self, admin):
        User.objects.create_user(email="x2@alumnos.interlaken.edu.mx", password=None, role="parent")
        body = _post(admin, _csv("X2,Ana,Ruiz,1° Primaria,,,,,,")).json()
        assert body["rows"][0]["action"] == "error"
        assert "ya existe" in body["rows"][0]["errors"][0]

    def test_staff_email_is_not_a_guardian(self, admin):
        staff = User.objects.create_user(email="prof@x.mx", password=None, role="staff")
        body = _post(admin, _csv(f"X3,Ana,Ruiz,1° Primaria,,,,,{staff.email},")).json()
        assert body["rows"][0]["action"] == "error"
        assert "Personal" in body["rows"][0]["errors"][0]

    def test_bad_rows_block_the_commit_unless_valid_only(self, admin):
        file_rows = (
            "INT-001,Ana,García,3° Primaria,,,,,,",
            ",SinMatricula,X,1°,,,,,,",  # missing matrícula
            "INT-003,Beto,Pérez,2° Primaria,,,,Mamá Pérez,,555",  # tutor without email
        )
        refused = _post(admin, _csv(*file_rows), dry_run="0")
        assert refused.status_code == 400 and refused.json()["counts"]["error"] == 2
        assert StudentProfile.objects.count() == 0
        body = _post(admin, _csv(*file_rows), dry_run="0", valid_only="1").json()
        assert body["counts"] == {"crear": 1, "actualizar": 0, "omitir": 0, "error": 2}
        assert list(StudentProfile.objects.values_list("student_id", flat=True)) == ["INT-001"]

    def test_xlsx_upload(self, admin):
        rows = [
            ["Matrícula", "Nombre", "Apellidos", "Grado"],
            ["ci09940", "Sara", "Durán", "2° Secundaria"],
        ]
        body = _post(admin, _xlsx(rows), dry_run="0").json()
        assert body["counts"]["crear"] == 1
        assert StudentProfile.objects.filter(student_id="09940").exists()

    def test_error_report_in_the_upload_format(self, admin):
        resp = _post(admin, _csv("A1,Ana,Ruiz,1° Primaria,,,,,,", ",X,Y,1°,,,,,,"), report="csv")
        assert resp.status_code == 200 and resp["Content-Type"].startswith("text/csv")
        rows = list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))
        assert rows[0][-4:] == ["fila", "resultado", "errores", "avisos"]
        assert rows[1][-3] == "error" and "Falta matricula" in rows[1][-2]

    def test_missing_required_headers_400(self, admin):
        f = io.BytesIO(b"matricula,nombre\nX,Y")
        f.name = "malo.csv"
        resp = _post(admin, f, dry_run="0")
        assert resp.status_code == 400
        assert "apellidos" in resp.json()["detail"] and resp.json()["expected_headers"]


class TestBudget:
    def test_row_cap_is_413(self, admin):
        lines = [f"M{i},A,B,1° Primaria,,,,,," for i in range(2001)]
        assert _post(admin, _csv(*lines)).status_code == 413

    def test_2000_rows_dry_run_and_commit_within_the_time_budget(self, admin):
        existing = StudentProfileFactory(student_id="M0")
        lines = [f"M{i},Nombre{i},Apellido{i},1° Primaria,A,,,,," for i in range(2000)]
        started = time.monotonic()
        body = _post(admin, _csv(*lines)).json()
        dry_run = time.monotonic() - started
        assert body["counts"]["crear"] == 1999 and body["counts"]["actualizar"] == 1
        started = time.monotonic()
        body = _post(admin, _csv(*lines), dry_run="0").json()
        elapsed = time.monotonic() - started
        assert dry_run < 20, f"dry run took {dry_run:.1f}s"
        assert body["counts"]["crear"] == 1999 and body["counts"]["error"] == 0
        assert StudentProfile.objects.count() == 2000
        existing.refresh_from_db()
        assert existing.user.first_name == "Nombre0"
        assert elapsed < 20, f"commit took {elapsed:.1f}s"


class TestQueryBudget:
    """Lookups are loaded for the whole file at once (2026-11-18): a 2,000-row
    file used to cost several queries per row, which against the managed
    database could outlive gunicorn's 60 s worker. The number of queries no
    longer depends on how many rows the file has, except for the writes."""

    @staticmethod
    def _rows(n, start=0):
        return [
            f"Q{i},Nombre{i},Apellido{i},1° Primaria,A,,,Tutor {i},tutor{i}@example.com,555"
            for i in range(start, start + n)
        ]

    @staticmethod
    def _run(client, lines, dry_run="1"):
        with CaptureQueriesContext(connection) as ctx:
            resp = _post(client, _csv(*lines), dry_run=dry_run)
        assert resp.status_code == 200, resp.content
        sql = [q["sql"].lstrip().upper() for q in ctx.captured_queries]
        return sql, resp.json()

    @staticmethod
    def _roster(n):
        """Half the rows already exist (with their self link), every 4th tutor too.

        Bulk-created: the factories hash a password per user, which would make
        this setup take minutes."""
        students = User.objects.bulk_create(
            User(
                email=f"q{i}@alumnos.interlaken.edu.mx",
                first_name=f"Viejo{i}",
                last_name="Alumno",
                role=User.Role.STUDENT,
                password="!",
            )
            for i in range(0, n, 2)
        )
        profiles = StudentProfile.objects.bulk_create(
            StudentProfile(user=u, student_id=f"Q{i}", grade="3° Primaria", group="A")
            for i, u in zip(range(0, n, 2), students, strict=True)
        )
        StudentProfile.parents.through.objects.bulk_create(
            StudentProfile.parents.through(studentprofile_id=p.pk, user_id=p.user_id)
            for p in profiles
        )
        User.objects.bulk_create(
            User(
                email=f"tutor{i}@example.com",
                first_name="Tutor",
                last_name=str(i),
                role=User.Role.PARENT,
                password="!",
            )
            for i in range(0, n, 4)
        )

    def test_dry_run_costs_the_same_for_10_and_200_rows(self, admin):
        self._roster(200)
        small, body_small = self._run(admin, self._rows(10))
        large, body_large = self._run(admin, self._rows(200))
        assert body_small["counts"] == {"crear": 5, "actualizar": 5, "omitir": 0, "error": 0}
        assert body_large["counts"] == {"crear": 100, "actualizar": 100, "omitir": 0, "error": 0}
        assert len(large) == len(small), (len(small), len(large))

    def test_a_reimport_with_nothing_to_write_costs_the_same(self, admin):
        _post(admin, _csv(*self._rows(200)), dry_run="0")
        small, _ = self._run(admin, self._rows(10), dry_run="0")
        large, body = self._run(admin, self._rows(200), dry_run="0")
        assert body["counts"]["omitir"] == 200
        assert len(large) == len(small), (len(small), len(large))

    @staticmethod
    def _selects(run):
        return [q for q in run if q.startswith("SELECT")]

    def test_commit_of_new_rows_reads_the_same_for_10_and_200(self, admin):
        """New rows still write per row (user, profile, guardian link, audit),
        but every read was made up front: the SELECT count does not grow."""
        User.objects.bulk_create(
            User(
                email=f"tutor{i}@example.com",
                first_name="Tutor",
                last_name=str(i),
                role=User.Role.PARENT,
                password="!",
            )
            for i in range(1000, 1400, 3)
        )
        small, _ = self._run(admin, self._rows(10, start=1000), dry_run="0")
        large, body = self._run(admin, self._rows(200, start=1200), dry_run="0")
        assert body["counts"] == {"crear": 200, "actualizar": 0, "omitir": 0, "error": 0}
        assert len(self._selects(large)) == len(self._selects(small))
        per_row = (len(large) - len(small)) / 190
        assert per_row <= 12, f"{per_row:.1f} queries per new row"

    def test_updated_rows_cost_only_their_writes(self, admin):
        """An update's only reads are the audit trail's before-image of what it
        changes (the user's name, the profile's grade): two per row, never a lookup."""
        self._roster(420)  # Q0, Q2 ... Q418 exist
        rows = [r for i in range(0, 420, 2) for r in self._rows(1, start=i)]
        small, _ = self._run(admin, rows[:10], dry_run="0")
        large, body = self._run(admin, rows[10:], dry_run="0")
        assert body["counts"] == {"crear": 0, "actualizar": 200, "omitir": 0, "error": 0}
        extra_reads = len(self._selects(large)) - len(self._selects(small))
        assert extra_reads == 2 * 190, extra_reads
        per_row = (len(large) - len(small)) / 190
        assert per_row <= 12, f"{per_row:.1f} queries per updated row"

    def test_results_match_the_row_by_row_lookups(self, admin):
        """Batching changes the cost, not the answer: case-insensitive matrícula
        and tutor email, staff codes refused, collisions caught."""
        staff = StudentProfileFactory(student_id="EMP-07", tipo=StudentProfile.Tipo.PERSONAL)
        pupil = StudentProfileFactory(student_id="ab12")
        pupil.parents.add(pupil.user)
        tutor = ParentFactory(email="Mama.Ruiz@Example.com")
        User.objects.create_user(email="z9@alumnos.interlaken.edu.mx", password=None, role="parent")
        body = _post(
            admin,
            _csv(
                "AB12,Ana,Ruiz,2° Primaria,,,,,mama.ruiz@example.com,",
                f"{staff.student_id.lower()},Pedro,Paz,1° Primaria,,,,,,",
                "Z9,Zoe,Zea,1° Primaria,,,,,,",
            ),
        ).json()
        rows = {r["key"]: r for r in body["rows"]}
        assert rows["AB12"]["action"] == "actualizar"
        assert "personal del colegio" in rows["emp-07"]["errors"][0]
        assert "ya existe" in rows["Z9"]["errors"][0]
        committed = _post(
            admin, _csv("AB12,Ana,Ruiz,2° Primaria,,,,,mama.ruiz@example.com,"), dry_run="0"
        ).json()
        assert committed["counts"]["actualizar"] == 1
        assert tutor in StudentProfile.objects.get(pk=pupil.pk).parents.all()
        again = _post(admin, _csv("AB12,Ana,Ruiz,2° Primaria,,,,,MAMA.RUIZ@example.com,")).json()
        assert again["counts"]["omitir"] == 1

    def test_siblings_share_one_new_tutor(self, admin):
        """The tutor created by the first sibling is the one the second links to."""
        body = _post(
            admin,
            _csv(
                "S1,Ana,Paz,1° Primaria,,,,Luz Paz,luz@example.com,555",
                "S2,Beto,Paz,3° Primaria,,,,Luz Paz,LUZ@example.com,555",
            ),
            dry_run="0",
        ).json()
        assert body["counts"]["crear"] == 2
        tutor = User.objects.get(email__iexact="luz@example.com")
        assert set(tutor.children.values_list("student_id", flat=True)) == {"S1", "S2"}
