"""The ficha as data (admissions.ficha_schema): the public schema endpoint and the
required-for-submit rules it shares with the API."""

import pytest
from django.urls import reverse

from apps.admissions import cycles
from apps.admissions import ficha_schema as fs
from apps.admissions.ficha import serializer_class


def _values(**sections):
    """Every patchable section, blank, overridden by ``sections``."""
    out = {}
    for key in fs.PATCH_SECTIONS:
        base = {
            f.name: (False if f.type == "boolean" else None if f.type == "date" else "")
            for f in fs.SECTIONS[key].fields
        }
        base.update(sections.get(key, {}))
        out[key] = base
    return out


@pytest.mark.django_db
class TestSchemaEndpoint:
    def test_public_and_complete(self, api_client):
        resp = api_client.get(reverse("ficha-schema"))
        assert resp.status_code == 200
        data = resp.json()
        assert [s["key"] for s in data["steps"]] == [
            "inicio",
            "contacto",
            "alumno",
            "domicilio",
            "salud",
            "padre",
            "madre",
            "emergencia",
            "firma",
        ]
        assert data["patch_sections"] == [
            "contacto",
            "alumno",
            "domicilio",
            "salud",
            "padre",
            "madre",
            "emergencia",
        ]
        assert data["public_start_enabled"] is True
        choices = data["choices"]
        assert len(choices["estados"]) == 32
        assert [g["value"] for g in choices["grados"]][:2] == ["Maternal", "1° Preescolar"]
        assert {g["value"]: g["level"] for g in choices["grados"]}["Maternal"] == "preescolar"
        assert len(choices["grados"]) == 13
        assert {o["value"] for o in choices["tipo_sangre"]} >= {"O+", "AB-", "no_se"}
        assert [o["value"] for o in choices["ciclo"]] == list(cycles.allowed_cycles())
        assert {o["label"] for o in choices["ocupacion"]} >= {"Ama de casa", "Otro"}
        assert {o["label"] for o in choices["estado_civil"]} == {
            "Soltero/a",
            "Casado/a",
            "Unión libre",
            "Divorciado/a",
            "Viudo/a",
        }
        assert {o["label"] for o in choices["grado_academico"]} == {
            "Técnico",
            "Lic. / Ing.",
            "Maestría",
            "Doctorado",
        }

    def test_every_select_names_a_known_list(self, api_client):
        data = api_client.get(reverse("ficha-schema")).json()
        for step in data["steps"]:
            for field in step["fields"]:
                if field["choices"]:
                    assert field["choices"] in data["choices"], (step["key"], field["name"])

    def test_reflects_the_public_start_toggle(self, api_client):
        from apps.content.models import SiteSettings

        s = SiteSettings.load()
        s.admissions_public_start = False
        s.save()
        assert api_client.get(reverse("ficha-schema")).json()["public_start_enabled"] is False

    def test_no_em_dash_in_any_label(self, api_client):
        text = api_client.get(reverse("ficha-schema")).content.decode()
        assert "—" not in text and "\\u2014" not in text


class TestGrades:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("Primaria 1°", "1° Primaria"),
            ("1° primaria", "1° Primaria"),
            ("Secundaria 3°", "3° Secundaria"),
            ("maternal", "Maternal"),
            ("Preescolar 2", "2° Preescolar"),
            ("Primaria 7°", None),
            ("Bachillerato", None),
        ],
    )
    def test_normalize_grade(self, raw, expected):
        assert fs.normalize_grade(raw) == expected

    def test_level_for_grade(self):
        assert fs.level_for_grade("Maternal") == "preescolar"
        assert fs.level_for_grade("3° Preescolar") == "preescolar"
        assert fs.level_for_grade("Primaria 4°") == "primaria"
        assert fs.level_for_grade("2° Secundaria") == "secundaria"


class TestRequiredRules:
    def test_blank_ficha_misses_everything_required(self):
        missing = fs.missing_by_section(_values())
        assert set(missing["alumno"]) == {
            "child_paternal_surname",
            "child_given_names",
            "grade_applying",
            "cycle",
            "child_sex",
            "child_dob",
            "child_birth_country",
        }
        assert set(missing["domicilio"]) == {
            "address_street",
            "address_ext_number",
            "address_state",
            "address_municipality",
            "address_neighborhood",
            "address_postal_code",
        }
        assert set(missing["salud"]) == {"blood_type", "has_allergies", "consent_medical_data"}
        assert set(missing["emergencia"]) == {
            "emergency_surnames",
            "emergency_given_names",
            "emergency_phone",
        }
        # A blank parent block's country defaults to México: its CURP is required.
        assert "curp" in missing["padre"] and "maternal_surname" not in missing["padre"]

    def test_born_in_mexico_needs_state_curp_and_maternal_surname(self):
        alumno = {"child_birth_country": "México"}
        missing = fs.section_missing(fs.ALUMNO, alumno)
        assert {"child_birth_state", "child_curp", "child_maternal_surname"} <= set(missing)
        abroad = fs.section_missing(fs.ALUMNO, {"child_birth_country": "España"})
        assert not {"child_birth_state", "child_curp", "child_maternal_surname"} & set(abroad)

    def test_allergies_which_only_when_yes(self):
        assert "allergies" in fs.section_missing(fs.SALUD, {"has_allergies": "si"})
        assert "allergies" not in fs.section_missing(fs.SALUD, {"has_allergies": "no"})

    def test_occupation_text_only_for_otro(self):
        assert "occupation_other" in fs.section_missing(fs.PADRE, {"occupation": "otro"})
        assert "occupation_other" not in fs.section_missing(fs.PADRE, {"occupation": "comerciante"})

    def test_guardian_abroad_needs_no_curp(self):
        assert "curp" not in fs.section_missing(fs.MADRE, {"birth_country": "Colombia"})

    def test_no_aplica_skips_the_block_but_one_must_apply(self):
        one = fs.missing_by_section(_values(padre={"not_applicable": True}))
        assert one["padre"] == {}
        assert one["madre"]  # still to fill
        both = fs.missing_by_section(
            _values(padre={"not_applicable": True}, madre={"not_applicable": True})
        )
        assert set(both["padre"]) == {"not_applicable"} == set(both["madre"])
        assert "al menos" in both["padre"]["not_applicable"]

    def test_emergency_needs_one_phone(self):
        values = {"emergency_surnames": "Ruiz", "emergency_given_names": "Eva"}
        assert set(fs.section_missing(fs.EMERGENCIA, values)) == {"emergency_phone"}
        assert fs.section_missing(fs.EMERGENCIA, {**values, "emergency_mobile": "5512345678"}) == {}

    def test_completeness_shape(self):
        result = fs.completeness(_values())
        assert result["complete"] is False
        assert set(result["sections"]) == set(fs.PATCH_SECTIONS)
        assert result["sections"]["alumno"]["complete"] is False

    def test_required_errors_are_drf_shaped(self):
        errors = fs.required_errors(_values())
        assert errors["alumno"]["child_dob"] == [fs.REQUIRED_MSG]


def test_every_patch_section_builds_a_serializer():
    for key in fs.PATCH_SECTIONS + ("inicio",):
        fields = serializer_class(key)().fields
        expected = {f.name for f in fs.SECTIONS[key].fields if not f.read_only}
        assert set(fields) == expected, key


def test_medical_fields_are_the_salud_section():
    salud = {f.name for f in fs.SALUD.fields if f.medical}
    assert salud == set(fs.REGISTRATION_MEDICAL_FIELDS)
