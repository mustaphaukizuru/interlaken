"""
Authentication paths: email/password token issuance, Google OAuth callback
(happy + edge), logout blacklist, and the students-list permission gate.

All Google network calls are mocked — the suite never touches the internet.
"""

from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import (
    DEFAULT_PASSWORD,
    AdminFactory,
    ParentFactory,
    StudentProfileFactory,
)
from apps.accounts.models import User

pytestmark = pytest.mark.django_db


# ── email/password token ──────────────────────────────────────────────────
class TestTokenObtain:
    def test_valid_credentials_return_token_pair(self, api_client):
        ParentFactory(email="login@test.mx")
        resp = api_client.post(
            reverse("token-obtain"),
            {"email": "login@test.mx", "password": DEFAULT_PASSWORD},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        assert "access" in resp.data and "refresh" in resp.data

    def test_wrong_password_is_rejected(self, api_client):
        ParentFactory(email="login@test.mx")
        resp = api_client.post(
            reverse("token-obtain"),
            {"email": "login@test.mx", "password": "nope"},
            format="json",
        )
        assert resp.status_code == 401


# ── Google OAuth callback ─────────────────────────────────────────────────
class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class TestGoogleCallback:
    url_name = "google-callback"

    def test_missing_code_redirects_with_error(self, api_client):
        resp = api_client.get(reverse(self.url_name))
        assert resp.status_code == 302
        assert "error=no_code" in resp["Location"]

    @patch("apps.accounts.views.requests.get")
    @patch("apps.accounts.views.requests.post")
    def test_happy_path_creates_user_and_redirects_with_tokens(
        self, mock_post, mock_get, api_client
    ):
        mock_post.return_value = _FakeResponse(200, {"access_token": "ya29.fake"})
        mock_get.return_value = _FakeResponse(
            200,
            {
                "sub": "google-uid-1",
                "email": "nuevo@test.mx",
                "given_name": "Nuevo",
                "family_name": "Usuario",
                "picture": "http://img/x.png",
            },
        )

        resp = api_client.get(reverse(self.url_name), {"code": "abc"})
        assert resp.status_code == 302
        loc = resp["Location"]
        assert "/auth/callback" in loc
        assert "access=" in loc and "refresh=" in loc

        user = User.objects.get(email="nuevo@test.mx")
        assert user.google_id == "google-uid-1"
        assert user.role == User.Role.PARENT  # default role on first login

    @patch("apps.accounts.views.requests.post")
    def test_token_exchange_failure_redirects_with_error(self, mock_post, api_client):
        mock_post.return_value = _FakeResponse(400, {})
        resp = api_client.get(reverse(self.url_name), {"code": "abc"})
        assert resp.status_code == 302
        assert "error=token_exchange_failed" in resp["Location"]


# ── logout blacklist ──────────────────────────────────────────────────────
class TestLogoutBlacklist:
    def _tokens(self, api_client, email="logout@test.mx"):
        ParentFactory(email=email)
        resp = api_client.post(
            reverse("token-obtain"),
            {"email": email, "password": DEFAULT_PASSWORD},
            format="json",
        )
        return resp.data["access"], resp.data["refresh"]

    def test_logout_blacklists_refresh_token(self, api_client):
        access, refresh = self._tokens(api_client)
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

        out = api_client.post(reverse("logout"), {"refresh": refresh}, format="json")
        assert out.status_code == 200, out.data

        # The blacklisted refresh can no longer be exchanged for a new access token.
        api_client.credentials()  # drop auth header
        again = api_client.post(reverse("token-refresh"), {"refresh": refresh}, format="json")
        assert again.status_code == 401

    def test_logout_requires_refresh_field(self, api_client):
        access, _ = self._tokens(api_client, email="logout2@test.mx")
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        out = api_client.post(reverse("logout"), {}, format="json")
        assert out.status_code == 400


# ── students list permission gate ─────────────────────────────────────────
class TestStudentListPermissions:
    def test_parent_sees_only_own_children(self, api_client):
        parent = ParentFactory()
        mine = StudentProfileFactory(parents=[parent])
        StudentProfileFactory()  # someone else's child

        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("students"))
        assert resp.status_code == 200
        ids = [s["id"] for s in resp.data.get("results", resp.data)]
        assert ids == [mine.id]

    def test_admin_sees_all_students(self, api_client):
        StudentProfileFactory()
        StudentProfileFactory()
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("students"))
        assert resp.status_code == 200
        total = resp.data.get("count", len(resp.data))
        assert total == 2

    def test_anonymous_is_denied(self, api_client):
        resp = api_client.get(reverse("students"))
        assert resp.status_code == 401
