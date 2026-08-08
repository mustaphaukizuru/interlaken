"""
Authentication paths: email/password token issuance, Google OAuth callback
(happy + edge), logout blacklist, and the students-list permission gate.

All Google network calls are mocked — the suite never touches the internet.
"""

from unittest.mock import patch

import pytest
import requests
from django.conf import settings
from django.test import override_settings
from django.urls import reverse

from apps.accounts.factories import (
    DEFAULT_PASSWORD,
    AdminFactory,
    ParentFactory,
    StudentProfileFactory,
)
from apps.accounts.models import User

pytestmark = pytest.mark.django_db

REFRESH_COOKIE = settings.AUTH_REFRESH_COOKIE
CSRF_COOKIE = settings.AUTH_CSRF_COOKIE


def _login(api_client, email="login@test.mx"):
    """Log in and return (access, csrf, refresh_value) reading the Set-Cookie jar."""
    ParentFactory(email=email)
    resp = api_client.post(
        reverse("token-obtain"),
        {"email": email, "password": DEFAULT_PASSWORD},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    return (resp.data["access"],
            resp.cookies[CSRF_COOKIE].value,
            resp.cookies[REFRESH_COOKIE].value)


# ── email/password token ──────────────────────────────────────────────────
class TestTokenObtain:
    def test_valid_credentials_return_access_and_set_httponly_refresh_cookie(self, api_client):
        ParentFactory(email="login@test.mx")
        resp = api_client.post(
            reverse("token-obtain"),
            {"email": "login@test.mx", "password": DEFAULT_PASSWORD},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        # Access is returned in the body; the refresh token is NOT (cookie only).
        assert "access" in resp.data
        assert "refresh" not in resp.data
        # Refresh cookie is httpOnly; CSRF cookie is JS-readable (double-submit).
        assert resp.cookies[REFRESH_COOKIE]["httponly"] is True
        assert resp.cookies[REFRESH_COOKIE].value
        assert not resp.cookies[CSRF_COOKIE]["httponly"]

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


@pytest.mark.django_db
class TestGoogleLogin:
    """GET /auth/google/ — the OAuth initiation (never a raw 500)."""

    url_name = "google-login"

    @override_settings(GOOGLE_CLIENT_ID="cid", GOOGLE_CLIENT_SECRET="sec")
    def test_configured_redirects_to_google(self, api_client):
        resp = api_client.get(reverse(self.url_name))
        assert resp.status_code == 302
        assert resp["Location"].startswith("https://accounts.google.com/")

    @override_settings(GOOGLE_CLIENT_ID="", GOOGLE_CLIENT_SECRET="")
    def test_unconfigured_fails_gracefully_to_login(self, api_client):
        # No credentials → bounce to the SPA login with a clear error, NOT a
        # 500 or a confusing Google error page.
        resp = api_client.get(reverse(self.url_name))
        assert resp.status_code == 302
        assert "error=google_unavailable" in resp["Location"]
        assert "accounts.google.com" not in resp["Location"]


def _armed_state(api_client, state="teststate"):
    """Simulate GoogleLoginView having stashed the CSRF state in the session."""
    s = api_client.session
    s["google_oauth_state"] = state
    s.save()
    return state


_VERIFIED_USERINFO = {
    "sub": "google-uid-1", "email": "nuevo@test.mx", "email_verified": True,
    "given_name": "Nuevo", "family_name": "Usuario", "picture": "http://img/x.png",
}


class TestGoogleCallback:
    url_name = "google-callback"

    def test_missing_code_redirects_with_error(self, api_client):
        resp = api_client.get(reverse(self.url_name))
        assert resp.status_code == 302
        assert "error=no_code" in resp["Location"]

    def test_state_mismatch_rejected(self, api_client):
        # A code with no/incorrect state must be refused (login-CSRF defense).
        _armed_state(api_client, "the-real-state")
        resp = api_client.get(reverse(self.url_name), {"code": "abc", "state": "forged"})
        assert resp.status_code == 302
        assert "error=state_mismatch" in resp["Location"]

    def test_missing_session_state_rejected(self, api_client):
        # No state was ever armed (e.g. replayed callback) → refuse.
        resp = api_client.get(reverse(self.url_name), {"code": "abc", "state": "x"})
        assert resp.status_code == 302
        assert "error=state_mismatch" in resp["Location"]

    @patch("apps.accounts.views.requests.post", side_effect=requests.ConnectionError)
    def test_network_error_redirects_gracefully(self, _mock_post, api_client):
        # Google unreachable / timeout during the token exchange → graceful
        # redirect, not a raw 500.
        state = _armed_state(api_client)
        resp = api_client.get(reverse(self.url_name), {"code": "abc", "state": state})
        assert resp.status_code == 302
        assert "error=google_unreachable" in resp["Location"]

    @patch("apps.accounts.views.requests.get")
    @patch("apps.accounts.views.requests.post")
    def test_happy_path_existing_user_redirects_with_tokens(
        self, mock_post, mock_get, api_client
    ):
        # Invite-only default: user must already exist.
        ParentFactory(email="nuevo@test.mx")
        mock_post.return_value = _FakeResponse(200, {"access_token": "ya29.fake"})
        mock_get.return_value = _FakeResponse(200, _VERIFIED_USERINFO)

        state = _armed_state(api_client)
        resp = api_client.get(reverse(self.url_name), {"code": "abc", "state": state})
        assert resp.status_code == 302
        loc = resp["Location"]
        # Success lands on /login?login=ok (NOT /auth/*, which is backend-only).
        assert "/login?login=ok" in loc
        assert "/auth/callback" not in loc
        # No tokens are ever placed in the redirect URL — session is cookie-only.
        assert "access=" not in loc and "refresh=" not in loc
        assert resp.cookies[REFRESH_COOKIE]["httponly"] is True
        assert resp.cookies[REFRESH_COOKIE].value

        user = User.objects.get(email="nuevo@test.mx")
        assert user.google_id == "google-uid-1"
        assert user.role == User.Role.PARENT

    @override_settings(GOOGLE_AUTO_CREATE_DOMAINS=[])
    @patch("apps.accounts.views.requests.get")
    @patch("apps.accounts.views.requests.post")
    def test_unknown_email_rejected_when_invite_only(
        self, mock_post, mock_get, api_client
    ):
        mock_post.return_value = _FakeResponse(200, {"access_token": "ya29.fake"})
        mock_get.return_value = _FakeResponse(200, _VERIFIED_USERINFO)

        state = _armed_state(api_client)
        resp = api_client.get(reverse(self.url_name), {"code": "abc", "state": state})
        assert resp.status_code == 302
        assert "error=not_invited" in resp["Location"]
        assert not User.objects.filter(email="nuevo@test.mx").exists()

    @override_settings(GOOGLE_AUTO_CREATE_DOMAINS=["interlaken.edu.mx"])
    @patch("apps.accounts.views.requests.get")
    @patch("apps.accounts.views.requests.post")
    def test_allowlisted_domain_may_auto_create(
        self, mock_post, mock_get, api_client
    ):
        mock_post.return_value = _FakeResponse(200, {"access_token": "ya29.fake"})
        mock_get.return_value = _FakeResponse(
            200, {**_VERIFIED_USERINFO, "email": "familia@interlaken.edu.mx"},
        )

        state = _armed_state(api_client)
        resp = api_client.get(reverse(self.url_name), {"code": "abc", "state": state})
        assert resp.status_code == 302
        assert "/login?login=ok" in resp["Location"]
        user = User.objects.get(email="familia@interlaken.edu.mx")
        assert user.role == User.Role.PARENT

    @patch("apps.accounts.views.requests.get")
    @patch("apps.accounts.views.requests.post")
    def test_unverified_email_rejected(self, mock_post, mock_get, api_client):
        mock_post.return_value = _FakeResponse(200, {"access_token": "ya29.fake"})
        mock_get.return_value = _FakeResponse(
            200, {**_VERIFIED_USERINFO, "email": "victim@interlaken.edu.mx",
                  "email_verified": False})

        state = _armed_state(api_client)
        resp = api_client.get(reverse(self.url_name), {"code": "abc", "state": state})
        assert resp.status_code == 302
        assert "error=email_unverified" in resp["Location"]
        # No account was created/matched for the unverified address.
        assert not User.objects.filter(email="victim@interlaken.edu.mx").exists()

    @patch("apps.accounts.views.requests.post")
    def test_token_exchange_failure_redirects_with_error(self, mock_post, api_client):
        mock_post.return_value = _FakeResponse(400, {})
        state = _armed_state(api_client)
        resp = api_client.get(reverse(self.url_name), {"code": "abc", "state": state})
        assert resp.status_code == 302
        assert "error=token_exchange_failed" in resp["Location"]


# ── Google ID-token exchange (local verification, no token in a URL) ───────
class TestGoogleTokenExchange:
    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_valid_credential_sets_cookie_and_returns_access(self, mock_verify, api_client):
        ParentFactory(email="gtoken@test.mx")
        mock_verify.return_value = {
            "sub": "g-1", "email": "gtoken@test.mx", "email_verified": True,
            "given_name": "G", "family_name": "T",
        }
        resp = api_client.post(reverse("google-token"), {"credential": "fake"}, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data["access"] and "refresh" not in resp.data
        assert resp.cookies[REFRESH_COOKIE]["httponly"] is True
        # Verification is local — the credential is passed to the audience check,
        # never placed in an outbound URL.
        mock_verify.assert_called_once()

    @override_settings(GOOGLE_AUTO_CREATE_DOMAINS=[])
    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_unknown_email_credential_is_403(self, mock_verify, api_client):
        mock_verify.return_value = {
            "sub": "g-new", "email": "stranger@gmail.com", "email_verified": True,
            "given_name": "X", "family_name": "Y",
        }
        resp = api_client.post(reverse("google-token"), {"credential": "fake"}, format="json")
        assert resp.status_code == 403
        assert resp.data["error"] == "not_invited"
        assert not User.objects.filter(email="stranger@gmail.com").exists()

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_unverified_email_credential_is_401(self, mock_verify, api_client):
        mock_verify.return_value = {
            "sub": "g-2", "email": "admin@interlaken.edu.mx", "email_verified": False,
        }
        resp = api_client.post(reverse("google-token"), {"credential": "fake"}, format="json")
        assert resp.status_code == 401
        assert not User.objects.filter(email="admin@interlaken.edu.mx").exists()

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token",
           side_effect=ValueError("invalid"))
    def test_invalid_credential_is_401(self, _mock_verify, api_client):
        resp = api_client.post(reverse("google-token"), {"credential": "bad"}, format="json")
        assert resp.status_code == 401


# ── cookie session: refresh rotation, CSRF, silent refresh, logout ─────────
class TestCookieSession:
    def _refresh(self, api_client, csrf, refresh_value=None, header=True):
        """POST the cookie-refresh endpoint; the client resends stored cookies."""
        if refresh_value is not None:
            api_client.cookies[REFRESH_COOKIE] = refresh_value
        api_client.cookies[CSRF_COOKIE] = csrf  # keep double-submit cookie in sync
        extra = {"HTTP_X_CSRF_TOKEN": csrf} if header else {}
        return api_client.post(reverse("token-refresh"), {}, format="json", **extra)

    def test_expired_access_triggers_silent_refresh(self, api_client):
        access, csrf, _ = _login(api_client)
        # Access token expired/absent → the SPA calls refresh (cookie) for a new one.
        resp = self._refresh(api_client, csrf)
        assert resp.status_code == 200, resp.data
        assert "access" in resp.data and resp.data["access"] != access

    def test_refresh_rotates_and_old_token_is_blacklisted(self, api_client):
        _, csrf, old_refresh = _login(api_client)
        r1 = self._refresh(api_client, csrf)
        assert r1.status_code == 200
        new_refresh = r1.cookies[REFRESH_COOKIE].value
        new_csrf = r1.cookies[CSRF_COOKIE].value
        assert new_refresh and new_refresh != old_refresh  # rotated

        # Replaying the old (now blacklisted) refresh token fails.
        replay = self._refresh(api_client, new_csrf, refresh_value=old_refresh)
        assert replay.status_code == 401

    def test_refresh_requires_csrf_double_submit(self, api_client):
        _, csrf, _ = _login(api_client)
        assert self._refresh(api_client, csrf, header=False).status_code == 403

    def test_refresh_without_session_is_401(self, api_client):
        # CSRF present but no refresh cookie → no session.
        api_client.cookies[CSRF_COOKIE] = "abc"
        resp = api_client.post(reverse("token-refresh"), {}, format="json",
                               HTTP_X_CSRF_TOKEN="abc")
        assert resp.status_code == 401

    def test_logout_clears_cookies_and_revokes_refresh(self, api_client):
        access, csrf, refresh_value = _login(api_client)
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        out = api_client.post(reverse("logout"), {}, format="json",
                              HTTP_X_CSRF_TOKEN=csrf)
        assert out.status_code == 200, out.data
        assert out.cookies[REFRESH_COOKIE].value == ""  # cleared

        # The revoked refresh token can no longer mint an access token.
        api_client.credentials()
        replay = self._refresh(api_client, csrf, refresh_value=refresh_value)
        assert replay.status_code == 401

    def test_logout_requires_csrf(self, api_client):
        access, _, _ = _login(api_client)
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        out = api_client.post(reverse("logout"), {}, format="json")  # no CSRF header
        assert out.status_code == 403


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


# ── current user (GET/PATCH /accounts/me/) ────────────────────────────────
class TestCurrentUser:
    def test_get_requires_auth(self, api_client):
        resp = api_client.get(reverse("current-user"))
        assert resp.status_code == 401

    def test_get_returns_authenticated_user(self, api_client):
        parent = ParentFactory(first_name="Ana", last_name="López", whatsapp="5511111111")
        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("current-user"))
        assert resp.status_code == 200
        assert resp.data["email"] == parent.email
        assert resp.data["first_name"] == "Ana"
        assert resp.data["whatsapp"] == "5511111111"
        assert resp.data["role"] == User.Role.PARENT
        assert "notif_prefs" in resp.data

    def test_patch_updates_name_and_whatsapp(self, api_client):
        parent = ParentFactory(first_name="Ana", last_name="López", whatsapp="")
        api_client.force_authenticate(user=parent)
        resp = api_client.patch(
            reverse("current-user"),
            {"first_name": "Ana María", "last_name": "García", "whatsapp": "5522222222"},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        parent.refresh_from_db()
        assert parent.first_name == "Ana María"
        assert parent.last_name == "García"
        assert parent.whatsapp == "5522222222"
        assert resp.data["first_name"] == "Ana María"
        assert resp.data["whatsapp"] == "5522222222"

    def test_patch_ignores_email_and_role(self, api_client):
        parent = ParentFactory()
        api_client.force_authenticate(user=parent)
        resp = api_client.patch(
            reverse("current-user"),
            {"email": "attacker@evil.test", "role": User.Role.ADMIN, "first_name": "Ok"},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        parent.refresh_from_db()
        assert parent.email != "attacker@evil.test"
        assert parent.role == User.Role.PARENT
        assert parent.first_name == "Ok"
