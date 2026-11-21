"""Expediente (Fase 5): editable templates, the five «send» actions, the ficha
link gate (private ficha: only once the exam is «Aceptado») and the signed
visit link."""

import datetime as dt
from urllib.parse import parse_qs, unquote, urlparse

import pytest
from django.core import mail
from django.urls import reverse

from apps.admissions import process, process_messages
from apps.admissions.models import PreRegistration, Registration
from apps.admissions.process_fixtures import (
    admitted,
    at_stage,
    future,
    make_lead,
    make_registration,
    staff_client,
)
from apps.content.models import SiteSettings
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

Stage = PreRegistration.Stage


@pytest.fixture(autouse=True)
def _mail(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.FRONTEND_URL = "https://colegio.ejemplo.test"
    settings.BACKEND_URL = ""


def action(lead, name):
    return reverse("case-action", args=[lead.pk, name])


# ── templates ─────────────────────────────────────────────────────────────
def test_render_substitutes_only_known_placeholders():
    out = process_messages.render(
        "Hola {tutor}, {alumno} {{literal}} {desconocido}", {"tutor": "Marta", "alumno": "Lucía"}
    )
    assert out == "Hola Marta, Lucía {literal} {desconocido}"
    # Attribute or index access never evaluates anything.
    assert process_messages.render("{tutor.__class__}", {"tutor": "Marta"}) == "{tutor.__class__}"
    assert process_messages.render("{tutor!r}", {"tutor": "Marta"}) == "{tutor}"


@pytest.mark.parametrize(
    "text,ok",
    [
        ("Hola {tutor}, su liga: {liga}", True),
        ("Hola {nombre}", False),
        ("Hola {tutor.__class__}", False),
        ("Hola {tutor!r}", False),
        ("Hola {tutor:>10}", False),
        ("Hola {tutor", False),
        ("Hola {{sin datos}}", True),
    ],
)
def test_template_validation(text, ok):
    assert (process_messages.template_errors("visit_link", text) == []) is ok


def test_defaults_are_usted_and_have_no_em_dashes():
    for key, text in process_messages.DEFAULTS.items():
        assert "—" not in text and "–" not in text, key
        assert process_messages.template_errors(key, text) == [], key
        assert " tú " not in text and " tu " not in text, key


def test_templates_endpoint(admin_client):
    url = reverse("cases-templates")
    got = admin_client.get(url).data
    assert set(got["templates"]) == set(process_messages.DEFAULTS)
    assert "{liga}" in got["placeholders"]["costs"] and got["customized"] == []
    # «Aceptado» carries the ficha link: its data and the hint say so.
    assert {"{liga}", "{vence}"} <= set(got["placeholders"]["exam_result_accepted"])
    assert "{liga}" in got["defaults"]["exam_result_accepted"]
    assert "{vence}" in got["defaults"]["exam_result_accepted"]
    assert "Enviar resultado y ficha" in got["hints"]["exam_result_accepted"]
    assert "Aceptado" in got["hints"]["ficha_link"]
    bad = admin_client.patch(url, {"costs": "Hola {nombre}", "inventada": "x"}, format="json")
    assert bad.status_code == 400 and set(bad.data) == {"costs", "inventada"}
    ok = admin_client.patch(
        url, {"costs": "Estimado(a) {tutor}: cuotas de {nivel} en {liga}"}, format="json"
    )
    assert ok.status_code == 200 and ok.data["customized"] == ["costs"]
    assert SiteSettings.load().tpl_process["costs"].startswith("Estimado(a)")
    assert AuditLog.objects.filter(
        object_type="content.sitesettings", context__contains="plantillas"
    ).exists()
    reset = admin_client.patch(url, {"costs": ""}, format="json")
    assert (
        reset.data["customized"] == []
        and reset.data["templates"]["costs"] == process_messages.DEFAULTS["costs"]
    )


# ── send costs ────────────────────────────────────────────────────────────
def test_send_costs_by_email_attaches_the_level_pdf(admin_client):
    SiteSettings.objects.update_or_create(
        pk=1, defaults={"tpl_process": {"costs": "Hola {tutor}: {nivel} {liga}"}}
    )
    lead = make_lead()
    r = admin_client.post(action(lead, "send-costs"), {}, format="json")
    assert r.status_code == 200, r.data
    assert (
        r.data["sent"] is True
        and r.data["channel"] == "email"
        and r.data["sent_to"] == "marta@ejemplo.test"
    )
    assert r.data["link"] == "https://colegio.ejemplo.test/api/v1/admissions/cuotas/primaria.pdf"
    assert r.data["whatsapp_text"] == f"Hola Marta Ejemplo: Primaria {r.data['link']}"
    assert r.data["whatsapp_url"].startswith("https://wa.me/525512345678?text=Hola%20Marta")
    msg = mail.outbox[-1]
    assert msg.to == ["marta@ejemplo.test"] and msg.body == r.data["whatsapp_text"]
    name, content, mimetype = msg.attachments[0]
    assert (
        name == "cuotas-primaria.pdf"
        and mimetype == "application/pdf"
        and content.startswith(b"%PDF")
    )
    lead.refresh_from_db()
    assert lead.costs_sent_at is not None
    assert r.data["case"]["next_action"]["code"] == "send_visit_link"
    row = AuditLog.objects.filter(
        object_type="admissions.preregistration", object_id=str(lead.pk)
    ).latest("pk")
    assert row.changes == {"sent": "costs", "channel": "email", "email_sent": True}


def test_send_costs_without_email_is_a_whatsapp_text(admin_client):
    lead = make_lead(parent_email="")
    r = admin_client.post(action(lead, "send-costs"), {}, format="json")
    assert r.status_code == 200 and r.data["sent"] is False and r.data["channel"] == "whatsapp"
    assert "cuotas/primaria.pdf" in r.data["whatsapp_text"] and not mail.outbox
    lead.refresh_from_db()
    assert lead.costs_sent_at is not None
    forced = admin_client.post(action(lead, "send-costs"), {"channel": "email"}, format="json")
    assert forced.status_code == 400 and "channel" in forced.data


def test_unknown_action_is_404(admin_client):
    lead = make_lead()
    assert admin_client.post(action(lead, "send-nothing"), {}, format="json").status_code == 404


# ── visit link: the signed token attaches the booking ─────────────────────
def test_visit_link_token_attaches_the_public_booking(admin_client):
    from rest_framework.test import APIClient

    from apps.admissions.process_fixtures import make_slot
    from apps.bookings.models import Booking

    api_client = APIClient()  # the family: anonymous

    lead = make_lead(parent_email="")
    r = admin_client.post(action(lead, "send-visit-link"), {"channel": "whatsapp"}, format="json")
    assert r.status_code == 200 and r.data["channel"] == "whatsapp"
    link = urlparse(r.data["link"])
    assert link.path == "/agendar-visita"
    token = unquote(parse_qs(link.query)["lead"][0])
    assert ":" in token and "marta" not in token.lower()  # signed, no personal data
    assert process.lead_from_token(token) == lead
    assert process.lead_from_token(token + "x") is None

    slot = make_slot(days=4)
    created = api_client.post(
        reverse("bookings-create"),
        {
            "slot": slot.pk,
            "parent_name": "Marta Ejemplo",
            "parent_email": "otra-direccion@ejemplo.test",
            "parent_phone": "5512345678",
            "num_attendees": 2,
            "lead_token": token,
        },
        format="json",
    )
    assert created.status_code == 201, created.data
    booking = Booking.objects.get(pk=created.data["id"])
    assert booking.pre_registration_id == lead.pk
    lead.refresh_from_db()
    assert lead.stage == "visita"  # booked from «Informes»: the case moves on
    row = AuditLog.objects.filter(
        object_type="admissions.preregistration", object_id=str(lead.pk)
    ).latest("pk")
    assert row.actor_label == "system:visit-link" and row.changes["booking"] == booking.pk

    # A forged token never blocks a family: the booking goes through unlinked.
    other = api_client.post(
        reverse("bookings-create"),
        {
            "slot": slot.pk,
            "parent_name": "Otra",
            "parent_email": "otra@ejemplo.test",
            "parent_phone": "5598765432",
            "num_attendees": 1,
            "lead_token": "no-es-valido",
        },
        format="json",
    )
    assert other.status_code == 201
    assert Booking.objects.get(pk=other.data["id"]).pre_registration_id is None


def test_expired_visit_token_is_ignored(monkeypatch):
    lead = make_lead()
    token = process.lead_token(lead)
    monkeypatch.setattr(process, "LEAD_TOKEN_MAX_AGE", -1)
    assert process.lead_from_token(token) is None


# ── ficha link gate (the ficha is private) ──────────────────────────────────
@pytest.mark.parametrize(
    "stage,extra",
    [
        (Stage.INFORMES, {}),
        (Stage.VISITA, {}),
        (Stage.EXAMEN, {}),
        # «Examen agendado» used to be enough: not any more.
        (Stage.EXAMEN, {"exam_at": future(3)}),
        # Moved to «Documentación» by hand, without the result «Aceptado».
        (Stage.DOCUMENTACION, {"exam_at": future(-2)}),
    ],
)
def test_ficha_link_is_refused_until_the_exam_is_accepted(admin_client, stage, extra):
    lead = at_stage(make_lead(), stage, **extra)
    r = admin_client.post(action(lead, "send-ficha-link"), {}, format="json")
    assert r.status_code == 409 and r.data["code"] == "not_admitted"
    assert r.data["overridable"] is True
    assert r.data["detail"] == (
        "La ficha de inscripción se envía cuando el examen está registrado como Aceptado."
    )
    assert not Registration.objects.filter(pre_registration=lead).exists()
    lead.refresh_from_db()
    assert lead.ficha_link_sent_at is None


def test_ficha_link_once_accepted_reuses_the_invite(admin_client):
    lead = admitted(make_lead())
    assert process.ficha_link_gate(lead)["allowed"] is True
    r = admin_client.post(action(lead, "send-ficha-link"), {}, format="json")
    assert r.status_code == 200, r.data
    reg = Registration.objects.get(pre_registration=lead)
    assert reg.status == "draft" and reg.invite_token_hash
    # The ficha link is Fase 2's (services.invite_url_for): same origin, rid + token.
    assert r.data["link"].startswith("https://colegio.ejemplo.test/pre-registro?")
    assert f"?rid={reg.pk}&token=" in r.data["link"]
    assert r.data["sent"] is True and r.data["link"] in r.data["whatsapp_text"]
    assert len(mail.outbox) == 1 and r.data["link"] in mail.outbox[0].body
    lead.refresh_from_db()
    assert lead.ficha_link_sent_at and lead.stage == "documentacion"
    # Sending again refreshes the same draft's token (no second ficha).
    again = admin_client.post(
        action(lead, "send-ficha-link"), {"channel": "whatsapp"}, format="json"
    )
    assert (
        again.status_code == 200 and Registration.objects.filter(pre_registration=lead).count() == 1
    )
    assert len(mail.outbox) == 1  # WhatsApp only: no email


def test_ficha_link_override_needs_an_admin_and_a_reason(admin_client):
    lead = at_stage(make_lead(), Stage.EXAMEN, exam_at=future(3))
    secretaria = staff_client("admisiones")
    denied = secretaria.post(
        action(lead, "send-ficha-link"),
        {"override": True, "override_reason": "La dirección lo autorizó."},
        format="json",
    )
    assert denied.status_code == 409 and denied.data["code"] == "admin_only"
    # No reason, no override (the admin is told what is missing).
    for body in ({"override": True}, {"override": True, "override_reason": "   "}):
        missing = admin_client.post(action(lead, "send-ficha-link"), body, format="json")
        assert missing.status_code == 400 and "override_reason" in missing.data
    assert not Registration.objects.filter(pre_registration=lead).exists()
    ok = admin_client.post(
        action(lead, "send-ficha-link"),
        {"override": True, "override_reason": "  Hermano ya inscrito;  examen el lunes. "},
        format="json",
    )
    assert ok.status_code == 200 and ok.data["override"] is True
    row = AuditLog.objects.filter(
        object_type="admissions.preregistration", object_id=str(lead.pk), changes__sent="ficha_link"
    ).latest("pk")
    assert row.changes["override"] is True
    assert row.changes["override_reason"] == "Hermano ya inscrito; examen el lunes."
    invite = AuditLog.objects.filter(
        object_type="admissions.preregistration", object_id=str(lead.pk), changes__has_key="invite"
    ).latest("pk")
    assert invite.changes["override_reason"] == "Hermano ya inscrito; examen el lunes."


def test_override_is_not_needed_nor_used_once_accepted(admin_client):
    lead = admitted(make_lead())
    r = admin_client.post(
        action(lead, "send-ficha-link"),
        {"override": True, "override_reason": "Por si acaso."},
        format="json",
    )
    assert r.status_code == 200 and r.data["override"] is False


@pytest.mark.parametrize(
    "stage,code",
    [(Stage.CERRADO, "closed"), (Stage.INSCRITO, "enrolled")],
)
def test_closed_or_enrolled_cases_never_get_a_ficha_link(admin_client, stage, code):
    lead = at_stage(make_lead(), stage, exam_result="aceptado", exam_at=future(-3))
    r = admin_client.post(
        action(lead, "send-ficha-link"),
        {"override": True, "override_reason": "Prueba."},
        format="json",
    )
    assert r.status_code == 409 and r.data["code"] == code and r.data["overridable"] is False


def test_ficha_link_refused_once_the_ficha_was_sent(admin_client):
    lead = admitted(make_lead())
    make_registration(lead, status=Registration.Status.SUBMITTED)
    r = admin_client.post(action(lead, "send-ficha-link"), {}, format="json")
    assert r.status_code == 409 and r.data["code"] == "already_applied"


def test_case_detail_explains_the_gate(admin_client):
    lead = at_stage(make_lead(), Stage.EXAMEN, exam_at=future(3))
    gate = admin_client.get(reverse("case-detail", args=[lead.pk])).data["ficha_link"]
    assert gate["allowed"] is False and gate["code"] == "not_admitted"
    assert gate["reason"].startswith("La ficha de inscripción se envía cuando")
    assert gate["can_override"] is True  # the admin_client is an administrator
    lead = admitted(lead)
    gate = admin_client.get(reverse("case-detail", args=[lead.pk])).data["ficha_link"]
    assert gate["allowed"] is True and gate["reason"] == ""


# ── exam date and result ──────────────────────────────────────────────────
def test_send_exam_date_and_result(admin_client):
    lead = at_stage(make_lead(), Stage.EXAMEN)
    assert admin_client.post(action(lead, "send-exam-date"), {}, format="json").status_code == 400
    exam = future(6, 9)
    PreRegistration.objects.filter(pk=lead.pk).update(
        exam_at=exam, exam_results_at=exam + dt.timedelta(days=2)
    )
    r = admin_client.post(action(lead, "send-exam-date"), {}, format="json")
    assert r.status_code == 200 and r.data["sent"] is True
    assert (
        process_messages.when_text(exam) in r.data["whatsapp_text"]
        and "a las 9:00" in r.data["whatsapp_text"]
    )
    assert admin_client.post(action(lead, "send-exam-result"), {}, format="json").status_code == 400
    admin_client.patch(
        reverse("case-stage", args=[lead.pk, "examen"]), {"result": "aceptado"}, format="json"
    )
    res = admin_client.post(
        action(lead, "send-exam-result"), {"channel": "whatsapp"}, format="json"
    )
    assert res.status_code == 200 and "fue aceptado/a" in res.data["whatsapp_text"]
    lead.refresh_from_db()
    assert lead.exam_date_sent_at and lead.exam_result_sent_at
    # «Aceptado» carries the ficha (one message): the link went with it.
    assert lead.ficha_link_sent_at and res.data["link"] in res.data["whatsapp_text"]


# ── «Enviar resultado y ficha» ────────────────────────────────────────────
def test_accepted_result_carries_the_ficha_link_by_email(admin_client):
    lead = admitted(make_lead())
    r = admin_client.post(action(lead, "send-exam-result"), {}, format="json")
    assert r.status_code == 200 and r.data["sent"] is True, r.data
    reg = Registration.objects.get(pre_registration=lead)
    assert reg.status == "draft" and r.data["registration"] == reg.pk
    assert r.data["link"].startswith(
        f"https://colegio.ejemplo.test/pre-registro?rid={reg.pk}&token="
    )
    text = r.data["whatsapp_text"]
    assert text.startswith("¡Felicidades, Marta Ejemplo! Lucía Prueba Ejemplo fue aceptado/a")
    assert f"enlace personal: {r.data['link']} (vence el " in text
    assert "{" not in text and "—" not in text
    # The email: the result, the link as its button, the plain part verbatim.
    assert len(mail.outbox) == 1
    msg = mail.outbox[0]
    assert msg.subject == "Resultado del examen de admisión de Lucía Prueba Ejemplo"
    assert r.data["link"] in msg.body
    html = msg.alternatives[0][0]
    assert "Llenar la ficha de inscripción" in html and "enlace personal (vence el" in html
    lead.refresh_from_db()
    assert lead.exam_result_sent_at and lead.ficha_link_sent_at
    assert lead.exam_result_sent_at == lead.ficha_link_sent_at
    row = AuditLog.objects.filter(
        object_type="admissions.preregistration",
        object_id=str(lead.pk),
        changes__sent="exam_result_accepted",
    ).latest("pk")
    assert row.changes["registration"] == reg.pk
    # The next step is no longer «Enviar resultado y ficha».
    assert process.next_action(lead)["code"] == "await_ficha"


def test_next_step_after_accepted_is_result_and_ficha(admin_client):
    lead = at_stage(make_lead(), Stage.EXAMEN, exam_at=future(-1))
    admin_client.patch(
        reverse("case-stage", args=[lead.pk, "examen"]), {"result": "aceptado"}, format="json"
    )
    lead.refresh_from_db()
    assert lead.stage == "documentacion"
    assert process.next_action(lead) == {
        "code": "send_exam_result",
        "label": "Enviar resultado y ficha",
    }
    # Sent by WhatsApp: no email, both stamps.
    r = admin_client.post(action(lead, "send-exam-result"), {"channel": "whatsapp"}, format="json")
    assert r.status_code == 200 and r.data["channel"] == "whatsapp" and not mail.outbox
    assert r.data["whatsapp_url"].startswith("https://wa.me/525512345678?text=")
    lead.refresh_from_db()
    assert lead.ficha_link_sent_at and lead.exam_result_sent_at
    # A resend of the ficha alone stays available.
    assert process.next_action(lead)["code"] == "await_ficha"
    assert (
        admin_client.post(
            action(lead, "send-ficha-link"), {"channel": "whatsapp"}, format="json"
        ).status_code
        == 200
    )


def test_edited_accepted_template_without_link_still_gets_it(admin_client):
    SiteSettings.objects.update_or_create(
        pk=1,
        defaults={
            "tpl_process": {"exam_result_accepted": "Hola {tutor}, {alumno} fue aceptado/a."}
        },
    )
    lead = admitted(make_lead())
    r = admin_client.post(action(lead, "send-exam-result"), {"channel": "whatsapp"}, format="json")
    text = r.data["whatsapp_text"]
    assert text.startswith("Hola Marta Ejemplo, Lucía Prueba Ejemplo fue aceptado/a.")
    assert text.rstrip().endswith(")."), text
    assert f"enlace personal: {r.data['link']} (vence el " in text


def test_accepted_result_without_a_possible_link_is_the_result_alone(admin_client):
    lead = admitted(make_lead())
    make_registration(lead, status=Registration.Status.SUBMITTED)  # the ficha was already sent
    r = admin_client.post(action(lead, "send-exam-result"), {"channel": "whatsapp"}, format="json")
    assert r.status_code == 200
    assert r.data["link"] == "" and "fue aceptado/a" in r.data["whatsapp_text"]
    assert "{liga}" not in r.data["whatsapp_text"] and "enlace" not in r.data["whatsapp_text"]
    lead.refresh_from_db()
    assert lead.exam_result_sent_at and lead.ficha_link_sent_at is None


def test_not_accepted_result_text(admin_client):
    lead = at_stage(
        make_lead(),
        Stage.CERRADO,
        exam_at=future(-2),
        exam_result="no_aceptado",
        closed_outcome="no_aceptado",
        closed_reason="Lectura",
    )
    r = admin_client.post(action(lead, "send-exam-result"), {"channel": "whatsapp"}, format="json")
    assert (
        r.status_code == 200 and "no nos es posible ofrecerle un lugar" in r.data["whatsapp_text"]
    )
    assert "Lectura" not in r.data["whatsapp_text"]  # the internal reason never goes to the family
