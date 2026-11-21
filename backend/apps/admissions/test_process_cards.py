"""Expediente (Fase 5): «Nuevo prospecto», the list, the full case, the stage
cards (closing reasons, exam rules, visit outcome) and the permissions."""

import datetime as dt

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.admissions.models import PreRegistration
from apps.admissions.process_fixtures import (
    at_stage,
    future,
    make_booking,
    make_lead,
    make_payment,
    make_registration,
    staff_client,
)
from apps.bookings.models import Booking
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

Stage = PreRegistration.Stage
CASES = reverse("cases")


def card(lead, stage):
    return (
        reverse("case-stage-visita", args=[lead.pk])
        if stage == "visita"
        else reverse("case-stage", args=[lead.pk, stage])
    )


# ── «Nuevo prospecto» ─────────────────────────────────────────────────────
PROSPECT = {
    "child_name": "Mateo Prueba Ejemplo",
    "parent_name": "Laura Ejemplo",
    "parent_phone": "55 1111 2222",
    "previous_school": "Colegio Demo",
    "child_age": 7,
    "grade_applying": "2° Primaria",
    "cycle": "proximo",
}


def test_new_prospect_with_the_seven_informes_fields(admin_client):
    r = admin_client.post(CASES, PROSPECT, format="json")
    assert r.status_code == 201, r.data
    lead = PreRegistration.objects.get(pk=r.data["id"])
    assert (lead.child_first_name, lead.child_last_name) == ("Mateo", "Prueba Ejemplo")
    assert lead.parent_phone == "5511112222" and lead.parent_email == ""
    assert (lead.level, lead.grade_applying, lead.child_age, lead.previous_school) == (
        "primaria",
        "2° Primaria",
        7,
        "Colegio Demo",
    )
    from apps.admissions.cycles import next_cycle

    assert lead.cycle == next_cycle() and lead.stage == "informes" and lead.status == "pending"
    assert r.data["duplicates"] == [] and r.data["next_action"]["code"] == "send_costs"
    assert AuditLog.objects.filter(
        object_type="admissions.preregistration", object_id=str(lead.pk), action="create"
    ).exists()


def test_new_prospect_validation(admin_client):
    bad = admin_client.post(
        CASES,
        {**PROSPECT, "parent_phone": "123", "grade_applying": "7° Primaria", "cycle": "2030"},
        format="json",
    )
    assert bad.status_code == 400
    assert set(bad.data) >= {"parent_phone", "grade_applying", "cycle"}


def test_duplicates_warn_but_never_block(admin_client):
    first = make_lead(parent_phone="+52 1 55 1111 2222", parent_email="laura@ejemplo.test")
    dry = admin_client.post(f"{CASES}?dry_run=1", PROSPECT, format="json")
    assert dry.status_code == 200 and dry.data["created"] is False
    assert [d["id"] for d in dry.data["duplicates"]] == [first.pk]
    assert PreRegistration.objects.count() == 1
    by_email = admin_client.post(
        CASES,
        {**PROSPECT, "parent_phone": "5599998888", "parent_email": "LAURA@ejemplo.test"},
        format="json",
    )
    assert by_email.status_code == 201 and [d["id"] for d in by_email.data["duplicates"]] == [
        first.pk
    ]


# ── the list ──────────────────────────────────────────────────────────────
def test_list_filters_counts_next_action_and_days_waiting(admin_client):
    a = make_lead(child_first_name="Ana", level="primaria")
    b = at_stage(
        make_lead(
            child_first_name="Beto",
            level="secundaria",
            grade_applying="1° Secundaria",
            parent_email="b@ejemplo.test",
        ),
        Stage.EXAMEN,
    )
    c = at_stage(
        make_lead(child_first_name="Carla", parent_email="c@ejemplo.test"),
        Stage.CERRADO,
        closed_outcome="no_interesa",
    )
    PreRegistration.objects.filter(pk=a.pk).update(
        stage_changed_at=timezone.now() - dt.timedelta(days=4)
    )
    r = admin_client.get(CASES)
    assert r.status_code == 200 and r.data["count"] == 3
    assert r.data["counts"] == {
        "informes": 1,
        "visita": 0,
        "examen": 1,
        "documentacion": 0,
        "inscrito": 0,
        "cerrado": 1,
    }
    rows = {row["id"]: row for row in r.data["results"]}
    assert rows[a.pk]["days_waiting"] == 4 and rows[a.pk]["next_action"]["code"] == "send_costs"
    assert rows[b.pk]["next_action"] == {"code": "schedule_exam", "label": "Agendar examen"}
    assert (
        rows[c.pk]["next_action"] is None and rows[c.pk]["closed_outcome_label"] == "No le interesa"
    )

    only_exam = admin_client.get(CASES, {"stage": "examen"})
    assert [row["id"] for row in only_exam.data["results"]] == [b.pk]
    # Counts ignore the stage filter (the tabs keep their numbers) but follow the rest.
    assert only_exam.data["counts"]["informes"] == 1
    assert admin_client.get(CASES, {"stage": "informes,examen"}).data["count"] == 2
    assert admin_client.get(CASES, {"closed": "true"}).data["count"] == 1
    assert admin_client.get(CASES, {"closed": "false"}).data["count"] == 2
    assert admin_client.get(CASES, {"level": "secundaria"}).data["count"] == 1
    sec = admin_client.get(CASES, {"level": "secundaria"}).data["counts"]
    assert sec["informes"] == 0 and sec["examen"] == 1
    assert admin_client.get(CASES, {"q": "carla"}).data["count"] == 1
    assert admin_client.get(CASES, {"stage": "nope"}).status_code == 400
    waited = admin_client.get(CASES, {"ordering": "stage_changed_at"}).data["results"]
    assert waited[0]["id"] == a.pk


def test_case_detail_shape(admin_client):
    lead = at_stage(make_lead(), Stage.DOCUMENTACION, exam_at=future(-3))
    reg = make_registration(lead)
    booking = make_booking(lead, status=Booking.Status.ATTENDED)
    make_payment(lead)
    r = admin_client.get(reverse("case-detail", args=[lead.pk]))
    assert r.status_code == 200
    d = r.data
    assert set(d) >= {
        "lead",
        "informes",
        "visita",
        "examen",
        "documentacion",
        "inscrito",
        "ficha",
        "ficha_link",
        "history",
        "next_action",
        "days_waiting",
    }
    assert d["ficha"]["id"] == reg.pk and d["ficha"]["status"] == "submitted"
    assert "complete" in d["ficha"]["completeness"]
    assert d["visita"]["bookings"][0]["id"] == booking.pk
    assert d["inscrito"]["payments"][0]["summary"].startswith("$9,500.00 · transferencia")
    gates = {g["key"]: g for g in d["inscrito"]["gates"]["items"]}
    assert gates["stage"]["ok"] and gates["ficha"]["ok"] and gates["payment"]["ok"]
    assert gates["documents"]["state"] == "unknown" and gates["documents"]["ok"]
    assert d["inscrito"]["gates"]["ready"] is True
    assert d["ficha_link"]["allowed"] is True
    assert admin_client.get(reverse("case-detail", args=[999999])).status_code == 404


# ── Informes ──────────────────────────────────────────────────────────────
def test_informes_edits_contacts_and_moves_on(admin_client):
    lead = make_lead()
    r = admin_client.patch(
        card(lead, "informes"),
        {
            "child_name": "Lucía Nueva Prueba",
            "parent_phone": "55-3333-4444",
            "grade_applying": "1° secundaria",
            "outcome": "continua_visita",
        },
        format="json",
    )
    assert r.status_code == 200, r.data
    lead.refresh_from_db()
    assert (lead.child_first_name, lead.child_last_name, lead.parent_phone) == (
        "Lucía",
        "Nueva Prueba",
        "5533334444",
    )
    assert (lead.grade_applying, lead.level, lead.stage, lead.informes_outcome) == (
        "1° Secundaria",
        "secundaria",
        "visita",
        "continua_visita",
    )
    row = AuditLog.objects.filter(
        object_type="admissions.preregistration", object_id=str(lead.pk)
    ).latest("pk")
    assert row.changes["stage"] == ["informes", "visita"] and row.changes["parent_phone"] == [
        "5512345678",
        "5533334444",
    ]


def test_informes_no_interesa_needs_a_reason(admin_client):
    lead = make_lead()
    r = admin_client.patch(card(lead, "informes"), {"outcome": "no_interesa"}, format="json")
    assert r.status_code == 400 and "reason" in r.data
    r = admin_client.patch(
        card(lead, "informes"),
        {"outcome": "no_interesa", "reason": "Le queda lejos"},
        format="json",
    )
    assert r.status_code == 200 and r.data["stage"] == "cerrado"
    assert (
        r.data["closed"]["outcome"] == "no_interesa"
        and r.data["closed"]["reason"] == "Le queda lejos"
    )


# ── Visita guiada ─────────────────────────────────────────────────────────
def test_visit_attended_and_books_the_exam(admin_client):
    lead = at_stage(make_lead(), Stage.VISITA)
    booking = make_booking(lead)
    r = admin_client.patch(
        card(lead, "visita"),
        {"outcome": "agenda_examen", "note": "Le gustó el patio"},
        format="json",
    )
    assert r.status_code == 200 and r.data["stage"] == "examen"
    booking.refresh_from_db()
    assert booking.status == "attended" and booking.outcome == "enrolling"
    assert r.data["visita"]["outcome_label"] == "Asistió y agenda examen"


def test_visit_no_show_reschedules_or_closes(admin_client):
    lead = at_stage(make_lead(), Stage.VISITA)
    booking = make_booking(lead)
    r = admin_client.patch(
        card(lead, "visita"), {"outcome": "no_asistio", "reschedule": True}, format="json"
    )
    assert r.status_code == 200 and r.data["stage"] == "visita"
    booking.refresh_from_db()
    assert booking.status == "no_show"
    missing = admin_client.patch(card(lead, "visita"), {"outcome": "no_asistio"}, format="json")
    assert missing.status_code == 400 and "reason" in missing.data
    closed = admin_client.patch(
        card(lead, "visita"), {"outcome": "no_asistio", "reason": "No contestó"}, format="json"
    )
    assert closed.status_code == 200 and closed.data["closed"]["outcome"] == "no_asistio"


def test_visit_links_a_booking_of_this_case_only(admin_client):
    lead = at_stage(make_lead(), Stage.VISITA)
    other = make_lead(parent_email="otro@ejemplo.test")
    mine = make_booking(None, parent_email="sin-correo@ejemplo.test")
    r = admin_client.patch(card(lead, "visita"), {"booking": mine.pk}, format="json")
    assert r.status_code == 200 and r.data["visita"]["bookings"][0]["id"] == mine.pk
    foreign = make_booking(other)
    assert (
        admin_client.patch(card(lead, "visita"), {"booking": foreign.pk}, format="json").status_code
        == 400
    )
    assert (
        admin_client.patch(card(lead, "visita"), {"booking": 999999}, format="json").status_code
        == 400
    )


# ── Examen ────────────────────────────────────────────────────────────────
def test_exam_rules(admin_client):
    lead = at_stage(make_lead(), Stage.VISITA)
    no_date = admin_client.patch(card(lead, "examen"), {"result": "aceptado"}, format="json")
    assert no_date.status_code == 400 and "result" in no_date.data
    exam = future(5, 9)
    before = admin_client.patch(
        card(lead, "examen"),
        {"exam_at": exam.isoformat(), "exam_results_at": (exam - dt.timedelta(days=1)).isoformat()},
        format="json",
    )
    assert before.status_code == 400 and "exam_results_at" in before.data
    r = admin_client.patch(
        card(lead, "examen"),
        {
            "exam_at": exam.isoformat(),
            "exam_notes": "Traer lápiz",
            "exam_results_at": (exam + dt.timedelta(days=2)).isoformat(),
        },
        format="json",
    )
    assert r.status_code == 200 and r.data["stage"] == "examen"  # «Examen agendado»
    assert r.data["next_action"]["code"] == "send_exam_date"
    no_reason = admin_client.patch(card(lead, "examen"), {"result": "no_aceptado"}, format="json")
    assert no_reason.status_code == 400 and "reason" in no_reason.data
    ok = admin_client.patch(card(lead, "examen"), {"result": "aceptado"}, format="json")
    assert ok.status_code == 200 and ok.data["stage"] == "documentacion"
    assert ok.data["examen"]["result_label"] == "Aceptado"


def test_exam_not_accepted_closes_with_reason(admin_client):
    lead = at_stage(make_lead(), Stage.EXAMEN, exam_at=future(-1))
    r = admin_client.patch(
        card(lead, "examen"),
        {"result": "no_aceptado", "reason": "No alcanzó el nivel de lectura"},
        format="json",
    )
    assert r.status_code == 200 and r.data["stage"] == "cerrado"
    assert r.data["closed"]["outcome"] == "no_aceptado" and r.data["examen"]["reason"].startswith(
        "No alcanzó"
    )


# ── Documentación y acuerdos ──────────────────────────────────────────────
def test_only_an_admin_waives_documents(admin_client):
    lead = at_stage(make_lead(), Stage.DOCUMENTACION)
    secretaria = staff_client("admisiones")
    denied = secretaria.patch(
        card(lead, "documentacion"),
        {"documents_waived": True, "documents_waived_reason": "Los trae en agosto"},
        format="json",
    )
    assert denied.status_code == 409 and denied.data["code"] == "admin_only"
    assert (
        secretaria.patch(
            card(lead, "documentacion"),
            {"agreements_note": "Pago en 4 parcialidades"},
            format="json",
        ).status_code
        == 200
    )
    no_reason = admin_client.patch(
        card(lead, "documentacion"), {"documents_waived": True}, format="json"
    )
    assert no_reason.status_code == 400
    ok = admin_client.patch(
        card(lead, "documentacion"),
        {"documents_waived": True, "documents_waived_reason": "Los trae en agosto"},
        format="json",
    )
    assert ok.status_code == 200 and ok.data["documentacion"]["documents_waived"] is True
    gates = {g["key"]: g for g in ok.data["inscrito"]["gates"]["items"]}
    assert gates["documents"]["state"] == "waived"


def test_unknown_stage_is_404(admin_client):
    lead = make_lead()
    assert (
        admin_client.patch(
            reverse("case-stage", args=[lead.pk, "inscrito"]), {}, format="json"
        ).status_code
        == 404
    )


# ── permissions ───────────────────────────────────────────────────────────
def test_permissions(api_client, parent_user):
    lead = make_lead()
    urls_get = [
        CASES,
        reverse("case-detail", args=[lead.pk]),
        reverse("cases-templates"),
        reverse("case-exams"),
        reverse("case-discounts", args=[lead.pk]),
        reverse("case-payments", args=[lead.pk]),
        reverse("cuotas-pdf-preview", args=["primaria"]),
    ]
    assert all(api_client.get(u).status_code == 401 for u in urls_get)
    api_client.force_authenticate(parent_user)
    assert all(api_client.get(u).status_code == 403 for u in urls_get)
    no_area = staff_client("cafeteria")
    assert all(no_area.get(u).status_code == 403 for u in urls_get)
    assert no_area.patch(card(lead, "visita"), {"note": "x"}, format="json").status_code == 403
    assert (
        no_area.post(reverse("case-enroll", args=[lead.pk]), {}, format="json").status_code == 403
    )
    admisiones = staff_client("admisiones")
    assert all(admisiones.get(u).status_code == 200 for u in urls_get)
    # The visit card also opens to reception («visitas»), nothing else of the case does.
    visitas = staff_client("visitas")
    assert (
        visitas.patch(card(lead, "visita"), {"note": "Llegó tarde"}, format="json").status_code
        == 200
    )
    assert (
        visitas.patch(card(lead, "examen"), {"exam_notes": "x"}, format="json").status_code == 403
    )
    assert visitas.get(reverse("case-detail", args=[lead.pk])).status_code == 403


# ── the exams week ────────────────────────────────────────────────────────
def test_exams_week_view(admin_client):
    monday = timezone.localdate() + dt.timedelta(days=7 - timezone.localdate().weekday())
    at = timezone.make_aware(dt.datetime.combine(monday + dt.timedelta(days=2), dt.time(9, 30)))
    lead = at_stage(make_lead(), Stage.EXAMEN, exam_at=at, exam_notes="Salón 3")
    at_stage(
        make_lead(parent_email="x@ejemplo.test"),
        Stage.CERRADO,
        closed_outcome="no_interesa",
        exam_at=at,
    )  # dropped out before the exam: not on the calendar
    url = reverse("case-exams")
    r = admin_client.get(url, {"from": monday.isoformat()})
    assert r.status_code == 200 and len(r.data["days"]) == 7
    day = next(
        d for d in r.data["days"] if d["date"] == (monday + dt.timedelta(days=2)).isoformat()
    )
    assert [(e["case"], e["time"], e["exam_notes"]) for e in day["exams"]] == [
        (lead.pk, "09:30", "Salón 3")
    ]
    assert admin_client.get(url, {"from": "2026-02-30"}).status_code == 400
    assert admin_client.get(url, {"from": "2026-03-10", "to": "2026-03-01"}).status_code == 400
    assert admin_client.get(url, {"from": "2026-01-01", "to": "2026-12-31"}).status_code == 400
    default = admin_client.get(url).data
    assert dt.date.fromisoformat(default["from"]).weekday() == 0 and len(default["days"]) == 7
