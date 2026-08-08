"""Admissions emails must actually hit Django's outbox (not silent no-ops)."""
import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.admissions.models import PreRegistration, Registration

pytestmark = pytest.mark.django_db


def test_pre_register_emails_parent_and_school(api_client, settings):
    settings.CONTACT_EMAIL = "colegio@interlaken.edu.mx"
    settings.RATELIMIT_ENABLE = False
    mail.outbox.clear()

    resp = api_client.post(reverse("pre-register"), {
        "child_name": "Ana Pérez",
        "child_dob": "2015-05-01",
        "grade_applying": "Primaria 3°",
        "parent_name": "Roberto Pérez",
        "email": "roberto@test.mx",
        "phone": "5512345678",
    }, format="json")
    assert resp.status_code == 201, resp.data
    assert len(mail.outbox) == 2
    subjects = {m.subject for m in mail.outbox}
    assert any("Pre-registro recibido" in s for s in subjects)
    assert any("Nuevo pre-registro" in s for s in subjects)
    parent_mail = next(m for m in mail.outbox if "Pre-registro recibido" in m.subject)
    assert parent_mail.to == ["roberto@test.mx"]
    school_mail = next(m for m in mail.outbox if "Nuevo pre-registro" in m.subject)
    assert school_mail.to == ["colegio@interlaken.edu.mx"]


def test_invite_and_approval_email_parent(api_client, settings):
    settings.RATELIMIT_ENABLE = False
    mail.outbox.clear()

    api_client.post(reverse("pre-register"), {
        "child_name": "Luis Ruiz",
        "child_dob": "2014-01-01",
        "grade_applying": "Primaria 4°",
        "parent_name": "María Ruiz",
        "email": "maria@test.mx",
        "phone": "5599999999",
    }, format="json")
    pre = PreRegistration.objects.get()
    mail.outbox.clear()

    admin = AdminFactory()
    api_client.force_authenticate(user=admin)
    invite = api_client.post(reverse("pre-register-invite", args=[pre.id]))
    assert invite.status_code == 201, invite.data
    assert any("Invitación de inscripción" in m.subject for m in mail.outbox)
    assert any("maria@test.mx" in m.to for m in mail.outbox)

    reg = Registration.objects.get(pk=invite.data["registration_id"])
    mail.outbox.clear()
    approved = api_client.patch(
        reverse("register-status", args=[reg.id]),
        {"status": "approved", "admin_notes": "OK"},
        format="json",
    )
    assert approved.status_code == 200, approved.data
    assert any("maria@test.mx" in m.to for m in mail.outbox)
    assert any("aprob" in m.subject.lower() or "aprob" in m.body.lower()
               for m in mail.outbox)
