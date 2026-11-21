"""Expediente (Fase 5): stages, the legacy status sync, the 0014 data migration,
the stage transition table, move / close / reopen and their audit rows."""

import importlib

import pytest
from django.apps import apps as django_apps
from django.urls import reverse

from apps.admissions import process
from apps.admissions.models import PreRegistration
from apps.admissions.process_fixtures import at_stage, make_lead
from apps.admissions.services import PREREG_ENTITY, change_status
from apps.core.models import AuditLog
from apps.core.transitions import REVERSE_TRANSITIONS, TRANSITIONS, TransitionError, transition_code

pytestmark = pytest.mark.django_db

Stage = PreRegistration.Stage


def audit_rows(lead):
    return AuditLog.objects.filter(object_type="admissions.preregistration", object_id=str(lead.pk))


# ── the transition contract ───────────────────────────────────────────────
def test_stage_table_matches_the_contract():
    assert {s: set(t) for s, t in TRANSITIONS["admissions.stage"].items()} == {
        "informes": {"visita", "examen", "documentacion", "cerrado"},
        "visita": {"examen", "documentacion", "informes", "cerrado"},
        "examen": {"documentacion", "visita", "informes", "cerrado"},
        "documentacion": {"inscrito", "examen", "visita", "informes", "cerrado"},
        "cerrado": {"informes", "visita", "examen", "documentacion"},
        "inscrito": set(),
    }
    reverse = {(c, t) for e, c, t in REVERSE_TRANSITIONS if e == "admissions.stage"}
    # Every move back and every reopen needs a note.
    assert reverse == {
        ("visita", "informes"),
        ("examen", "visita"),
        ("examen", "informes"),
        ("documentacion", "examen"),
        ("documentacion", "visita"),
        ("documentacion", "informes"),
        ("cerrado", "informes"),
        ("cerrado", "visita"),
        ("cerrado", "examen"),
        ("cerrado", "documentacion"),
    }


# ── legacy status ↔ stage ─────────────────────────────────────────────────
def test_new_lead_starts_in_informes_with_its_timestamp():
    lead = make_lead()
    assert lead.stage == Stage.INFORMES and lead.status == "pending" and lead.stage_changed_at


@pytest.mark.parametrize(
    "status,stage",
    [
        ("pending", "informes"),
        ("contacted", "visita"),
        ("enrolled", "inscrito"),
        ("rejected", "cerrado"),
    ],
)
def test_a_lead_created_with_a_legacy_status_gets_its_stage(status, stage):
    lead = make_lead(status=status)
    assert lead.stage == stage
    if stage == "cerrado":
        assert lead.closed_outcome == "no_procedio" and lead.closed_from_stage == "informes"


def test_legacy_status_change_moves_the_stage_and_audits_it(admin_user):
    lead = make_lead()
    change_status(lead, "contacted", entity=PREREG_ENTITY, actor=admin_user)
    lead.refresh_from_db()
    assert (lead.status, lead.stage) == ("contacted", "visita")
    row = audit_rows(lead).latest("pk")
    assert row.changes["stage"] == ["informes", "visita"]
    change_status(lead, "rejected", entity=PREREG_ENTITY, actor=admin_user)
    lead.refresh_from_db()
    assert (
        lead.stage == "cerrado"
        and lead.closed_from_stage == "visita"
        and lead.closed_outcome == "no_procedio"
    )
    change_status(
        lead, "pending", entity=PREREG_ENTITY, actor=admin_user, note="La familia volvió a escribir"
    )
    lead.refresh_from_db()
    assert lead.stage == "informes" and lead.closed_outcome == "" and lead.closed_at is None


def test_legacy_save_keeps_a_later_stage_when_the_status_matches():
    lead = at_stage(make_lead(), Stage.EXAMEN)
    lead.notes = "Llamar el lunes"
    lead.save(update_fields=["notes", "updated_at"])
    lead.refresh_from_db()
    assert lead.stage == "examen" and lead.status == "contacted"


def test_legacy_pre_registro_patch_still_works(admin_client):
    lead = make_lead()
    r = admin_client.patch(
        reverse("pre-register-detail", args=[lead.pk]), {"status": "contacted"}, format="json"
    )
    assert r.status_code == 200
    lead.refresh_from_db()
    assert lead.stage == "visita"


# ── the 0014 data migration ───────────────────────────────────────────────
class TestStageMigration:
    def _migration(self):
        return importlib.import_module("apps.admissions.migrations.0014_admission_process")

    def test_forwards_maps_every_status(self):
        leads = {
            s: make_lead(status=s, parent_email=f"{s}@ejemplo.test")
            for s in ("pending", "contacted", "enrolled", "rejected")
        }
        # Rows as they were before 0014: every stage at its default, no timestamps.
        PreRegistration.objects.update(
            stage="informes",
            stage_changed_at=None,
            closed_outcome="",
            closed_from_stage="",
            closed_at=None,
            enrolled_at=None,
        )
        self._migration().forwards(django_apps, None)
        got = {s: PreRegistration.objects.get(pk=lead.pk) for s, lead in leads.items()}
        assert {s: g.stage for s, g in got.items()} == {
            "pending": "informes",
            "contacted": "visita",
            "enrolled": "inscrito",
            "rejected": "cerrado",
        }
        assert all(g.stage_changed_at == g.updated_at for g in got.values())
        closed = got["rejected"]
        assert (closed.closed_outcome, closed.closed_from_stage) == ("no_procedio", "informes")
        assert got["enrolled"].enrolled_at == got["enrolled"].updated_at

    def test_backwards_writes_the_status_from_the_stage(self):
        a, b = make_lead(), make_lead(parent_email="otra@ejemplo.test")
        PreRegistration.objects.filter(pk=a.pk).update(stage="examen", status="pending")
        PreRegistration.objects.filter(pk=b.pk).update(stage="cerrado", status="contacted")
        self._migration().backwards(django_apps, None)
        assert PreRegistration.objects.get(pk=a.pk).status == "contacted"
        assert PreRegistration.objects.get(pk=b.pk).status == "rejected"


# ── set_stage rules ───────────────────────────────────────────────────────
def test_set_stage_rules():
    lead = make_lead()
    assert process.set_stage(lead, Stage.INFORMES) == {}
    diff = process.set_stage(lead, Stage.EXAMEN)  # a family may skip the visit
    assert diff["stage"] == ["informes", "examen"] and diff["status"] == ["pending", "contacted"]
    with pytest.raises(TransitionError) as exc:
        process.set_stage(lead, Stage.VISITA, note="")
    assert transition_code(exc.value) == "note_required"
    with pytest.raises(TransitionError):
        process.set_stage(lead, Stage.INSCRITO)  # only from documentación, through enroll_case
    with pytest.raises(Exception) as exc:
        process.set_stage(lead, Stage.CERRADO, closed_outcome="no_interesa", reason="  ")
    assert "reason" in exc.value.detail
    with pytest.raises(Exception) as exc:
        process.set_stage(lead, Stage.CERRADO, closed_outcome="no_procedio", reason="x")
    assert "outcome" in exc.value.detail


# ── move / close / reopen endpoints ───────────────────────────────────────
def test_move_close_reopen_round_trip_is_audited(admin_client):
    lead = make_lead()
    url = lambda name: reverse(name, args=[lead.pk])  # noqa: E731
    r = admin_client.post(url("case-move"), {"stage": "examen"}, format="json")
    assert r.status_code == 200 and r.data["stage"] == "examen"
    back = admin_client.post(url("case-move"), {"stage": "visita"}, format="json")
    assert back.status_code == 400 and "motivo" in str(back.data)
    back = admin_client.post(
        url("case-move"),
        {"stage": "visita", "note": "Pidió conocer primero el colegio"},
        format="json",
    )
    assert back.status_code == 200 and back.data["stage"] == "visita"
    assert (
        admin_client.post(url("case-move"), {"stage": "inscrito"}, format="json").status_code == 400
    )

    no_reason = admin_client.post(
        url("case-close"), {"outcome": "no_interesa", "reason": ""}, format="json"
    )
    assert no_reason.status_code == 400
    closed = admin_client.post(
        url("case-close"),
        {"outcome": "no_interesa", "reason": "Eligió otro colegio"},
        format="json",
    )
    assert closed.status_code == 200 and closed.data["stage"] == "cerrado"
    assert closed.data["closed"] == {
        **closed.data["closed"],
        "outcome": "no_interesa",
        "reason": "Eligió otro colegio",
        "from_stage": "visita",
    }
    assert closed.data["status"] == "rejected"
    # A closed case refuses the stage cards and a second close.
    assert (
        admin_client.patch(
            reverse("case-stage", args=[lead.pk, "examen"]), {"exam_at": None}, format="json"
        ).status_code
        == 409
    )
    assert (
        admin_client.post(
            url("case-close"), {"outcome": "no_asistio", "reason": "x"}, format="json"
        ).status_code
        == 409
    )

    assert (
        admin_client.post(url("case-reopen"), {}, format="json").status_code == 400
    )  # note required
    reopened = admin_client.post(url("case-reopen"), {"note": "Volvió a llamar"}, format="json")
    assert (
        reopened.status_code == 200
        and reopened.data["stage"] == "visita"
        and reopened.data["closed"] is None
    )
    assert (
        admin_client.post(url("case-reopen"), {"note": "otra vez"}, format="json").status_code
        == 409
    )

    stages = [
        row.changes.get("stage")
        for row in audit_rows(lead).order_by("pk")
        if "stage" in row.changes
    ]
    assert stages == [
        ["informes", "examen"],
        ["examen", "visita"],
        ["visita", "cerrado"],
        ["cerrado", "visita"],
    ]
    reopen_row = audit_rows(lead).latest("pk")
    assert reopen_row.changes["note"] == "Volvió a llamar" and reopen_row.actor is not None


def test_reopen_can_choose_the_stage(admin_client):
    lead = at_stage(
        make_lead(),
        Stage.CERRADO,
        closed_outcome="no_aceptado",
        closed_from_stage="examen",
        closed_reason="No acreditó",
    )
    r = admin_client.post(
        reverse("case-reopen", args=[lead.pk]),
        {"note": "Revisión", "stage": "informes"},
        format="json",
    )
    assert r.status_code == 200 and r.data["stage"] == "informes" and r.data["status"] == "pending"
