"""Expediente (Fase 5) leftovers the screens need: the stage in the pre-registro
export (column and filter), the case id on the Inscripciones rows and on the
visits of the week view, retention clearing the Expediente notes, and the
becas/pagos as read-only rows of the Django admin. Synthetic data only."""

import datetime as dt

import pytest
from django.contrib import admin as django_admin
from django.test import RequestFactory
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory
from apps.admissions.models import AdmissionDiscount, EnrollmentPayment, PreRegistration
from apps.admissions.process_fixtures import (
    at_stage,
    make_booking,
    make_discount,
    make_lead,
    make_payment,
    make_registration,
)
from apps.core.retention import REDACTED, run

pytestmark = pytest.mark.django_db

Stage = PreRegistration.Stage


def _csv(resp):
    return b"".join(resp.streaming_content).decode("utf-8-sig")


def test_preregistro_export_has_the_stage_and_filters_by_it(api_client):
    at_stage(make_lead(child_first_name="Elsa"), Stage.EXAMEN)
    at_stage(
        make_lead(child_first_name="Iván", parent_phone="5598765432"),
        Stage.CERRADO,
        closed_outcome=PreRegistration.ClosedOutcome.NO_INTERESA,
    )
    make_lead(child_first_name="Olga", parent_phone="5511112222")  # informes
    api_client.force_authenticate(user=AdminFactory())

    body = _csv(api_client.get(reverse("pre-register-export")))
    header = body.splitlines()[0]
    assert "Etapa" in header
    assert "Examen" in body and "Cerrado: No le interesa" in body and "Informes" in body

    body = _csv(api_client.get(reverse("pre-register-export"), {"stage": "examen,cerrado"}))
    assert "Elsa" in body and "Iván" in body and "Olga" not in body

    bad = api_client.get(reverse("pre-register-export"), {"stage": "examen,nada"})
    assert bad.status_code == 400 and "stage" in bad.data


def test_preregistro_list_filters_by_stage(api_client):
    at_stage(make_lead(child_first_name="Elsa"), Stage.VISITA)
    make_lead(child_first_name="Olga")
    api_client.force_authenticate(user=AdminFactory())
    r = api_client.get(reverse("pre-register"), {"stage": "visita"})
    assert r.status_code == 200
    assert [row["child_name"].split()[0] for row in r.data["results"]] == ["Elsa"]


def test_inscripciones_rows_carry_their_case(api_client):
    lead = make_lead()
    make_registration(lead)
    api_client.force_authenticate(user=AdminFactory())
    r = api_client.get(reverse("register-create"))
    assert r.status_code == 200
    assert r.data["results"][0]["pre_registration"] == lead.pk


def test_week_view_visits_carry_their_case(admin_client):
    lead = make_lead()
    booking = make_booking(lead)
    loose = make_booking(None, parent_email="otra@ejemplo.test", parent_name="Otra Familia")
    r = admin_client.get(reverse("bookings-admin-week"), {"start": booking.slot.date.isoformat()})
    assert r.status_code == 200
    rows = {b["id"]: b for day in r.data["days"] for slot in day["slots"] for b in slot["bookings"]}
    assert rows[booking.pk]["case"] == lead.pk
    assert rows[loose.pk]["case"] is None


def test_retention_clears_the_expediente_notes_of_purged_leads():
    old = at_stage(
        make_lead(),
        Stage.CERRADO,
        closed_outcome=PreRegistration.ClosedOutcome.NO_ACEPTADO,
        closed_reason="La familia de Lucía se mudó",
        visit_note="Vino con la abuela",
        exam_notes="Lectura por debajo del grado",
        exam_result_reason="No alcanzó el puntaje",
        agreements_note="Beca prometida por Dirección",
        documents_waived_reason="Acta en trámite",
    )
    PreRegistration.objects.filter(pk=old.pk).update(
        updated_at=timezone.now() - dt.timedelta(days=400)
    )
    keep = at_stage(
        make_lead(parent_phone="5598765432"),
        Stage.EXAMEN,
        exam_notes="Llega a las 9",
    )
    run(apply=True)
    old.refresh_from_db()
    keep.refresh_from_db()
    assert old.parent_email == REDACTED
    assert (
        old.closed_reason,
        old.visit_note,
        old.exam_notes,
        old.exam_result_reason,
        old.agreements_note,
        old.documents_waived_reason,
    ) == ("", "", "", "", "", "")
    assert old.stage == Stage.CERRADO and old.closed_outcome == "no_aceptado"  # stats kept
    assert keep.exam_notes == "Llega a las 9"


@pytest.mark.parametrize("model", [AdmissionDiscount, EnrollmentPayment])
def test_becas_and_payments_are_read_only_in_the_django_admin(model, admin_user):
    model_admin = django_admin.site._registry[model]
    request = RequestFactory().get("/")
    request.user = admin_user
    assert not model_admin.has_add_permission(request)
    assert not model_admin.has_change_permission(request)
    assert not model_admin.has_delete_permission(request)


def test_django_admin_lists_becas_and_payments(client, django_user_model):
    lead = make_lead()
    make_discount(lead)
    make_payment(lead, voided_at=timezone.now(), void_reason="Duplicado")
    superuser = django_user_model.objects.create_superuser(
        email="root@ejemplo.test", password="Root-pass-123"
    )
    client.force_login(superuser)
    for name in ("admissiondiscount", "enrollmentpayment"):
        resp = client.get(reverse(f"admin:admissions_{name}_changelist"))
        assert resp.status_code == 200, name
