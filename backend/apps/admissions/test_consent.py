"""
Admissions Stage-B consent capture (IK-LEGAL B2): privacy acceptance required to
submit, and medical fields gated on MEDICAL_DATA consent.
"""
import pytest
from django.urls import reverse

from apps.admissions.models import Registration

pytestmark = pytest.mark.django_db

BASE = {
    "child_first_name": "Niño", "child_last_name": "Prueba", "child_dob": "2018-05-01",
    "level": "primaria", "grade_applying": "1° Primaria",
    "parent1_name": "Madre", "parent1_email": "madre@test.mx", "parent1_phone": "5512345678",
}


def _session(api_client, extra=None):
    payload = {**BASE, **(extra or {})}
    created = api_client.post(reverse("register-create"), payload, format="json")
    reg_id, invite = created.data["id"], created.data["invite_token"]
    token = api_client.post(reverse("register-access", args=[reg_id]),
                            {"token": invite}, format="json").data["session_token"]
    return reg_id, token


def _submit(api_client, reg_id, token, body=None):
    return api_client.post(reverse("register-submit", args=[reg_id]),
                           body or {}, format="json", HTTP_X_SESSION_TOKEN=token)


def test_submit_without_privacy_acceptance_is_blocked(api_client):
    reg_id, token = _session(api_client)
    resp = _submit(api_client, reg_id, token)  # no accept_privacy
    assert resp.status_code == 400
    assert "Aviso de Privacidad" in resp.data["error"]
    assert Registration.objects.get(pk=reg_id).status == Registration.Status.DRAFT


def test_submit_with_privacy_acceptance_records_timestamp(api_client):
    reg_id, token = _session(api_client)
    resp = _submit(api_client, reg_id, token, {"accept_privacy": True})
    assert resp.status_code == 200, resp.data
    reg = Registration.objects.get(pk=reg_id)
    assert reg.status == Registration.Status.SUBMITTED
    assert reg.privacy_accepted_at is not None


def test_medical_fields_require_medical_consent(api_client):
    reg_id, token = _session(api_client, {"blood_type": "O+", "allergies": "Penicilina"})
    # Accepted privacy but no medical consent → blocked.
    blocked = _submit(api_client, reg_id, token, {"accept_privacy": True})
    assert blocked.status_code == 400
    assert "datos de salud" in blocked.data["error"]

    # Grant medical consent (PATCH) then submit succeeds.
    api_client.patch(reverse("register-detail", args=[reg_id]),
                     {"consent_medical_data": True}, format="json",
                     HTTP_X_SESSION_TOKEN=token)
    ok = _submit(api_client, reg_id, token, {"accept_privacy": True})
    assert ok.status_code == 200, ok.data


def test_estatura_peso_alone_require_medical_consent(api_client):
    """Encrypted height/weight are medical fields — must not bypass the gate."""
    reg_id, token = _session(api_client, {"estatura": "1.20 m", "peso": "25 kg"})
    blocked = _submit(api_client, reg_id, token, {"accept_privacy": True})
    assert blocked.status_code == 400
    assert "datos de salud" in blocked.data["error"]

    api_client.patch(
        reverse("register-detail", args=[reg_id]),
        {"consent_medical_data": True}, format="json",
        HTTP_X_SESSION_TOKEN=token,
    )
    ok = _submit(api_client, reg_id, token, {"accept_privacy": True})
    assert ok.status_code == 200, ok.data
