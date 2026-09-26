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
