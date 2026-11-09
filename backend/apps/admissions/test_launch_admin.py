"""Pre-launch admin review (2026-11-09): Admisiones.

- «Guardar revisión» erased the internal notes: the modal loads the applicant
  detail (no notes), so it always sent ``admin_notes: ''``. The staff-only
  status endpoint now returns them.
- A reminder invite to a family that already sent the inscripción opened a
  second one, and every re-invite re-copied the pre-registro over the
  family's corrections in the draft.
- «Rechazar seleccionados» (documents) could never run: the dry run was
  refused for the note it cannot have yet.
- A rejected document counted as uploaded: «Pedir documentos» never asked
  for it again.
- The matrícula typed at conversion was not normalised («ci09932»).
- Bulk emails now leave once their chunk is committed.
"""

import pytest
from django.core import mail
from django.core.files.base import ContentFile
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.accounts.models import StudentProfile
from apps.admissions.models import PreRegistration, Registration, RegistrationDocument
from apps.admissions.pipeline import REQUIRED_DOCS, checklist

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _locmem(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"


@pytest.fixture
def admin(api_client):
    user = AdminFactory()
    api_client.force_authenticate(user)
    return user


def _pre(**o):
    base = dict(
        child_first_name="Ana",
        child_last_name="Prueba",
        child_dob="2019-01-01",
        level=PreRegistration.Level.PRIMARY,
        grade_applying="Primaria 1°",
        parent_name="Tutor Prueba",
        parent_email="tutor@test.mx",
        parent_phone="5550000000",
    )
    base.update(o)
    return PreRegistration.objects.create(**base)


def _reg(**o):
    base = dict(
        child_first_name="Beto",
        child_last_name="Prueba",
        child_dob="2018-01-01",
        level="primaria",
        grade_applying="Primaria 2°",
        parent1_name="Tutora Prueba",
        parent1_email="tutora@test.mx",
        parent1_phone="5551111111",
        status=Registration.Status.SUBMITTED,
    )
    base.update(o)
    return Registration.objects.create(**base)


def _doc(reg, doc_type, **o):
    d = RegistrationDocument(registration=reg, doc_type=doc_type, filename=f"{doc_type}.pdf", **o)
    d.file.save(f"{doc_type}.pdf", ContentFile(b"x"), save=False)
    d.save()
    return d


class TestInternalNotes:
    def test_staff_read_them_from_the_status_endpoint(self, api_client, admin):
        reg = _reg(admin_notes="Llamar el lunes")
        r = api_client.get(reverse("register-status", args=[reg.pk]))
        assert r.status_code == 200
        assert r.data == {"id": reg.pk, "status": "submitted", "admin_notes": "Llamar el lunes"}

    def test_a_decision_without_notes_keeps_them(self, api_client, admin):
        reg = _reg(admin_notes="Llamar el lunes")
        r = api_client.patch(
            reverse("register-status", args=[reg.pk]), {"status": "reviewing"}, format="json"
        )
        assert r.status_code == 200
        reg.refresh_from_db()
        assert (reg.status, reg.admin_notes) == ("reviewing", "Llamar el lunes")

    def test_families_never_see_them(self, api_client):
        reg = _reg(admin_notes="Interno")
        url = reverse("register-status", args=[reg.pk])
        assert api_client.get(url).status_code in (401, 403)
        api_client.force_authenticate(ParentFactory())
        assert api_client.get(url).status_code == 403
        # Nor through the applicant detail.
        api_client.force_authenticate(AdminFactory())
        assert "admin_notes" not in api_client.get(reverse("register-detail", args=[reg.pk])).data


class TestReinvite:
    def test_keeps_the_familys_corrections_and_writes_to_the_current_address(
        self, api_client, admin
    ):
        pre = _pre()
        assert api_client.post(reverse("pre-register-invite", args=[pre.pk])).status_code == 201
        reg = pre.registrations.get()
        Registration.objects.filter(pk=reg.pk).update(
            child_first_name="Ana María", parent1_phone="5559999999"
        )
        PreRegistration.objects.filter(pk=pre.pk).update(parent_email="nuevo@test.mx")
        mail.outbox.clear()

        r = api_client.post(reverse("pre-register-invite", args=[pre.pk]))

        assert r.status_code == 201 and r.data["registration_id"] == reg.pk
        reg.refresh_from_db()
        assert (reg.child_first_name, reg.parent1_phone) == ("Ana María", "5559999999")
        assert [m.to for m in mail.outbox] == [["nuevo@test.mx"]]

    def test_a_blank_draft_field_is_filled_again(self, api_client, admin):
        pre = _pre()
        api_client.post(reverse("pre-register-invite", args=[pre.pk]))
        Registration.objects.filter(pre_registration=pre).update(grade_applying="")
        api_client.post(reverse("pre-register-invite", args=[pre.pk]))
        assert pre.registrations.get().grade_applying == "Primaria 1°"

    def test_no_new_link_once_the_inscripcion_was_sent(self, api_client, admin):
        pre = _pre()
        _reg(pre_registration=pre)  # submitted
        mail.outbox.clear()

        single = api_client.post(reverse("pre-register-invite", args=[pre.pk]))
        assert single.status_code == 409 and "ya envió su inscripción" in single.data["detail"]

        body = {"action": "invite", "ids": [pre.pk]}
        plan = api_client.post(
            reverse("pre-register-bulk"), {**body, "dry_run": True}, format="json"
        ).data
        assert plan["ok"] == 0 and "ya envió su inscripción" in plan["skipped"][0]["reason"]
        done = api_client.post(reverse("pre-register-bulk"), body, format="json").data
        assert done["ok"] == 0 and len(done["skipped"]) == 1

        assert pre.registrations.count() == 1 and mail.outbox == []


class TestDocuments:
    def test_bulk_reject_dry_run_needs_no_note_but_the_commit_does(self, api_client, admin):
        reg = _reg()
        doc = _doc(reg, RegistrationDocument.DocType.BIRTH_CERT)
        url = reverse("document-bulk")
        plan = api_client.post(
            url, {"action": "reject", "ids": [doc.pk], "dry_run": True}, format="json"
        )
        assert plan.status_code == 200 and plan.data["ok"] == 1

        refused = api_client.post(url, {"action": "reject", "ids": [doc.pk]}, format="json")
        assert refused.status_code == 400 and "note" in refused.data

        done = api_client.post(
            url,
            {"action": "reject", "ids": [doc.pk], "payload": {"note": "Ilegible"}},
            format="json",
        )
        assert done.status_code == 200 and done.data["ok"] == 1

    def test_a_rejected_document_is_asked_for_again(self):
        reg = _reg()
        for doc_type in REQUIRED_DOCS:
            _doc(reg, doc_type, status=RegistrationDocument.Review.APPROVED, is_verified=True)
        assert checklist(reg)["missing"] == []

        birth = reg.documents.get(doc_type=RegistrationDocument.DocType.BIRTH_CERT)
        birth.status, birth.is_verified = RegistrationDocument.Review.REJECTED, False
        birth.save()
        reg = Registration.objects.prefetch_related("documents").get(pk=reg.pk)
        label = RegistrationDocument.DocType.BIRTH_CERT.label
        assert checklist(reg)["missing"] == [f"{label} (por corregir)"]

        # The family uploads it again: the newest upload decides.
        _doc(reg, RegistrationDocument.DocType.BIRTH_CERT)
        reg = Registration.objects.prefetch_related("documents").get(pk=reg.pk)
        assert checklist(reg)["missing"] == []


class TestBulkEmailsAfterCommit:
    def test_approvals_go_out_after_their_chunk(self, api_client, admin, monkeypatch):
        from apps.admissions import bulk as adm_bulk

        regs = [_reg(child_first_name=f"N{i}", parent1_email=f"t{i}@test.mx") for i in range(12)]
        approved_when_sent = []
        real = adm_bulk.email_registration_outcome

        def spy(reg):
            approved_when_sent.append(Registration.objects.filter(status="approved").count())
            return real(reg)

        monkeypatch.setattr(adm_bulk, "email_registration_outcome", spy)
        mail.outbox.clear()
        r = api_client.post(
            reverse("register-bulk"),
            {"action": "approve", "ids": [g.pk for g in regs]},
            format="json",
        )

        assert r.data["ok"] == 12 and len(mail.outbox) == 12
        # Chunks of 10: the first email leaves once its 10 rows are written.
        assert approved_when_sent[:10] == [10] * 10 and approved_when_sent[10:] == [12, 12]


class TestConversion:
    def test_the_loyverse_spelling_is_stored_as_the_digits(self, admin_client):
        reg = _reg(status=Registration.Status.APPROVED)
        r = admin_client.post(
            reverse("register-convert", args=[reg.pk]), {"student_id": " CI09932 "}, format="json"
        )
        assert r.status_code == 201, r.data
        assert StudentProfile.objects.get(pk=r.data["student"]).student_id == "09932"

    def test_a_matricula_too_long_is_a_400(self, admin_client):
        reg = _reg(status=Registration.Status.APPROVED)
        r = admin_client.post(
            reverse("register-convert", args=[reg.pk]), {"student_id": "9" * 30}, format="json"
        )
        assert r.status_code == 400 and "student_id" in r.data
