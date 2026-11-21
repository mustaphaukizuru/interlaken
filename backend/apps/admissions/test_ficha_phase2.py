"""Fase 2 (the ficha form replaces /pre-registro and the old wizard): staff
links open /pre-registro, an invitation opens a strict ficha with the split
names prefilled, and the old wizard's PATCH only edits version-1 records.

Synthetic data only (apps.admissions.factories).
"""

import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.admissions.factories import alumno_data, start_payload
from apps.admissions.models import PreRegistration, Registration

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _mail(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.ADMISSIONS_EMAIL = "admisiones@ejemplo.test"
    mail.outbox.clear()


def _lead(**over):
    data = dict(
        child_first_name="Iker",
        child_last_name="Montes Rivas",
        child_dob=None,
        level="primaria",
        grade_applying="Primaria 2°",
        parent_name="Lucía Rivas Soto",
        parent_email="lucia.rivas@ejemplo.test",
        parent_phone="5512121212",
        relationship="Madre",
    )
    data.update(over)
    return PreRegistration.objects.create(**data)


def _invite(client, pre):
    client.force_authenticate(AdminFactory())
    resp = client.post(reverse("pre-register-invite", args=[pre.id]))
    assert resp.status_code == 201, resp.content
    client.force_authenticate(None)
    return resp.json()


class TestStaffInvite:
    def test_link_opens_the_ficha_at_pre_registro(self, api_client):
        body = _invite(api_client, _lead())
        assert body["invite_url"].endswith(
            f"/pre-registro?rid={body['registration_id']}&token={body['invite_token']}"
        )
        assert "/pre-registro?rid=" in mail.outbox[0].body
        assert "ficha de inscripción" in mail.outbox[0].body

    def test_draft_is_a_ficha_with_split_names(self, api_client):
        body = _invite(api_client, _lead())
        reg = Registration.objects.get(pk=body["registration_id"])
        assert reg.ficha_version == Registration.FichaVersion.FICHA
        assert (reg.child_given_names, reg.child_paternal_surname, reg.child_maternal_surname) == (
            "Iker",
            "Montes",
            "Rivas",
        )
        assert (reg.contact_name, reg.contact_email) == ("Lucía Rivas Soto", "lucia.rivas@ejemplo.test")

    def test_family_reads_the_prefilled_ficha_with_the_exchanged_session(self, api_client):
        body = _invite(api_client, _lead())
        rid = body["registration_id"]
        access = api_client.post(
            reverse("register-access", args=[rid]), {"token": body["invite_token"]}, format="json"
        )
        assert access.status_code == 200
        ficha = api_client.get(
            reverse("register-ficha", args=[rid]), HTTP_X_SESSION_TOKEN=access.data["session_token"]
        )
        assert ficha.status_code == 200
        assert ficha.data["sections"]["alumno"]["child_paternal_surname"] == "Montes"
        assert ficha.data["sections"]["contacto"]["contact_phone"] == "5512121212"
        assert ficha.data["editable"] is True

    def test_reinvite_keeps_what_the_family_corrected(self, api_client):
        pre = _lead()
        first = _invite(api_client, pre)
        reg = Registration.objects.get(pk=first["registration_id"])
        reg.child_paternal_surname = "Montes de Oca"
        reg.child_maternal_surname = "Rivas"
        reg.save()
        _invite(api_client, pre)
        reg.refresh_from_db()
        assert reg.child_paternal_surname == "Montes de Oca"


class TestLegacyPatch:
    def _session(self, client, reg):
        from apps.admissions.tokens import issue_session

        return issue_session(reg)

    def test_a_ficha_is_not_edited_through_the_old_wizard_patch(self, api_client):
        resp = api_client.post(reverse("register-create"), start_payload(), format="json")
        assert resp.status_code == 201
        rid, token = resp.data["id"], resp.data["session_token"]
        old = api_client.patch(
            reverse("register-detail", args=[rid]),
            {"child_curp": "", "parent2_name": "Otra Persona"},
            format="json",
            HTTP_X_SESSION_TOKEN=token,
        )
        assert old.status_code == 409 and old.data["code"] == "ficha_by_sections"
        assert Registration.objects.get(pk=rid).parent2_name == ""
        # The section save is the way.
        new = api_client.patch(
            reverse("register-ficha-section", args=[rid, "alumno"]),
            alumno_data(),
            format="json",
            HTTP_X_SESSION_TOKEN=token,
        )
        assert new.status_code == 200, new.data

    def test_staff_cannot_bypass_it_either(self, api_client):
        resp = api_client.post(reverse("register-create"), start_payload(), format="json")
        api_client.force_authenticate(AdminFactory())
        old = api_client.patch(
            reverse("register-detail", args=[resp.data["id"]]), {"parent2_name": "X"}, format="json"
        )
        assert old.status_code == 409

    def test_version_one_records_keep_the_old_patch(self, api_client):
        reg = Registration.objects.create(
            child_first_name="Leo",
            child_last_name="Mora",
            level="primaria",
            grade_applying="2° Primaria",
            parent1_name="Iván Mora",
            parent1_email="ivan@ejemplo.test",
            parent1_phone="5534343434",
        )
        assert reg.ficha_version == Registration.FichaVersion.LEGACY
        token = self._session(api_client, reg)
        resp = api_client.patch(
            reverse("register-detail", args=[reg.pk]),
            {"parent2_name": "Rosa Mora"},
            format="json",
            HTTP_X_SESSION_TOKEN=token,
        )
        assert resp.status_code == 200, resp.data
        reg.refresh_from_db()
        assert reg.parent2_name == "Rosa Mora"
