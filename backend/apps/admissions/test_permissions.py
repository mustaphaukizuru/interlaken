"""
Admissions access control (IK-SEC A2) — single-use, expiring, hashed tokens.

A Registration is created anonymously; a one-time INVITE token is returned once
in the body (never a URL). The applicant exchanges it via POST for a short-lived
SESSION token used on subsequent steps via the X-Session-Token header. The invite
is single-use (reuse → 401) and expiring (expired → 401); staff (JWT) bypass.
"""

import pytest
from django.urls import reverse
from django.utils import timezone

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


def _create(api_client):
    resp = api_client.post(reverse("register-create"), VALID_REGISTRATION, format="json")
    assert resp.status_code == 201, resp.data
    # Invite token is returned exactly once, in the body — never a URL.
    assert resp.data["invite_token"]
    assert "access_token" not in resp.data  # old plaintext capability is gone
    return resp.data["id"], resp.data["invite_token"]


def _exchange(api_client, reg_id, invite):
    return api_client.post(
        reverse("register-access", args=[reg_id]), {"token": invite}, format="json"
    )


class TestInviteExchange:
    def test_invite_stored_hashed_not_plaintext(self, api_client):
        reg_id, invite = _create(api_client)
        reg = Registration.objects.get(pk=reg_id)
        # DB holds only the hash, never the raw token.
        assert reg.invite_token_hash and reg.invite_token_hash != invite
        assert len(reg.invite_token_hash) == 64

    def test_valid_invite_exchanges_for_session(self, api_client):
        reg_id, invite = _create(api_client)
        resp = _exchange(api_client, reg_id, invite)
        assert resp.status_code == 200, resp.data
        assert resp.data["session_token"]

    def test_invite_reuse_is_401(self, api_client):
        reg_id, invite = _create(api_client)
        assert _exchange(api_client, reg_id, invite).status_code == 200
        # Single-use: the second exchange with the same invite fails.
        assert _exchange(api_client, reg_id, invite).status_code == 401

    def test_expired_invite_is_401(self, api_client):
        reg_id, invite = _create(api_client)
        reg = Registration.objects.get(pk=reg_id)
        reg.invite_expires_at = timezone.now() - timezone.timedelta(seconds=1)
        reg.save(update_fields=["invite_expires_at"])
        assert _exchange(api_client, reg_id, invite).status_code == 401

    def test_wrong_invite_is_401(self, api_client):
        reg_id, _invite = _create(api_client)
        assert _exchange(api_client, reg_id, "not-the-token").status_code == 401


class TestSessionGate:
    def _session(self, api_client):
        reg_id, invite = _create(api_client)
        token = _exchange(api_client, reg_id, invite).data["session_token"]
        return reg_id, token

    def test_read_without_session_is_401(self, api_client):
        reg_id, _t = self._session(api_client)
        assert api_client.get(reverse("register-detail", args=[reg_id])).status_code == 401

    def test_read_with_session_header(self, api_client):
        reg_id, token = self._session(api_client)
        resp = api_client.get(
            reverse("register-detail", args=[reg_id]), HTTP_X_SESSION_TOKEN=token
        )
        assert resp.status_code == 200
        assert resp.data["id"] == reg_id

    def test_submit_requires_session_header(self, api_client):
        reg_id, token = self._session(api_client)
        assert api_client.post(reverse("register-submit", args=[reg_id])).status_code == 401
        # Stage B also requires accepting the privacy notice (IK-LEGAL B2).
        ok = api_client.post(
            reverse("register-submit", args=[reg_id]),
            {"accept_privacy": True}, format="json", HTTP_X_SESSION_TOKEN=token,
        )
        assert ok.status_code == 200
        assert Registration.objects.get(pk=reg_id).status == Registration.Status.SUBMITTED

    def test_staff_bypasses_gate(self, api_client):
        reg_id, _t = self._session(api_client)
        api_client.force_authenticate(user=AdminFactory())
        assert api_client.get(reverse("register-detail", args=[reg_id])).status_code == 200

    def test_non_staff_authenticated_still_needs_session(self, api_client):
        reg_id, _t = self._session(api_client)
        api_client.force_authenticate(user=ParentFactory())
        assert api_client.get(reverse("register-detail", args=[reg_id])).status_code == 401

    def test_no_token_ever_in_a_url(self, api_client):
        # The detail/submit routes carry no token in their path or query string.
        reg_id, token = self._session(api_client)
        url = reverse("register-detail", args=[reg_id])
        assert token not in url and "token" not in url
