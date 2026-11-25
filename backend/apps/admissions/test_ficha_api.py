"""The ficha de inscripción API (Fase 1): public start, per-step saves, submit,
«continuar mi ficha», the public-start switch, permissions, health data.

Synthetic data only (apps.admissions.factories): invented names, CURPs built
with the official check digit.
"""

import pytest
from django.core import mail
from django.db import connection
from django.urls import reverse

from apps.accounts.factories import AdminFactory, UserFactory
from apps.accounts.models import StudentProfile, User
from apps.admissions import cycles
from apps.admissions.factories import (
    CHILD_DOB,
    SECTION_DATA,
    alumno_data,
    child_dob_for,
    make_curp,
    salud_data,
    start_payload,
)
from apps.admissions.models import PreRegistration, Registration, RegistrationGuardian
from apps.admissions.process_fixtures import admitted
from apps.content.models import SiteSettings
from apps.core.models import AuditLog

# These tests start fichas from the public form, off by default since the
# ficha is private (2026-11-21): the public_start fixture turns it on.
pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("public_start")]

START = reverse("register-create")


@pytest.fixture(autouse=True)
def _mail(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.ADMISSIONS_EMAIL = "admisiones@ejemplo.test"
    mail.outbox.clear()


@pytest.fixture
def sync_background(monkeypatch):
    """Run «continuar mi ficha» emails inline (the view uses a daemon thread)."""
    from apps.portal import services

    started = []

    def run(fn, *, name):
        started.append(name)
        fn()

    monkeypatch.setattr(services, "run_in_background", run)
    return started


def staff(*areas):
    return UserFactory(role=User.Role.STAFF, staff_areas=list(areas))


def _start(client, **over):
    resp = client.post(START, start_payload(**over), format="json")
    assert resp.status_code == 201, resp.data
    return resp.data["id"], resp.data["session_token"]


def _ficha_url(reg_id, section=None):
    if section:
        return reverse("register-ficha-section", args=[reg_id, section])
    return reverse("register-ficha", args=[reg_id])


def _patch(client, reg_id, section, data, token=None):
    kwargs = {"HTTP_X_SESSION_TOKEN": token} if token else {}
    return client.patch(_ficha_url(reg_id, section), data, format="json", **kwargs)


def _get(client, reg_id, token=None):
    kwargs = {"HTTP_X_SESSION_TOKEN": token} if token else {}
    return client.get(_ficha_url(reg_id), **kwargs)


def _fill(client, reg_id, token, **overrides):
    for section, builder in SECTION_DATA.items():
        resp = _patch(client, reg_id, section, builder(**overrides.get(section, {})), token)
        assert resp.status_code == 200, (section, resp.data)
    return resp


def _submit(client, reg_id, token=None, **body):
    data = {"accept_privacy": True, "signed_name": "Marta Hernández Gil", **body}
    kwargs = {"HTTP_X_SESSION_TOKEN": token} if token else {}
    return client.post(reverse("register-submit", args=[reg_id]), data, format="json", **kwargs)


# ── public start ─────────────────────────────────────────────────────────
class TestPublicStart:
    def test_creates_lead_and_draft_and_returns_a_session(self, api_client):
        resp = api_client.post(START, start_payload(), format="json")
        assert resp.status_code == 201, resp.data
        body = resp.data
        assert "invite_token" not in body  # the link travels by email only
        assert body["status"] == "draft" and body["cycle"] == cycles.running_cycle()
        reg = Registration.objects.get(pk=body["id"])
        assert reg.ficha_version == Registration.FichaVersion.FICHA
        assert reg.child_dob is None
        assert (reg.child_first_name, reg.child_last_name) == ("Ana Sofía", "López Hernández")
        assert (reg.level, reg.grade_applying) == ("primaria", "1° Primaria")
        # parent1 = who fills the ficha in
        assert (reg.parent1_name, reg.parent1_email, reg.parent1_phone) == (
            "Marta Hernández Gil",
            "marta.ficha@ejemplo.test",
            "5511112222",
        )
        lead = reg.pre_registration
        assert lead.pk == body["pre_registration"]
        assert lead.status == PreRegistration.Status.PENDING
        assert (lead.referral_source, lead.wants_visit, lead.relationship) == (
            "redes",
            True,
            "Madre",
        )
        assert lead.message == "Nos interesa conocer el colegio."
        assert (lead.cycle, lead.grade_applying, lead.level) == (
            reg.cycle,
            "1° Primaria",
            "primaria",
        )
        assert lead.child_dob is None and lead.parent_email == "marta.ficha@ejemplo.test"
        # The session works right away, no email needed.
        ficha = _get(api_client, reg.pk, body["session_token"])
        assert ficha.status_code == 200
        assert ficha.data["sections"]["contacto"]["contact_email"] == "marta.ficha@ejemplo.test"
        assert body["ficha"]["completeness"]["complete"] is False

    def test_emails_family_link_and_office(self, api_client):
        reg_id, _token = _start(api_client)
        assert len(mail.outbox) == 2
        family = next(m for m in mail.outbox if m.to == ["marta.ficha@ejemplo.test"])
        assert "Ficha de inscripción iniciada" in family.subject
        assert "Recibimos el inicio" in family.body
        assert f"/pre-registro?rid={reg_id}&token=" in family.body
        office = next(m for m in mail.outbox if m.to == ["admisiones@ejemplo.test"])
        assert "Nueva ficha de inscripción" in office.subject
        assert office.reply_to == ["marta.ficha@ejemplo.test"]
        assert "Redes sociales" in office.body

    def test_emailed_link_is_a_fresh_single_use_invite(self, api_client):
        reg_id, _token = _start(api_client)
        body = next(m for m in mail.outbox if m.to == ["marta.ficha@ejemplo.test"]).body
        raw = body.split(f"rid={reg_id}&token=")[1].split()[0].strip("<>\"')")
        access = reverse("register-access", args=[reg_id])
        first = api_client.post(access, {"token": raw}, format="json")
        assert first.status_code == 200 and first.data["session_token"]
        assert api_client.post(access, {"token": raw}, format="json").status_code == 401

    def test_required_and_format_errors(self, api_client):
        resp = api_client.post(
            START,
            start_payload(contact_phone="123", cycle="2030-2031", child_given_names=""),
            format="json",
        )
        assert resp.status_code == 400
        assert "10 dígitos" in resp.data["contact_phone"][0]
        assert "ciclo" in resp.data["cycle"][0]
        payload = start_payload()
        del payload["contact_relationship"]
        missing = api_client.post(START, payload, format="json")
        assert missing.status_code == 400 and missing.data["contact_relationship"]
        assert not Registration.objects.exists() and not PreRegistration.objects.exists()

    def test_next_cycle_and_maternal(self, api_client):
        reg_id, _ = _start(
            api_client, cycle="proximo", grade_applying="Maternal", child_maternal_surname=""
        )
        reg = Registration.objects.get(pk=reg_id)
        assert reg.cycle == cycles.next_cycle()
        assert reg.level == "preescolar" and reg.child_last_name == "López"

    def test_old_wizard_payload_still_works(self, api_client):
        resp = api_client.post(
            START,
            {
                "child_first_name": "Leo",
                "child_last_name": "Mora",
                "child_dob": "2018-01-01",
                "level": "primaria",
                "grade_applying": "2° Primaria",
                "parent1_name": "Iván Mora",
                "parent1_email": "ivan@ejemplo.test",
                "parent1_phone": "5534343434",
            },
            format="json",
        )
        assert resp.status_code == 201 and resp.data["invite_token"]
        reg = Registration.objects.get(pk=resp.data["id"])
        assert reg.ficha_version == Registration.FichaVersion.LEGACY
        assert not PreRegistration.objects.exists() and mail.outbox == []

    def test_old_wizard_payload_still_requires_the_birth_date(self, api_client):
        resp = api_client.post(
            START,
            {
                "child_first_name": "Leo",
                "child_last_name": "Mora",
                "level": "primaria",
                "grade_applying": "2° Primaria",
                "parent1_name": "Iván Mora",
                "parent1_email": "ivan@ejemplo.test",
                "parent1_phone": "5534343434",
            },
            format="json",
        )
        assert resp.status_code == 400 and "child_dob" in resp.data

    def test_rate_limited(self, api_client, settings, monkeypatch):
        from django.core.cache import cache
        from django_ratelimit import core as ratelimit_core

        settings.RATELIMIT_ENABLE = True
        cache.clear()
        # A fixed clock: six requests that straddled a minute boundary landed in
        # two rate-limit windows and the sixth got 201 (flaky on slow CI).
        monkeypatch.setattr(ratelimit_core.time, "time", lambda: 1_800_000_030.0)
        codes = [
            api_client.post(
                START, start_payload(contact_email=f"f{i}@ejemplo.test"), format="json"
            ).status_code
            for i in range(6)
        ]
        assert codes[:5] == [201] * 5 and codes[5] == 429


class TestPublicStartSwitch:
    def _off(self):
        s = SiteSettings.load()
        s.admissions_public_start = False
        s.save()

    def test_off_refuses_both_payload_shapes(self, api_client):
        self._off()
        resp = api_client.post(START, start_payload(), format="json")
        assert resp.status_code == 403
        assert resp.data["code"] == "public_start_disabled"
        assert "enlace" in resp.data["detail"] and "—" not in resp.data["detail"]
        legacy = api_client.post(START, {"child_first_name": "Leo"}, format="json")
        assert legacy.status_code == 403
        assert not Registration.objects.exists()

    def test_off_keeps_invited_links_working(self, api_client, admin_client):
        self._off()
        pre = PreRegistration.objects.create(
            child_first_name="Leo",
            child_last_name="Mora",
            child_dob="2018-01-01",
            level="primaria",
            grade_applying="2° Primaria",
            parent_name="Iván Mora",
            parent_email="ivan@ejemplo.test",
            parent_phone="5534343434",
        )
        pre = admitted(pre)  # the link goes out once the exam is «Aceptado»
        invite = admin_client.post(reverse("pre-register-invite", args=[pre.pk]))
        assert invite.status_code == 201
        reg_id = invite.data["registration_id"]
        family = type(api_client)()
        session = family.post(
            reverse("register-access", args=[reg_id]),
            {"token": invite.data["invite_token"]},
            format="json",
        )
        assert session.status_code == 200
        token = session.data["session_token"]
        ficha = _get(family, reg_id, token)
        assert ficha.status_code == 200
        # The invite seeded «quién llena la ficha» from the pre-registro.
        assert ficha.data["sections"]["contacto"]["contact_email"] == "ivan@ejemplo.test"
        assert _patch(family, reg_id, "alumno", alumno_data(), token).status_code == 200

    def test_admin_can_switch_it_from_ajustes(self, admin_client):
        resp = admin_client.patch(
            reverse("admin-site-settings"), {"admissions_public_start": False}, format="json"
        )
        assert resp.status_code == 200 and resp.data["admissions_public_start"] is False
        assert SiteSettings.load().admissions_public_start is False
        resp = admin_client.patch(
            reverse("admin-site-settings"), {"admissions_public_start": True}, format="json"
        )
        assert resp.status_code == 200 and SiteSettings.load().admissions_public_start is True


# ── reading and saving sections ──────────────────────────────────────────
class TestSections:
    def test_get_shape(self, api_client):
        reg_id, token = _start(api_client)
        data = _get(api_client, reg_id, token).data
        assert set(data["sections"]) == {
            "contacto",
            "alumno",
            "domicilio",
            "salud",
            "padre",
            "madre",
            "emergencia",
        }
        assert data["editable"] is True and data["medical_masked"] is False
        assert data["completeness"]["sections"]["contacto"] == {"complete": True, "missing": []}
        assert "child_dob" in data["completeness"]["sections"]["alumno"]["missing"]
        assert data["sections"]["padre"]["not_applicable"] is False
        assert "signed_ip" not in data["firma"]

    def test_alumno_save_syncs_legacy_names_and_level(self, api_client):
        reg_id, token = _start(api_client)
        resp = _patch(
            api_client,
            reg_id,
            "alumno",
            alumno_data(
                child_given_names="María José",
                child_paternal_surname="Ruiz",
                child_maternal_surname="Soto",
                child_curp=make_curp(CHILD_DOB, "M", initials="RUSM"),
            ),
            token,
        )
        assert resp.status_code == 200, resp.data
        assert resp.data["completeness"]["sections"]["alumno"]["complete"] is True
        assert resp.data["data"]["child_dob"] == CHILD_DOB.isoformat()
        reg = Registration.objects.get(pk=reg_id)
        assert (reg.child_first_name, reg.child_last_name) == ("María José", "Ruiz Soto")

    def test_partial_save_is_a_draft(self, api_client):
        reg_id, token = _start(api_client)
        resp = _patch(api_client, reg_id, "domicilio", {"address_street": "Calle Uno"}, token)
        assert resp.status_code == 200
        assert (
            "address_postal_code" in resp.data["completeness"]["sections"]["domicilio"]["missing"]
        )

    def test_format_errors_are_spanish_field_errors(self, api_client):
        reg_id, token = _start(api_client)
        curp = alumno_data()["child_curp"]
        bad_digit = curp[:17] + str((int(curp[17]) + 1) % 10)
        resp = _patch(api_client, reg_id, "alumno", alumno_data(child_curp=bad_digit), token)
        assert resp.status_code == 400 and "último dígito" in resp.data["child_curp"][0]
        other_day = alumno_data(child_dob=CHILD_DOB.replace(day=2).isoformat())
        resp = _patch(api_client, reg_id, "alumno", other_day, token)
        assert resp.status_code == 400 and "CURP indica" in resp.data["child_curp"][0]
        resp = _patch(api_client, reg_id, "alumno", alumno_data(child_sex="masculino"), token)
        assert "sexo" in resp.data["child_curp"][0]
        resp = _patch(
            api_client,
            reg_id,
            "domicilio",
            {"address_postal_code": "123", "home_phone": "12"},
            token,
        )
        assert resp.status_code == 400
        assert set(resp.data) == {"address_postal_code", "home_phone"}
        resp = _patch(api_client, reg_id, "domicilio", {"address_state": "Texas"}, token)
        assert resp.data["address_state"] == ["Elija un estado de la lista."]
        resp = _patch(api_client, reg_id, "alumno", {"grade_applying": "7° Primaria"}, token)
        assert resp.data["grade_applying"] == ["Elija una opción de la lista."]

    def test_curp_checked_against_saved_birth_date(self, api_client):
        reg_id, token = _start(api_client)
        assert (
            _patch(
                api_client, reg_id, "alumno", {"child_dob": CHILD_DOB.isoformat()}, token
            ).status_code
            == 200
        )
        wrong = make_curp(CHILD_DOB.replace(day=3), "M", initials="LOHA")
        resp = _patch(api_client, reg_id, "alumno", {"child_curp": wrong}, token)
        assert resp.status_code == 400 and "child_curp" in resp.data

    def test_born_abroad_needs_no_curp(self, api_client):
        reg_id, token = _start(api_client)
        resp = _patch(
            api_client,
            reg_id,
            "alumno",
            alumno_data(
                child_birth_country="España",
                child_birth_state="Madrid",
                child_curp="",
                child_maternal_surname="",
            ),
            token,
        )
        assert resp.status_code == 200, resp.data
        assert resp.data["completeness"]["sections"]["alumno"]["complete"] is True
        assert resp.data["data"]["child_birth_state"] == "Madrid"

    def test_state_aliases_are_stored_canonical(self, api_client):
        reg_id, token = _start(api_client)
        resp = _patch(api_client, reg_id, "domicilio", {"address_state": "cdmx"}, token)
        assert resp.data["data"]["address_state"] == "Ciudad de México"

    def test_guardian_no_aplica_clears_the_block(self, api_client):
        reg_id, token = _start(api_client)
        assert (
            _patch(api_client, reg_id, "padre", SECTION_DATA["padre"](), token).status_code == 200
        )
        resp = _patch(api_client, reg_id, "padre", {"not_applicable": True}, token)
        assert resp.status_code == 200
        padre = RegistrationGuardian.objects.get(registration_id=reg_id, role="padre")
        assert padre.not_applicable and padre.email == "" and padre.curp == "" and padre.dob is None
        assert resp.data["completeness"]["sections"]["padre"]["complete"] is True

    def test_guardian_blocks_drive_parent1_and_parent2(self, api_client):
        reg_id, token = _start(api_client)
        _patch(api_client, reg_id, "madre", SECTION_DATA["madre"](), token)
        _patch(api_client, reg_id, "padre", SECTION_DATA["padre"](), token)
        reg = Registration.objects.get(pk=reg_id)
        assert (
            reg.parent1_name == "Marta Hernández Gil" and reg.parent1_occupation == "Independiente"
        )
        assert (reg.parent2_name, reg.parent2_email) == (
            "Julio López Pérez",
            "julio.ficha@ejemplo.test",
        )

    def test_unknown_section_is_404(self, api_client):
        reg_id, token = _start(api_client)
        assert _patch(api_client, reg_id, "documentos", {}, token).status_code == 404
        assert _patch(api_client, reg_id, "inicio", {}, token).status_code == 404

    def test_old_wizard_draft_is_upgraded_by_a_ficha_save(self, api_client):
        resp = api_client.post(
            START,
            {
                "child_first_name": "Leo",
                "child_last_name": "Mora Díaz",
                "child_dob": "2018-01-01",
                "level": "primaria",
                "grade_applying": "Primaria 2°",
                "parent1_name": "Iván Mora",
                "parent1_email": "ivan@ejemplo.test",
                "parent1_phone": "5534343434",
            },
            format="json",
        )
        reg_id = resp.data["id"]
        token = api_client.post(
            reverse("register-access", args=[reg_id]),
            {"token": resp.data["invite_token"]},
            format="json",
        ).data["session_token"]
        # The legacy grade spelling is accepted unchanged.
        saved = _patch(
            api_client,
            reg_id,
            "alumno",
            {"previous_school": "Kínder Ejemplo", "grade_applying": "Primaria 2°"},
            token,
        )
        assert saved.status_code == 200, saved.data
        reg = Registration.objects.get(pk=reg_id)
        assert reg.ficha_version == Registration.FichaVersion.FICHA
        assert reg.grade_applying == "2° Primaria"


# ── permissions ──────────────────────────────────────────────────────────
class TestPermissions:
    def test_no_session_or_wrong_session_is_401(self, api_client):
        reg_id, _token = _start(api_client)
        assert _get(api_client, reg_id).status_code == 401
        assert _get(api_client, reg_id, "nope").status_code == 401
        assert _patch(api_client, reg_id, "alumno", alumno_data(), "nope").status_code == 401
        assert _get(api_client, 999999, "nope").status_code == 401  # no enumeration

    def test_another_familys_session_is_denied(self, api_client):
        mine, _ = _start(api_client)
        _theirs, their_token = _start(api_client, contact_email="otra@ejemplo.test")
        assert _get(api_client, mine, their_token).status_code == 401
        assert (
            _patch(api_client, mine, "domicilio", {"address_street": "X"}, their_token).status_code
            == 401
        )

    def test_staff_without_admisiones_area_is_denied(self, api_client):
        reg_id, _ = _start(api_client)
        api_client.force_authenticate(staff("cafeteria", "visitas"))
        assert _get(api_client, reg_id).status_code == 401
        assert _patch(api_client, reg_id, "domicilio", {"address_street": "X"}).status_code == 401

    def test_staff_with_area_edits_anytime_audited_but_never_health(self, api_client):
        reg_id, token = _start(api_client)
        _fill(api_client, reg_id, token)
        assert _submit(api_client, reg_id, token).status_code == 200
        secretaria = staff("admisiones")
        api_client.force_authenticate(secretaria)
        data = _get(api_client, reg_id).data
        assert data["editable"] is True and data["medical_masked"] is True
        assert data["sections"]["salud"]["blood_type"] is None
        assert "signed_ip" in data["firma"]
        resp = _patch(api_client, reg_id, "domicilio", {"address_street": "Calle Corregida"})
        assert resp.status_code == 200
        entry = AuditLog.objects.filter(
            object_type="admissions.registration", context="admissions: ficha (domicilio)"
        ).get()
        assert entry.actor == secretaria
        assert entry.changes["domicilio.address_street"] == ["Calle Ficticia", "Calle Corregida"]
        assert _patch(api_client, reg_id, "salud", {"blood_type": "A+"}).status_code == 403

    def test_family_cannot_edit_a_sent_ficha(self, api_client):
        reg_id, token = _start(api_client)
        _fill(api_client, reg_id, token)
        assert _submit(api_client, reg_id, token).status_code == 200
        resp = _patch(api_client, reg_id, "domicilio", {"address_street": "Otra"}, token)
        assert resp.status_code == 409 and resp.data["code"] == "not_draft"
        assert _get(api_client, reg_id, token).data["editable"] is False


# ── health data ──────────────────────────────────────────────────────────
class TestHealthData:
    def test_new_health_fields_are_encrypted_at_rest(self, api_client):
        reg_id, token = _start(api_client)
        _patch(api_client, reg_id, "salud", salud_data(chronic_conditions="Asma leve"), token)
        with connection.cursor() as cur:
            cur.execute(
                "SELECT has_allergies, chronic_conditions, allergies FROM "
                "admissions_registration WHERE id=%s",
                [reg_id],
            )
            raw_has, raw_chronic, raw_allergies = cur.fetchone()
        assert (
            raw_has not in ("", "si") and "Asma" not in raw_chronic and "Polen" not in raw_allergies
        )
        reg = Registration.objects.get(pk=reg_id)
        assert (reg.has_allergies, reg.chronic_conditions, reg.allergies) == (
            "si",
            "Asma leve",
            "Polen",
        )

    def test_family_reads_own_health_data(self, api_client):
        reg_id, token = _start(api_client)
        _patch(api_client, reg_id, "salud", salud_data(), token)
        salud = _get(api_client, reg_id, token).data["sections"]["salud"]
        assert salud["blood_type"] == "O+" and salud["estatura"] == "118"

    def test_admin_reads_health_only_with_consent(self, api_client):
        reg_id, token = _start(api_client)
        _patch(api_client, reg_id, "salud", salud_data(consent_medical_data=False), token)
        api_client.force_authenticate(AdminFactory())
        assert _get(api_client, reg_id).data["sections"]["salud"]["has_allergies"] is None
        assert _patch(api_client, reg_id, "salud", {"peso": "23"}).status_code == 403
        Registration.objects.filter(pk=reg_id).update(consent_medical_data=True)
        assert _get(api_client, reg_id).data["sections"]["salud"]["has_allergies"] == "si"
        assert _patch(api_client, reg_id, "salud", {"peso": "23"}).status_code == 200
        entry = AuditLog.objects.filter(context="admissions: ficha (salud)").get()
        assert entry.changes["salud.peso"] == ["[redacted]", "[redacted]"]

    def test_no_allergies_clears_which(self, api_client):
        reg_id, token = _start(api_client)
        _patch(api_client, reg_id, "salud", salud_data(), token)
        resp = _patch(api_client, reg_id, "salud", {"has_allergies": "no"}, token)
        assert resp.data["data"]["allergies"] == ""

    def test_measures_are_validated(self, api_client):
        reg_id, token = _start(api_client)
        resp = _patch(api_client, reg_id, "salud", {"estatura": "1.20", "blood_type": "Z+"}, token)
        assert resp.status_code == 400 and set(resp.data) == {"estatura", "blood_type"}


# ── submit ───────────────────────────────────────────────────────────────
class TestSubmit:
    def test_incomplete_ficha_lists_every_section(self, api_client):
        reg_id, token = _start(api_client)
        resp = _submit(api_client, reg_id, token, accept_privacy=False, signed_name="")
        assert resp.status_code == 400 and resp.data["code"] == "incomplete"
        sections = resp.data["sections"]
        assert {"alumno", "domicilio", "salud", "padre", "madre", "emergencia", "firma"} <= set(
            sections
        )
        assert set(sections["firma"]) == {"accept_privacy", "signed_name"}
        assert Registration.objects.get(pk=reg_id).status == Registration.Status.DRAFT

    def test_signature_needs_a_full_name(self, api_client):
        reg_id, token = _start(api_client)
        _fill(api_client, reg_id, token)
        resp = _submit(api_client, reg_id, token, signed_name="Marta")
        assert resp.status_code == 400 and list(resp.data["sections"]) == ["firma"]

    def test_medical_consent_is_required(self, api_client):
        reg_id, token = _start(api_client)
        _fill(api_client, reg_id, token, salud={"consent_medical_data": False})
        resp = _submit(api_client, reg_id, token)
        assert resp.status_code == 400
        assert list(resp.data["sections"]) == ["salud"]
        assert "consent_medical_data" in resp.data["sections"]["salud"]

    def test_complete_ficha_submits_without_documents(self, api_client):
        from apps.legal.models import PrivacyNoticeVersion

        PrivacyNoticeVersion.objects.create(
            version="2099.1", body="Texto de prueba.", effective_date="2099-01-01", is_active=True
        )
        notice = PrivacyNoticeVersion.current()
        reg_id, token = _start(api_client)
        _fill(api_client, reg_id, token)
        mail.outbox.clear()
        resp = _submit(api_client, reg_id, token, consent_photos_media=True)
        assert resp.status_code == 200, resp.data
        reg = Registration.objects.get(pk=reg_id)
        assert reg.status == Registration.Status.SUBMITTED and reg.submitted_at
        assert reg.documents.count() == 0
        assert reg.signed_name == "Marta Hernández Gil" and reg.signed_at
        assert reg.signed_ip == "127.0.0.1"  # test client's REMOTE_ADDR
        assert notice is not None
        assert reg.privacy_notice_version == notice and reg.privacy_accepted_at
        assert reg.consent_photos_media is True
        assert mail.outbox[0].to == ["marta.ficha@ejemplo.test"]
        assert "Ficha de inscripción recibida" in mail.outbox[0].subject

    def test_age_rule_for_families_not_for_staff(self, api_client):
        reg_id, token = _start(api_client, grade_applying="3° Primaria")
        _fill(api_client, reg_id, token, alumno={"grade_applying": "3° Primaria"})
        resp = _submit(api_client, reg_id, token)
        assert resp.status_code == 400
        assert "años cumplidos" in resp.data["sections"]["alumno"]["grade_applying"][0]
        api_client.force_authenticate(staff("admisiones"))
        assert _submit(api_client, reg_id).status_code == 200

    def test_age_rule_uses_the_cycle_applied_for(self, api_client):
        # Next cycle: a child one year younger fits 1° Primaria.
        reg_id, token = _start(api_client, cycle="proximo")
        younger = child_dob_for(0)
        _fill(
            api_client,
            reg_id,
            token,
            alumno={
                "cycle": cycles.next_cycle(),
                "child_dob": younger.isoformat(),
                "child_curp": make_curp(younger, "M", initials="LOHA"),
            },
        )
        assert _submit(api_client, reg_id, token).status_code == 200

    def test_second_submit_is_refused(self, api_client):
        reg_id, token = _start(api_client)
        _fill(api_client, reg_id, token)
        assert _submit(api_client, reg_id, token).status_code == 200
        assert _submit(api_client, reg_id, token).status_code == 400

    def test_convert_still_creates_both_family_accounts(self, api_client):
        reg_id, token = _start(api_client)
        _fill(api_client, reg_id, token)
        assert _submit(api_client, reg_id, token).status_code == 200
        api_client.force_authenticate(AdminFactory())
        Registration.objects.filter(pk=reg_id).update(status=Registration.Status.APPROVED)
        resp = api_client.post(reverse("register-convert", args=[reg_id]), {}, format="json")
        assert resp.status_code == 201, resp.data
        sp = StudentProfile.objects.get(pk=resp.data["student"])
        assert {"marta.ficha@ejemplo.test", "julio.ficha@ejemplo.test"} <= set(
            sp.parents.values_list("email", flat=True)
        )
        assert sp.birth_date == CHILD_DOB and sp.curp == alumno_data()["child_curp"]
        assert sp.emergency_name == "Rosa Gil Ramos" and sp.allergies == "Polen"
        marta = User.objects.get(email="marta.ficha@ejemplo.test")
        assert (marta.first_name, marta.last_name) == ("Marta", "Hernández Gil")


# ── continuar mi ficha ───────────────────────────────────────────────────
class TestResume:
    url = reverse("register-resume")

    def test_same_answer_with_or_without_a_draft(self, api_client, sync_background):
        reg_id, _ = _start(api_client)
        before = Registration.objects.get(pk=reg_id).invite_token_hash
        mail.outbox.clear()
        known = api_client.post(self.url, {"email": "MARTA.ficha@ejemplo.test"}, format="json")
        unknown = api_client.post(self.url, {"email": "nadie@ejemplo.test"}, format="json")
        assert known.status_code == unknown.status_code == 200
        assert known.data == unknown.data
        assert len(mail.outbox) == 1 and mail.outbox[0].to == ["marta.ficha@ejemplo.test"]
        assert f"/pre-registro?rid={reg_id}&token=" in mail.outbox[0].body
        assert Registration.objects.get(pk=reg_id).invite_token_hash != before
        assert sync_background == ["admissions-resume"]

    def test_sent_ficha_is_not_resumed(self, api_client, sync_background):
        reg_id, token = _start(api_client)
        _fill(api_client, reg_id, token)
        _submit(api_client, reg_id, token)
        mail.outbox.clear()
        assert (
            api_client.post(
                self.url, {"email": "marta.ficha@ejemplo.test"}, format="json"
            ).status_code
            == 200
        )
        assert mail.outbox == [] and sync_background == []

    def test_resumed_link_opens_the_draft(self, api_client, sync_background):
        reg_id, _ = _start(api_client)
        mail.outbox.clear()
        api_client.post(self.url, {"email": "marta.ficha@ejemplo.test"}, format="json")
        raw = mail.outbox[0].body.split(f"rid={reg_id}&token=")[1].split()[0].strip("<>\"')")
        session = api_client.post(
            reverse("register-access", args=[reg_id]), {"token": raw}, format="json"
        )
        assert session.status_code == 200
        assert _get(api_client, reg_id, session.data["session_token"]).status_code == 200

    def test_invalid_email_is_400(self, api_client):
        assert (
            api_client.post(self.url, {"email": "no-es-correo"}, format="json").status_code == 400
        )

    def test_rate_limited(self, api_client, settings, sync_background):
        from django.core.cache import cache

        settings.RATELIMIT_ENABLE = True
        cache.clear()
        codes = [
            api_client.post(self.url, {"email": f"r{i}@ejemplo.test"}, format="json").status_code
            for i in range(4)
        ]
        assert codes == [200, 200, 200, 429]
