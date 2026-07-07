"""
Admissions access control — the registration access-token gate (IDOR fix).

A Registration is created anonymously and its ``access_token`` is returned to the
creating applicant exactly once. Reads/updates by anyone else must be refused
(404, to avoid leaking which sequential PKs exist); staff (JWT) bypass the gate.
"""

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.admissions.models import Registration

pytestmark = pytest.mark.django_db


VALID_REGISTRATION = {
    "child_first_name": "Niño",
    "child_last_name": "Prueba",
    "child_dob": "2018-05-01",
    "level": "primaria",
    "grade_applying": "1° Primaria",
    "parent1_name": "Madre Prueba",
    "parent1_email": "madre@test.mx",
    "parent1_phone": "5512345678",
}


def _create_registration(api_client):
    resp = api_client.post(reverse("register-create"), VALID_REGISTRATION, format="json")
    assert resp.status_code == 201, resp.data
    return resp.data["id"], resp.data["access_token"]


class TestRegistrationAccessToken:
    def test_create_returns_access_token_once(self, api_client):
        _id, token = _create_registration(api_client)
        assert token

    def test_read_without_token_is_404(self, api_client):
        reg_id, _token = _create_registration(api_client)
        resp = api_client.get(reverse("register-detail", args=[reg_id]))
        assert resp.status_code == 404

    def test_read_with_wrong_token_is_404(self, api_client):
        reg_id, _token = _create_registration(api_client)
        resp = api_client.get(
            reverse("register-detail", args=[reg_id]),
            {"access_token": "deadbeef-0000-0000-0000-000000000000"},
        )
        assert resp.status_code == 404

    def test_read_with_correct_token_query_param(self, api_client):
        reg_id, token = _create_registration(api_client)
        resp = api_client.get(reverse("register-detail", args=[reg_id]), {"access_token": token})
        assert resp.status_code == 200
        assert resp.data["id"] == reg_id

    def test_read_with_correct_token_header(self, api_client):
        reg_id, token = _create_registration(api_client)
        resp = api_client.get(
            reverse("register-detail", args=[reg_id]), HTTP_X_ACCESS_TOKEN=str(token)
        )
        assert resp.status_code == 200

    def test_staff_bypasses_token_gate(self, api_client):
        reg_id, _token = _create_registration(api_client)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("register-detail", args=[reg_id]))
        assert resp.status_code == 200

    def test_non_staff_authenticated_still_needs_token(self, api_client):
        reg_id, _token = _create_registration(api_client)
        api_client.force_authenticate(user=ParentFactory())
        resp = api_client.get(reverse("register-detail", args=[reg_id]))
        assert resp.status_code == 404

    def test_submit_requires_token(self, api_client):
        reg_id, token = _create_registration(api_client)

        blocked = api_client.post(reverse("register-submit", args=[reg_id]))
        assert blocked.status_code == 404

        ok = api_client.post(reverse("register-submit", args=[reg_id]) + f"?access_token={token}")
        assert ok.status_code == 200
        assert Registration.objects.get(pk=reg_id).status == Registration.Status.SUBMITTED
