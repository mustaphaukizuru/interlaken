"""
Fase 3: the «Ficha de inscripción» as files (Excel, PDF, blank form, ZIP,
concentrado) and their endpoints.

Synthetic data only (``apps.admissions.factories``): invented names and CURPs.
Every mapped field is checked in its exact cell of the school's Excel form,
the «X» groups (sexo, sangre, alergias, estado civil, grado académico,
ocupación), the print setup and merged boxes the output keeps, the 3-page PDF,
who may download what (staff area, admin health gating, the family's own
copy after submit) and the audit row of every download.
"""

import io
import zipfile
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from django.urls import resolve, reverse
from openpyxl import load_workbook

from apps.accounts.factories import AdminFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import User
from apps.accounts.serializers import StudentProfileSerializer
from apps.admissions.cycles import running_cycle
from apps.admissions.factories import (
    CHILD_CURP,
    CHILD_DOB,
    FATHER_CURP,
    FATHER_DOB,
    MOTHER_CURP,
    MOTHER_DOB,
    domicilio_data,
    emergencia_data,
    madre_data,
    padre_data,
    salud_data,
)
from apps.admissions.ficha_export import cellmap, data, files, template
from apps.admissions.ficha_export.concentrado import HEALTH_COLUMNS
from apps.admissions.ficha_export.excel import ascii_part, build_xlsx, ficha_filename
from apps.admissions.ficha_export.pdf import build_pdf
from apps.admissions.ficha_export.views import FichaExportView
from apps.admissions.models import Registration, RegistrationGuardian
from apps.admissions.tokens import issue_session
from apps.core.models import AuditLog
from apps.core.test_pdf_document import assert_well_formed, has_text
from apps.legal.models import PrivacyNoticeVersion

pytestmark = pytest.mark.django_db

MX = ZoneInfo("America/Mexico_City")
SIGNED_AT = datetime(2026, 11, 20, 13, 47, tzinfo=MX)
TEMPLATE_LABELS = None  # filled lazily: {coord: text} of the template


# ── fixtures ─────────────────────────────────────────────────────────────
def _guardian_fields(payload: dict) -> dict:
    out = dict(payload)
    out["dob"] = date.fromisoformat(out["dob"])
    return out


def make_registration(
    *, status=Registration.Status.SUBMITTED, padre=None, madre=None, salud=None, notice=True, **over
) -> Registration:
    fields = {
        "ficha_version": Registration.FichaVersion.FICHA,
        "status": status,
        "cycle": running_cycle(),
        "level": "primaria",
        "grade_applying": "1° Primaria",
        "child_given_names": "Ana Sofía",
        "child_paternal_surname": "López",
        "child_maternal_surname": "Hernández",
        "child_first_name": "Ana Sofía",
        "child_last_name": "López Hernández",
        "child_dob": CHILD_DOB,
        "child_sex": "femenino",
        "child_birth_country": "México",
        "child_birth_state": "Ciudad de México",
        "child_curp": CHILD_CURP,
        "contact_name": "Marta Hernández Gil",
        "contact_email": "marta.ficha@ejemplo.test",
        "contact_phone": "5511112222",
        "contact_relationship": "Madre",
        "parent1_name": "Marta Hernández Gil",
        "parent1_email": "marta.ficha@ejemplo.test",
        "parent1_phone": "5511112222",
        **domicilio_data(),
        **emergencia_data(),
        **(salud if salud is not None else salud_data()),
    }
    if status != Registration.Status.DRAFT:
        fields.update(
            signed_name="Marta Hernández Gil",
            signed_at=SIGNED_AT,
            submitted_at=SIGNED_AT,
            privacy_accepted_at=SIGNED_AT,
        )
        if notice:
            fields["privacy_notice_version"] = PrivacyNoticeVersion.objects.get_or_create(
                version="2026.1",
                defaults={
                    "body": "Texto de prueba.",
                    "effective_date": "2026-01-01",
                    "is_active": True,
                },
            )[0]
    fields.update(over)
    reg = Registration.objects.create(**fields)
    for role, payload in (
        ("padre", padre if padre is not None else padre_data()),
        ("madre", madre if madre is not None else madre_data()),
    ):
        if payload is False:
            continue
        RegistrationGuardian.objects.create(
            registration=reg, role=role, **_guardian_fields(payload)
        )
    return Registration.objects.prefetch_related("guardians").get(pk=reg.pk)


def staff(*areas):
    return UserFactory(role=User.Role.STAFF, staff_areas=list(areas))


def workbook(content: bytes):
    wb = load_workbook(io.BytesIO(content), rich_text=True)
    return wb, wb[cellmap.SHEET]


def template_labels() -> dict:
    global TEMPLATE_LABELS
    if TEMPLATE_LABELS is None:
        _wb, ws = workbook(template.template_bytes())
        TEMPLATE_LABELS = {
            c.coordinate: str(c.value) for row in ws.iter_rows() for c in row if c.value is not None
        }
    return TEMPLATE_LABELS


def written(ws) -> dict:
    """Cells whose value differs from the template: what the export wrote."""
    labels = template_labels()
    out = {}
    for row in ws.iter_rows():
        for c in row:
            if c.value is not None and labels.get(c.coordinate) != str(c.value):
                out[c.coordinate] = c.value
    return out


def ficha_xlsx(reg, *, medical_ok=True):
    return workbook(build_xlsx(data.ficha_sheet(reg, medical_ok=medical_ok)))


# ── the cell map ─────────────────────────────────────────────────────────
class TestCellMap:
    def test_every_field_lands_in_its_exact_cell(self):
        reg = make_registration()
        _wb, ws = ficha_xlsx(reg)
        months = data.MONTHS
        expected = {
            "F3": f"Ciclo Escolar {reg.cycle}",
            # alumno
            "B10": "LÓPEZ",
            "O10": "HERNÁNDEZ",
            "B12": "ANA SOFÍA",
            "C15": "PRIMARIA",
            "L15": "1°",
            "B20": "X",
            "G20": CHILD_DOB.day,
            "I20": months[CHILD_DOB.month - 1],
            "K20": CHILD_DOB.year,
            "P20": "MÉXICO",
            "V20": "CIUDAD DE MÉXICO",
            "F23": CHILD_CURP,
            # domicilio
            "A27": "CALLE FICTICIA",
            "L27": "12",
            "T27": "NORTE Y SUR",
            "A30": "ESTADO DE MÉXICO",
            "I30": "TLALNEPANTLA",
            "Q30": "COLONIA INVENTADA",
            "Y30": "54000",
            "J33": "5533334444",
            # salud
            "A43": "X",
            "F37": "118 cm",
            "K37": "22 kg",
            "P37": "X",
            "T37": "Polen",
            "F41": "Ninguna",
            # padre
            "B51": "LÓPEZ",
            "O51": "PÉREZ",
            "B53": "JULIO",
            "D57": "X",
            "G57": FATHER_DOB.day,
            "I57": months[FATHER_DOB.month - 1],
            "K57": FATHER_DOB.year,
            "P57": "MÉXICO",
            "V57": "ESTADO DE MÉXICO",
            "A60": FATHER_CURP,
            "K61": "X",
            "X60": "X",
            "AA64": "X",
            "AA65": "Músico",
            "A68": "5544445555",
            "I68": "5566667777",
            "P68": "123",
            "T68": "julio.ficha@ejemplo.test",
            # madre
            "B72": "HERNÁNDEZ",
            "O72": "GIL",
            "B74": "MARTA",
            "B78": "X",
            "G78": MOTHER_DOB.day,
            "I78": months[MOTHER_DOB.month - 1],
            "K78": MOTHER_DOB.year,
            "P78": "MÉXICO",
            "V78": "PUEBLA",
            "A81": MOTHER_CURP,
            "K82": "X",
            "P82": "X",
            "N86": "X",
            "A89": "5511112222",
            "V89": "marta.ficha@ejemplo.test",
            # emergencia
            "B93": "GIL RAMOS",
            "O93": "ROSA (ABUELA)",
            "V95": "5577778888",
            # firma
            "G109": "ANA SOFÍA LÓPEZ HERNÁNDEZ",
            "C111": "PRIMARIA",
            "K111": "1°",
            "T111": "20/11/2026",
            "A118": "JULIO LÓPEZ PÉREZ",
            "T118": "MARTA HERNÁNDEZ GIL",
            "B121": (
                "Aceptado electrónicamente por Marta Hernández Gil el 20 de noviembre de 2026, "
                "13:47 h (hora de la Ciudad de México) · Aviso de privacidad versión 2026.1"
            ),
        }
        assert written(ws) == expected

    def test_phones_and_codes_stay_text(self):
        _wb, ws = ficha_xlsx(make_registration())
        for coord in ("J33", "A68", "I68", "P68", "A89", "V95", "Y30", "L27"):
            assert ws[coord].data_type == "s", coord

    def test_every_logical_field_has_a_cell(self):
        reg = make_registration()
        sheet = data.ficha_sheet(reg, medical_ok=True)
        assert set(sheet.values) <= set(cellmap.CELLS)
        assert set(sheet.marks) <= set(cellmap.MARKS)

    @pytest.mark.parametrize("blood,box", sorted(cellmap.BLOOD_BOXES.items()))
    def test_blood_type_marks_its_row(self, blood, box):
        reg = make_registration(salud=salud_data(blood_type=blood))
        _wb, ws = ficha_xlsx(reg)
        marked = [c for c in cellmap.BLOOD_BOXES.values() if ws[c].value == "X"]
        assert marked == [box]

    def test_blood_type_unknown_marks_nothing_and_says_so(self):
        reg = make_registration(salud=salud_data(blood_type="no_se"))
        _wb, ws = ficha_xlsx(reg)
        assert not [c for c in cellmap.BLOOD_BOXES.values() if ws[c].value]
        assert ws["A45"].value == data.NOTE_NO_BLOOD_TYPE

    def test_allergies_no(self):
        reg = make_registration(salud=salud_data(has_allergies="no", allergies=""))
        _wb, ws = ficha_xlsx(reg)
        assert (ws["P37"].value, ws["P38"].value, ws["T37"].value) == (None, "X", None)

    @pytest.mark.parametrize(
        "status,sex,box,label",
        [
            ("soltero", "masculino", "K60", "Casado"),
            ("casado", "masculino", "K61", "Casado"),
            ("union_libre", "masculino", "K61", "Unión libre"),
            ("divorciado", "masculino", "K61", "Divorciado"),
            ("viudo", "masculino", "K61", "Viudo"),
        ],
    )
    def test_padre_marital_status(self, status, sex, box, label):
        reg = make_registration(padre=padre_data(marital_status=status, sex=sex))
        _wb, ws = ficha_xlsx(reg)
        assert [c for c in ("K60", "K61") if ws[c].value == "X"] == [box]
        assert ws["L61"].value == label
        assert ws["L60"].value == "Soltero"

    def test_madre_marital_status_is_gendered(self):
        reg = make_registration(madre=madre_data(marital_status="divorciado"))
        _wb, ws = ficha_xlsx(reg)
        assert (ws["K82"].value, ws["L82"].value) == ("X", "Divorciada")

    @pytest.mark.parametrize(
        "level,box",
        [
            ("tecnico", "P60"),
            ("licenciatura", "P61"),
            ("maestria", "X60"),
            ("doctorado", "X61"),
        ],
    )
    def test_grado_academico(self, level, box):
        reg = make_registration(padre=padre_data(education_level=level))
        _wb, ws = ficha_xlsx(reg)
        assert [c for c in ("P60", "P61", "X60", "X61") if ws[c].value == "X"] == [box]

    @pytest.mark.parametrize("occupation,box", sorted(cellmap.MARKS["madre.ocupacion"].items()))
    def test_ocupacion(self, occupation, box):
        other = "Bióloga" if occupation == "otro" else ""
        reg = make_registration(madre=madre_data(occupation=occupation, occupation_other=other))
        _wb, ws = ficha_xlsx(reg)
        boxes = cellmap.MARKS["madre.ocupacion"].values()
        assert [c for c in boxes if ws[c].value == "X"] == [box]
        assert ws["AA86"].value == (other or None)

    def test_parent_block_not_applicable(self):
        reg = make_registration(padre={**padre_data(), "not_applicable": True})
        _wb, ws = ficha_xlsx(reg)
        assert ws["B53"].value == data.NOT_APPLICABLE
        assert ws["B51"].value is None and ws["A60"].value is None and ws["A118"].value is None
        assert ws["T118"].value == "MARTA HERNÁNDEZ GIL"

    def test_health_masked_without_access(self):
        reg = make_registration()
        _wb, ws = ficha_xlsx(reg, medical_ok=False)
        health = {"F37", "K37", "T37", "F41", "P37", "P38", *cellmap.BLOOD_BOXES.values()}
        assert all(ws[c].value is None for c in health)
        assert ws["A45"].value == data.NOTE_MEDICAL_MASKED

    def test_long_free_text_shrinks_and_is_cut(self):
        long = "Asma moderada con crisis estacionales; requiere inhalador. " * 30
        reg = make_registration(salud=salud_data(chronic_conditions=long, allergies="Polen " * 200))
        _wb, ws = ficha_xlsx(reg)
        assert ws["F41"].font.sz < 9 and ws["F41"].value.endswith("…")
        assert ws["T37"].font.sz < 9

    def test_formula_text_stays_text(self):
        reg = make_registration(child_given_names='=HYPERLINK("http://x","y")')
        _wb, ws = ficha_xlsx(reg)
        assert ws["B12"].data_type == "s" and ws["B12"].value.startswith("=HYPERLINK")

    def test_legacy_record_uses_the_old_name_pair(self):
        reg = make_registration(
            child_given_names="",
            child_paternal_surname="",
            child_maternal_surname="",
            child_first_name="Leo",
            child_last_name="Ruiz Soto",
            padre=False,
            madre=False,
        )
        _wb, ws = ficha_xlsx(reg)
        assert (ws["B10"].value, ws["O10"].value, ws["B12"].value) == ("RUIZ", "SOTO", "LEO")


# ── the Excel file ───────────────────────────────────────────────────────
class TestExcelFile:
    def test_keeps_merges_print_setup_and_logo(self):
        _wb, ws = ficha_xlsx(make_registration())
        _twb, tws = workbook(template.template_bytes())
        assert {str(r) for r in ws.merged_cells.ranges} == {str(r) for r in tws.merged_cells.ranges}
        assert ws.print_area == tws.print_area == "'Hoja1'!$A$1:$AD$130"
        assert [b.id for b in ws.row_breaks.brk] == [48, 90]
        assert (ws.page_setup.fitToWidth, ws.page_setup.fitToHeight) == (1, 0)
        assert int(ws.page_setup.paperSize) == 1
        assert len(ws._images) == 1

    def test_blank_form_has_only_the_labels(self):
        _wb, ws = workbook(build_xlsx(data.blank_sheet()))
        assert written(ws) == {"F3": f"Ciclo Escolar {data.BLANK_CYCLE}"}

    def test_file_name_is_ascii_and_never_the_curp(self):
        reg = make_registration()
        sheet = data.ficha_sheet(reg, medical_ok=False)
        name = ficha_filename(sheet, "xlsx")
        assert name == f"Ficha_Lopez_Ana-Sofia_{reg.cycle}.xlsx"
        assert name.isascii() and CHILD_CURP not in name
        assert ascii_part("  Ñoño  Pérez ") == "Nono-Perez"
        nameless = data.FichaSheet()
        assert (
            ficha_filename(nameless, "pdf", fallback="inscripción 7") == "Ficha_inscripcion-7.pdf"
        )
        assert files.blank_file("pdf").filename == "Ficha_de_inscripcion_en_blanco.pdf"


# ── the PDF ──────────────────────────────────────────────────────────────
LABELS_ON_PDF = (
    "DATOS DEL ALUMNO",
    "DOMICILIO",
    "DATOS ADICIONALES",
    "DATOS DEL PADRE",
    "DATOS DE LA MADRE",
    "INFORMACIÓN EN CASO DE EMERGENCIA",
    "AVISO DE PRIVACIDAD",
    "CURP ALUMNO",
    "CURP PADRE",
    "CURP MADRE",
    "Tipo de Sangre",
    "Grado académico",
    "Ocupación",
    "Nombre y Firma del Padre",
    "Nombre y Firma de la Madre",
    "FICHA DE INSCRIPCIÓN",
)


class TestPdf:
    def test_three_letter_pages_with_labels_values_and_footer(self):
        reg = make_registration()
        pdf = build_pdf(data.ficha_sheet(reg, medical_ok=True))
        assert assert_well_formed(pdf) == 3
        assert pdf.count(b"/MediaBox [0 0 612 792]") == 3
        for label in LABELS_ON_PDF:
            assert has_text(pdf, label), label
        for value in (
            "ANA SOFÍA",
            CHILD_CURP,
            FATHER_CURP,
            "JULIO LÓPEZ PÉREZ",
            "Polen",
            f"Ciclo Escolar {reg.cycle}",
            "Página 1 de 3",
            "Página 3 de 3",
        ):
            assert has_text(pdf, value), value
        assert has_text(pdf, "Aviso de privacidad versión 2026.1")
        assert b"/DCTDecode" in pdf  # the official logo

    def test_masked_health_and_long_text_keep_three_pages(self):
        long = "Asma moderada con crisis estacionales; requiere inhalador. " * 40
        reg = make_registration(salud=salud_data(chronic_conditions=long))
        masked = build_pdf(data.ficha_sheet(reg, medical_ok=False))
        assert assert_well_formed(masked) == 3
        assert not has_text(masked, "Polen") and has_text(masked, "Datos de salud reservados")
        full = build_pdf(data.ficha_sheet(reg, medical_ok=True))
        assert assert_well_formed(full) == 3

    def test_blank_pdf(self):
        pdf = build_pdf(data.blank_sheet())
        assert assert_well_formed(pdf) == 3
        assert has_text(pdf, "DATOS DEL ALUMNO") and not has_text(pdf, "Aceptado electrónicamente")


# ── endpoints ────────────────────────────────────────────────────────────
def export_url(pk):
    return reverse("register-ficha-export", args=[pk])


def audit_rows(kind):
    return list(
        AuditLog.objects.filter(action="export", object_type=f"export:{kind}").order_by("pk")
    )


class TestSingleFichaEndpoint:
    def test_route_is_not_swallowed_by_the_section_route(self):
        assert resolve(export_url(5)).func.view_class is FichaExportView

    def test_staff_with_the_area_gets_excel_without_health(self, api_client):
        reg = make_registration()
        user = staff("admisiones")
        api_client.force_authenticate(user)
        resp = api_client.get(export_url(reg.pk), {"fmt": "xlsx"})
        assert resp.status_code == 200
        assert resp["Content-Type"] == files.CONTENT_TYPES["xlsx"]
        assert resp["Content-Disposition"] == (
            f'attachment; filename="Ficha_Lopez_Ana-Sofia_{reg.cycle}.xlsx"'
        )
        assert resp["Cache-Control"] == "no-store"
        _wb, ws = workbook(resp.content)
        assert ws["T37"].value is None and ws["A45"].value == data.NOTE_MEDICAL_MASKED
        (row,) = audit_rows("ficha")
        assert row.actor == user and row.object_id == "xlsx"
        assert row.changes["filters"] == {"registration": reg.pk, "salud": False}

    def test_admin_gets_health_only_with_consent(self, api_client):
        with_consent = make_registration()
        without = make_registration(salud=salud_data(consent_medical_data=False))
        api_client.force_authenticate(AdminFactory())
        pdf = api_client.get(export_url(with_consent.pk)).content
        assert assert_well_formed(pdf) == 3 and has_text(pdf, "Polen")
        pdf = api_client.get(export_url(without.pk), {"fmt": "pdf"}).content
        assert not has_text(pdf, "Polen")
        assert [r.changes["filters"]["salud"] for r in audit_rows("ficha")] == [True, False]

    @pytest.mark.parametrize("areas", [(), ("alumnos",), ("cafeteria",)])
    def test_staff_without_the_area_is_refused(self, api_client, areas):
        reg = make_registration()
        api_client.force_authenticate(staff(*areas))
        assert api_client.get(export_url(reg.pk), {"fmt": "pdf"}).status_code == 403
        assert not audit_rows("ficha")

    def test_parent_account_without_session_is_refused(self, api_client, parent_user):
        reg = make_registration()
        api_client.force_authenticate(parent_user)
        assert api_client.get(export_url(reg.pk)).status_code == 403

    def test_anonymous_is_refused(self, api_client):
        reg = make_registration()
        assert api_client.get(export_url(reg.pk)).status_code == 401

    def test_bad_format(self, api_client):
        api_client.force_authenticate(AdminFactory())
        reg = make_registration()
        assert api_client.get(export_url(reg.pk), {"fmt": "csv"}).status_code == 400

    def test_family_gets_its_own_pdf_after_submit(self, api_client):
        reg = make_registration()
        token = issue_session(reg)
        resp = api_client.get(export_url(reg.pk), {"fmt": "pdf"}, HTTP_X_SESSION_TOKEN=token)
        assert resp.status_code == 200 and resp["Content-Type"] == "application/pdf"
        assert assert_well_formed(resp.content) == 3 and has_text(resp.content, "Polen")
        (row,) = audit_rows("ficha")
        assert row.actor is None and row.actor_label == f"familia:inscripción {reg.pk}"
        assert row.changes["filters"]["registration"] == reg.pk

    def test_family_cannot_read_another_ficha(self, api_client):
        mine = make_registration()
        other = make_registration()
        token = issue_session(mine)
        resp = api_client.get(export_url(other.pk), HTTP_X_SESSION_TOKEN=token)
        assert resp.status_code == 404
        missing = api_client.get(export_url(other.pk + 100), HTTP_X_SESSION_TOKEN=token)
        assert missing.status_code == 404
        assert not audit_rows("ficha")

    def test_family_before_submit_is_refused(self, api_client):
        reg = make_registration(status=Registration.Status.DRAFT)
        token = issue_session(reg)
        resp = api_client.get(export_url(reg.pk), HTTP_X_SESSION_TOKEN=token)
        assert resp.status_code == 409 and resp.data["code"] == "not_submitted"

    def test_family_gets_pdf_only(self, api_client):
        reg = make_registration()
        token = issue_session(reg)
        resp = api_client.get(export_url(reg.pk), {"fmt": "xlsx"}, HTTP_X_SESSION_TOKEN=token)
        assert resp.status_code == 400


class TestZipEndpoint:
    URL = reverse("register-fichas-export")

    def test_zip_of_selected_fichas(self, api_client):
        a = make_registration()
        b = make_registration(child_given_names="Leo", child_first_name="Leo")
        user = AdminFactory()
        api_client.force_authenticate(user)
        resp = api_client.get(self.URL, {"ids": f"{a.pk},{b.pk}", "fmt": "pdf"})
        assert resp.status_code == 200 and resp["Content-Type"] == "application/zip"
        names = zipfile.ZipFile(io.BytesIO(resp.content)).namelist()
        assert sorted(names) == sorted(
            [
                f"Ficha_Lopez_Ana-Sofia_{a.cycle}.pdf",
                f"Ficha_Lopez_Leo_{b.cycle}.pdf",
            ]
        )
        (row,) = audit_rows("fichas")
        assert row.object_id == "zip-pdf" and row.changes["rows"] == 2
        assert sorted(map(int, row.changes["filters"]["registrations"])) == sorted([a.pk, b.pk])

    def test_same_name_twice_gets_the_id(self, api_client):
        a, b = make_registration(), make_registration()
        api_client.force_authenticate(staff("admisiones"))
        resp = api_client.get(self.URL, {"ids": f"{a.pk},{b.pk}", "fmt": "xlsx"})
        names = sorted(zipfile.ZipFile(io.BytesIO(resp.content)).namelist())
        stem = f"Ficha_Lopez_Ana-Sofia_{a.cycle}"
        assert len(names) == 2 and f"{stem}.xlsx" in names
        assert any(n.startswith(f"{stem}_") for n in names)

    def test_caps_and_validation(self, api_client):
        api_client.force_authenticate(AdminFactory())
        assert api_client.get(self.URL, {"fmt": "pdf"}).status_code == 400
        ids = ",".join(str(n) for n in range(1, files.ZIP_CAP + 2))
        resp = api_client.get(self.URL, {"ids": ids, "fmt": "pdf"})
        assert resp.status_code == 413 and "50 fichas" in resp.data["detail"]
        assert api_client.get(self.URL, {"ids": "999999"}).status_code == 404

    def test_staff_without_the_area_is_refused(self, api_client):
        reg = make_registration()
        api_client.force_authenticate(staff("alumnos"))
        assert api_client.get(self.URL, {"ids": reg.pk}).status_code == 403


class TestConcentrado:
    URL = reverse("register-fichas-concentrado")

    def _sheet(self, resp):
        wb = load_workbook(io.BytesIO(resp.content))
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        return rows[0], rows[1:]

    def test_admin_sees_health_columns_for_consenting_families(self, api_client):
        yes = make_registration()
        no = make_registration(
            salud=salud_data(consent_medical_data=False),
            child_given_names="Leo",
            child_first_name="Leo",
        )
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(self.URL, {"fmt": "xlsx", "ordering": "created_at"})
        assert resp.status_code == 200
        header, rows = self._sheet(resp)
        assert header[-len(HEALTH_COLUMNS) :] == tuple(c.header for c in HEALTH_COLUMNS)
        by_id = {r[0]: dict(zip(header, r, strict=True)) for r in rows}
        assert (
            by_id[yes.pk]["Tipo de sangre"] == "O+"
            and by_id[yes.pk]["Alergias: ¿cuáles?"] == "Polen"
        )
        assert by_id[no.pk]["Tipo de sangre"] is None and by_id[no.pk]["Alergias: ¿cuáles?"] is None
        row = by_id[yes.pk]
        assert row["Padre: CURP"] == FATHER_CURP and row["Madre: nombre(s)"] == "Marta"
        assert row["Padre: ocupación"] == "Otro: Músico"
        assert row["Alumno: fecha de nacimiento"].date() == CHILD_DOB
        assert row["Emergencia: celular"] == "5577778888"
        (audit,) = audit_rows("fichas-concentrado")
        assert audit.changes["rows"] == 2 and audit.changes["filters"]["salud"] is True

    def test_staff_area_gets_no_health_columns_and_filters_apply(self, api_client):
        sent = make_registration()
        make_registration(status=Registration.Status.DRAFT)
        api_client.force_authenticate(staff("admisiones"))
        resp = api_client.get(self.URL, {"status": "submitted"})
        header, rows = self._sheet(resp)
        assert "Tipo de sangre" not in header and "Alergias: ¿cuáles?" not in header
        assert [r[0] for r in rows] == [sent.pk]
        resp = api_client.get(self.URL, {"ids": str(sent.pk), "fmt": "xlsx"})
        assert [r[0] for r in self._sheet(resp)[1]] == [sent.pk]
        assert api_client.get(self.URL, {"fmt": "pdf"}).status_code == 400

    def test_refused_without_the_area(self, api_client):
        api_client.force_authenticate(staff("visitas"))
        assert api_client.get(self.URL).status_code == 403


class TestBlankForm:
    URL = reverse("ficha-blank")

    def test_blank_pdf_is_public_and_not_audited(self, api_client):
        resp = api_client.get(self.URL, {"fmt": "pdf"})
        assert resp.status_code == 200
        assert (
            resp["Content-Disposition"]
            == 'attachment; filename="Ficha_de_inscripcion_en_blanco.pdf"'
        )
        assert assert_well_formed(resp.content) == 3
        assert not audit_rows("ficha-en-blanco")

    def test_blank_excel_is_for_staff(self, api_client):
        assert api_client.get(self.URL, {"fmt": "xlsx"}).status_code == 401
        api_client.force_authenticate(staff("admisiones"))
        resp = api_client.get(self.URL, {"fmt": "xlsx"})
        assert resp.status_code == 200
        _wb, ws = workbook(resp.content)
        assert written(ws) == {"F3": f"Ciclo Escolar {data.BLANK_CYCLE}"}
        assert len(audit_rows("ficha-en-blanco")) == 1


def test_student_file_exposes_its_registration():
    reg = make_registration()
    profile = StudentProfileFactory(registration=reg)
    assert StudentProfileSerializer(profile).data["registration"] == reg.pk
    assert StudentProfileSerializer(StudentProfileFactory()).data["registration"] is None
