"""Expediente (Fase 5): Booking → case link (0006 backfill by email, latest lead)
and the visit-outcome sync of Visitas (FK first, email as fallback)."""

import importlib

import pytest
from django.apps import apps as django_apps
from django.urls import reverse

from apps.admissions.models import PreRegistration
from apps.admissions.process_fixtures import at_stage, make_booking, make_lead, make_slot
from apps.admissions.services import RETENTION_PLACEHOLDER
from apps.bookings.models import Booking
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

Stage = PreRegistration.Stage


def outcome(client, booking, value, **extra):
    return client.post(
        reverse("bookings-admin-outcome", args=[booking.pk]),
        {"outcome": value, **extra},
        format="json",
    )


def test_backfill_links_existing_bookings_to_the_latest_lead_by_email():
    migration = importlib.import_module("apps.bookings.migrations.0006_booking_pre_registration")
    old = make_lead(parent_email="familia@ejemplo.test")
    latest = make_lead(parent_email="FAMILIA@ejemplo.test")
    other = make_lead(parent_email="otra@ejemplo.test")
    b1 = make_booking(None, parent_email="familia@ejemplo.test ")
    b2 = make_booking(None, parent_email="sin-expediente@ejemplo.test")
    b3 = make_booking(other, parent_email="familia@ejemplo.test")  # already linked: left alone
    purged = make_lead(parent_email=RETENTION_PLACEHOLDER)
    b4 = make_booking(None, parent_email=RETENTION_PLACEHOLDER)
    migration.backfill(django_apps, None)
    got = {b.pk: b.pre_registration_id for b in Booking.objects.all()}
    assert got[b1.pk] == latest.pk and got[b1.pk] != old.pk
    assert got[b2.pk] is None and got[b3.pk] == other.pk
    assert got[b4.pk] is None and purged.pk not in got.values()


def _visited(lead=None, **kw):
    """A booking whose visit already happened: its result can be recorded
    (attendance is refused before the visit starts, QA 2026-11-24)."""
    kw["slot"] = kw.get("slot") or make_slot(days=-1)
    return make_booking(lead, **kw)


def test_outcome_uses_the_fk_before_the_email(admin_client):
    linked = make_lead(parent_email="otra@ejemplo.test")
    by_email = make_lead(parent_email="marta@ejemplo.test")  # newest lead with the booking's email
    booking = _visited(linked, parent_email="marta@ejemplo.test")
    r = outcome(admin_client, booking, "interested")
    assert r.status_code == 200 and r.data["pre_registration"]["id"] == linked.pk
    linked.refresh_from_db()
    by_email.refresh_from_db()
    assert linked.stage == "visita" and by_email.stage == "informes"


def test_outcome_falls_back_to_email_and_attaches_the_fk(admin_client):
    lead = make_lead()
    booking = _visited(None)
    r = outcome(admin_client, booking, "enrolling")
    assert r.status_code == 200 and r.data["pre_registration"]["stage"] == "examen"
    booking.refresh_from_db()
    assert booking.pre_registration_id == lead.pk


def test_declined_closes_the_case_with_the_visit_note(admin_client):
    lead = at_stage(make_lead(), Stage.VISITA)
    booking = _visited(lead)
    r = outcome(admin_client, booking, "declined", note="Busca horario vespertino")
    assert r.status_code == 200 and r.data["pre_registration"]["changed"] is True
    lead.refresh_from_db()
    assert (lead.stage, lead.status, lead.closed_outcome, lead.closed_reason) == (
        "cerrado",
        "rejected",
        "no_interesa",
        "Busca horario vespertino",
    )
    assert lead.visit_outcome == "no_interesa"
    row = AuditLog.objects.filter(
        object_type="admissions.preregistration", object_id=str(lead.pk)
    ).latest("pk")
    assert row.changes["stage"] == ["visita", "cerrado"] and row.changes["booking"] == booking.pk


def test_outcome_never_moves_a_case_back_or_an_enrolled_one(admin_client):
    ahead = at_stage(make_lead(), Stage.DOCUMENTACION)
    r = outcome(admin_client, _visited(ahead), "interested")
    assert r.data["pre_registration"]["changed"] is False
    ahead.refresh_from_db()
    assert ahead.stage == "documentacion"
    enrolled = at_stage(make_lead(parent_email="e@ejemplo.test"), Stage.INSCRITO)
    r = outcome(
        admin_client, _visited(enrolled, slot=None, parent_email="e@ejemplo.test"), "declined"
    )
    assert (
        r.data["pre_registration"]["changed"] is False and "skipped" in r.data["pre_registration"]
    )
    enrolled.refresh_from_db()
    assert enrolled.stage == "inscrito"


def test_case_history_includes_the_visit(admin_client):
    lead = at_stage(make_lead(), Stage.VISITA)
    booking = _visited(lead)
    outcome(admin_client, booking, "enrolling")
    history = admin_client.get(reverse("case-detail", args=[lead.pk])).data["history"]
    kinds = {(h["object_label"], h["object_id"]) for h in history}
    assert ("Visita", str(booking.pk)) in kinds and ("Expediente", str(lead.pk)) in kinds
    stamps = [h["at"] for h in history]
    assert stamps == sorted(stamps, reverse=True)  # newest first
