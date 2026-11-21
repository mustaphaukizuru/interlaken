"""Expediente (Fase 5): becas/descuentos (summary, durations), payments (record
only, void), the «Marcar como inscrito» gates and the convert service reuse."""

import datetime as dt
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import StudentProfile, User
from apps.admissions import process
from apps.admissions.models import (
    AdmissionDiscount,
    EnrollmentPayment,
    PreRegistration,
    Registration,
)
from apps.admissions.process_fixtures import (
    at_stage,
    make_discount,
    make_lead,
    make_payment,
    make_registration,
    staff_client,
)
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

Stage = PreRegistration.Stage
K, D = AdmissionDiscount.Kind, AdmissionDiscount.Duration


# ── discount summaries ────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "kw,summary,months",
    [
        (
            dict(kind=K.BECA_COLEGIATURA, percent=Decimal("20"), duration=D.CICLO),
            "Beca 20% en colegiatura · agosto 2027 a junio 2028",
            11,
        ),
        (
            dict(kind=K.DESCUENTO_COLEGIATURA, percent=Decimal("12.50"), duration=D.TRES_MESES),
            "Descuento 12.5% en colegiatura · agosto a octubre 2027",
            3,
        ),
        (
            dict(
                kind=K.DESCUENTO_COLEGIATURA,
                percent=None,
                amount=Decimal("500"),
                duration=D.SEIS_MESES,
            ),
            "Descuento $500.00 en colegiatura · agosto 2027 a enero 2028",
            6,
        ),
        (
            dict(
                kind=K.BECA_COLEGIATURA,
                percent=Decimal("10"),
                duration=D.SEIS_MESES,
                start_month=dt.date(2027, 11, 1),
            ),
            "Beca 10% en colegiatura · noviembre 2027 a abril 2028",
            6,
        ),
        (
            dict(kind=K.BECA_COLEGIATURA, percent=Decimal("15"), duration=D.PERMANENTE),
            "Beca 15% en colegiatura · permanente, desde agosto 2027",
            None,
        ),
        (
            dict(
                kind=K.DESCUENTO_COLEGIATURA,
                percent=Decimal("30"),
                duration=D.PERSONALIZADO,
                start_month=dt.date(2027, 9, 1),
                end_month=dt.date(2028, 3, 1),
            ),
            "Descuento 30% en colegiatura · septiembre 2027 a marzo 2028",
            7,
        ),
        (
            dict(kind=K.INSCRIPCION, percent=Decimal("50"), duration=""),
            "Descuento 50% en inscripción · ciclo 2027-2028",
            None,
        ),
    ],
)
def test_discount_summary_and_months(kw, summary, months):
    d = make_discount(make_lead(), **kw)
    assert process.discount_summary(d) == summary
    assert process.months_between(*process.discount_period(d)) == months


def test_discount_crud_validation_and_void(admin_client):
    lead = at_stage(make_lead(), Stage.DOCUMENTACION)
    url = reverse("case-discounts", args=[lead.pk])
    both = admin_client.post(
        url,
        {
            "kind": "beca_colegiatura",
            "percent": "20",
            "amount": "100",
            "duration": "ciclo",
            "authorized_by": "Dirección",
        },
        format="json",
    )
    assert both.status_code == 400 and "percent" in both.data
    no_duration = admin_client.post(
        url,
        {"kind": "beca_colegiatura", "percent": "20", "authorized_by": "Dirección"},
        format="json",
    )
    assert no_duration.status_code == 400 and "duration" in no_duration.data
    too_much = admin_client.post(
        url,
        {
            "kind": "beca_colegiatura",
            "percent": "120",
            "duration": "ciclo",
            "authorized_by": "Dirección",
        },
        format="json",
    )
    assert too_much.status_code == 400
    custom = admin_client.post(
        url,
        {
            "kind": "beca_colegiatura",
            "percent": "20",
            "duration": "personalizado",
            "start_month": "2028-03-01",
            "end_month": "2027-09-01",
            "authorized_by": "Dirección",
        },
        format="json",
    )
    assert custom.status_code == 400 and "end_month" in custom.data
    who = admin_client.post(
        url,
        {"kind": "beca_colegiatura", "percent": "20", "duration": "ciclo", "authorized_by": "  "},
        format="json",
    )
    assert who.status_code == 400 and "authorized_by" in who.data

    r = admin_client.post(
        url,
        {
            "kind": "beca_colegiatura",
            "percent": "20",
            "duration": "ciclo",
            "authorized_by": "Dirección general",
            "note": "Hermano inscrito",
        },
        format="json",
    )
    assert r.status_code == 201, r.data
    assert (
        r.data["summary"] == "Beca 20% en colegiatura · agosto 2027 a junio 2028"
        and r.data["months"] == 11
    )
    pk = r.data["id"]
    detail = reverse("case-discount-detail", args=[lead.pk, pk])
    upd = admin_client.patch(detail, {"percent": "25"}, format="json")
    assert upd.status_code == 200 and upd.data["summary"].startswith("Beca 25%")
    assert admin_client.get(url).data["results"][0]["id"] == pk
    assert admin_client.delete(detail, {}, format="json").status_code == 204
    assert admin_client.get(url).data["results"] == []
    assert admin_client.get(url, {"include_voided": "1"}).data["results"][0]["voided_at"]
    assert admin_client.patch(detail, {"percent": "30"}, format="json").status_code == 404
    actions = list(
        AuditLog.objects.filter(object_type="admissions.admissiondiscount", object_id=str(pk))
        .order_by("pk")
        .values_list("action", flat=True)
    )
    assert actions == ["create", "update", "delete"]
    # The voided row stays in the case history.
    history = admin_client.get(reverse("case-detail", args=[lead.pk])).data["history"]
    assert {h["action"] for h in history if h["object_type"] == "admissions.admissiondiscount"} == {
        "create",
        "update",
        "delete",
    }


def test_discount_belongs_to_its_case(admin_client):
    a, b = make_lead(), make_lead(parent_email="b@ejemplo.test")
    d = make_discount(a)
    assert (
        admin_client.patch(
            reverse("case-discount-detail", args=[b.pk, d.pk]), {"percent": "5"}, format="json"
        ).status_code
        == 404
    )


# ── payments (record only) ────────────────────────────────────────────────
def test_payments_record_and_void_with_reason(admin_client):
    lead = at_stage(make_lead(), Stage.DOCUMENTACION)
    url = reverse("case-payments", args=[lead.pk])
    future = (timezone.localdate() + dt.timedelta(days=2)).isoformat()
    assert (
        admin_client.post(
            url, {"paid_on": future, "amount": "9500", "method": "efectivo"}, format="json"
        ).status_code
        == 400
    )
    assert (
        admin_client.post(
            url,
            {"paid_on": timezone.localdate().isoformat(), "amount": "0", "method": "efectivo"},
            format="json",
        ).status_code
        == 400
    )
    assert (
        admin_client.post(
            url,
            {"paid_on": timezone.localdate().isoformat(), "amount": "10", "method": "cheque"},
            format="json",
        ).status_code
        == 400
    )
    r = admin_client.post(
        url,
        {
            "paid_on": "2026-11-10",
            "amount": "9500.00",
            "method": "transferencia",
            "reference": "SPEI-123",
        },
        format="json",
    )
    assert r.status_code == 201, r.data
    assert (
        r.data["summary"] == "$9,500.00 · transferencia · 10 de noviembre de 2026 · ref. SPEI-123"
    )
    assert r.data["recorded_by"] == "admin@test.mx"
    detail = reverse("case-payment-detail", args=[lead.pk, r.data["id"]])
    no_reason = admin_client.delete(detail, {}, format="json")
    assert no_reason.status_code == 400
    assert (
        admin_client.delete(detail, {"reason": "Se registró dos veces"}, format="json").status_code
        == 204
    )
    payment = EnrollmentPayment.objects.get(pk=r.data["id"])
    assert payment.voided_at and payment.void_reason == "Se registró dos veces"
    # A voided payment does not open the gate.
    gates = admin_client.get(reverse("case-detail", args=[lead.pk])).data["inscrito"]["gates"]
    assert next(g for g in gates["items"] if g["key"] == "payment")["ok"] is False


def test_closed_case_takes_no_new_records(admin_client):
    lead = at_stage(make_lead(), Stage.CERRADO, closed_outcome="no_interesa")
    r = admin_client.post(
        reverse("case-payments", args=[lead.pk]),
        {"paid_on": "2026-11-10", "amount": "1", "method": "efectivo"},
        format="json",
    )
    assert r.status_code == 409


# ── «Marcar como inscrito» ────────────────────────────────────────────────
def ready_case(**reg_kw):
    lead = at_stage(
        make_lead(),
        Stage.DOCUMENTACION,
        exam_at=timezone.now() - dt.timedelta(days=3),
        exam_result="aceptado",
    )
    reg = make_registration(lead, **reg_kw)
    make_payment(lead)
    return lead, reg


def test_enroll_lists_every_missing_gate(admin_client):
    lead = at_stage(make_lead(), Stage.EXAMEN)
    r = admin_client.post(reverse("case-enroll", args=[lead.pk]), {}, format="json")
    assert r.status_code == 400 and r.data["code"] == "gates"
    failing = {g["key"] for g in r.data["gates"]["items"] if not g["ok"]}
    assert failing == {"stage", "ficha", "payment"}
    assert not StudentProfile.objects.exists()


def test_enroll_runs_the_convert_and_closes_the_loop(admin_client):
    lead, reg = ready_case(parent2_name="Pedro Ejemplo", parent2_email="pedro@ejemplo.test")
    r = admin_client.post(reverse("case-enroll", args=[lead.pk]), {"group": "B"}, format="json")
    assert r.status_code == 201, r.data
    sp = StudentProfile.objects.get(pk=r.data["student"])
    assert sp.registration_id == reg.pk and sp.group == "B" and sp.grade == "2° Primaria"
    assert {c["email"] for c in r.data["credentials"]} == {
        "marta@ejemplo.test",
        "pedro@ejemplo.test",
    }
    assert User.objects.get(email="marta@ejemplo.test").role == "parent"
    lead.refresh_from_db()
    reg.refresh_from_db()
    assert (lead.stage, lead.status, reg.status) == ("inscrito", "enrolled", "complete")
    assert lead.enrolled_at is not None
    assert (
        r.data["case"]["stage"] == "inscrito" and r.data["case"]["ficha"]["student"]["id"] == sp.pk
    )
    # The registration skipped the review states: its jump to complete is audited.
    assert AuditLog.objects.filter(
        object_type="admissions.registration",
        object_id=str(reg.pk),
        changes__status=["submitted", "complete"],
    ).exists()
    assert AuditLog.objects.filter(
        object_type="admissions.preregistration",
        object_id=str(lead.pk),
        context__contains="marcar como inscrito",
    ).exists()
    again = admin_client.post(reverse("case-enroll", args=[lead.pk]), {}, format="json")
    assert again.status_code == 200 and again.data["already"] is True
    assert StudentProfile.objects.count() == 1


def test_enroll_after_a_legacy_convert_only_marks_the_case(admin_client):
    lead, reg = ready_case(status=Registration.Status.APPROVED)
    assert (
        admin_client.post(reverse("register-convert", args=[reg.pk]), {}, format="json").status_code
        == 201
    )
    r = admin_client.post(reverse("case-enroll", args=[lead.pk]), {}, format="json")
    assert r.status_code == 201 and r.data["already"] is True and r.data["credentials"] == []
    lead.refresh_from_db()
    assert lead.stage == "inscrito" and StudentProfile.objects.count() == 1


def test_enroll_refuses_a_rejected_ficha_and_a_closed_case(admin_client):
    lead, _reg = ready_case(status=Registration.Status.REJECTED)
    r = admin_client.post(reverse("case-enroll", args=[lead.pk]), {}, format="json")
    assert (
        r.status_code == 400
        and not next(g for g in r.data["gates"]["items"] if g["key"] == "ficha")["ok"]
    )
    closed = at_stage(
        make_lead(parent_email="c@ejemplo.test"), Stage.CERRADO, closed_outcome="no_interesa"
    )
    assert (
        admin_client.post(reverse("case-enroll", args=[closed.pk]), {}, format="json").status_code
        == 409
    )


def test_convert_errors_leave_the_case_untouched(admin_client):
    lead, reg = ready_case()
    taken = make_lead(parent_email="t@ejemplo.test")
    other = make_registration(taken, status=Registration.Status.APPROVED)
    admin_client.post(
        reverse("register-convert", args=[other.pk]), {"student_id": "270001"}, format="json"
    )
    r = admin_client.post(
        reverse("case-enroll", args=[lead.pk]), {"student_id": "270001"}, format="json"
    )
    assert r.status_code == 400 and "student_id" in r.data
    lead.refresh_from_db()
    reg.refresh_from_db()
    assert lead.stage == "documentacion" and reg.status == "submitted"


class TestDocumentsHook:
    """The documents-by-level module plugs in; without it the gate is «unknown» (not blocking)."""

    @pytest.fixture
    def hooks(self):
        saved = dict(process._document_hooks)
        yield process.register_documents_hooks
        process._document_hooks.clear()
        process._document_hooks.update(saved)

    def test_incomplete_documents_block_until_an_admin_waives_them(self, admin_client, hooks):
        hooks(complete=lambda reg: False, required_for_level=lambda level: ["Acta de nacimiento"])
        lead, _reg = ready_case()
        r = admin_client.post(reverse("case-enroll", args=[lead.pk]), {}, format="json")
        assert r.status_code == 400
        docs = next(g for g in r.data["gates"]["items"] if g["key"] == "documents")
        assert docs["state"] == "incomplete" and docs["overridable"] is True
        secretaria = staff_client("admisiones")
        denied = secretaria.post(
            reverse("case-enroll", args=[lead.pk]),
            {"override_documents": True, "override_reason": "Los entrega en agosto"},
            format="json",
        )
        assert denied.status_code == 409 and denied.data["code"] == "admin_only"
        assert (
            admin_client.post(
                reverse("case-enroll", args=[lead.pk]), {"override_documents": True}, format="json"
            ).status_code
            == 400
        )  # the reason is required
        ok = admin_client.post(
            reverse("case-enroll", args=[lead.pk]),
            {"override_documents": True, "override_reason": "Los entrega en agosto"},
            format="json",
        )
        assert ok.status_code == 201, ok.data
        lead.refresh_from_db()
        assert lead.documents_waived and lead.documents_waived_reason == "Los entrega en agosto"

    def test_complete_documents_pass(self, hooks):
        hooks(complete=lambda reg: True)
        lead, reg = ready_case()
        assert process.documents_state(lead, reg)["state"] == "complete"
        assert process.enroll_gates(lead, reg)["ready"] is True

    def test_without_the_module_the_state_is_unknown(self):
        lead, reg = ready_case()
        state = process.documents_state(lead, reg)
        assert state["state"] == "unknown" and state["ok"] is True
        assert process.required_documents("primaria") is None
