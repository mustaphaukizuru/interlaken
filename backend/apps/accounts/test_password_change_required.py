"""
Temporary passwords must be replaced at the next sign-in (2026-11-24).

* Every place an administrator generates or sets a password for someone else
  sets ``User.password_change_required``; nothing else does (existing users
  and self-made passwords stay as they were).
* The server enforces it (apps/accounts/authentication.py): with a real JWT,
  a normal endpoint answers 403 ``password_change_required``; ``me`` (read),
  the change-password endpoint, logout, the token refresh and public
  endpoints keep working.
* ``POST /accounts/me/password/`` replaces the password and clears the flag.
* A Google sign-in retires an unused temporary password (after the
  ``google_mismatch`` guard).
* A staff invitation emails where to sign in, never the password.

These tests use real bearer tokens on purpose: ``force_authenticate`` skips
the authentication classes and would never reach the gate.
"""

import time
from unittest.mock import patch

import pytest
from django.conf import settings
from django.core import mail
from django.urls import reverse
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.factories import (
    DEFAULT_PASSWORD,
    AdminFactory,
    ParentFactory,
    StudentUserFactory,
    UserFactory,
)
from apps.accounts.models import PasswordRequest, User
from apps.accounts.security import TotpDevice, new_secret, totp_code
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

ME = reverse("current-user")
MY_PASSWORD = reverse("my-password")
NORMAL = reverse("students")  # any endpoint that needs a signed-in account
CSRF = "csrf-test-value"
NEW_PASSWORD = "Girasol-Azul-2026"


def _bearer(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _flagged(**kw) -> User:
    user = ParentFactory(**kw)
    user.password_change_required = True
    user.save(update_fields=["password_change_required"])
    return user


def _sign_in(client, email, password, **extra):
    return client.post(
        reverse("token-obtain"), {"email": email, "password": password, **extra}, format="json"
    )


# ── who sets the flag ──────────────────────────────────────────────────────
class TestWhoSetsTheFlag:
    def test_new_and_existing_accounts_start_without_it(self):
        assert User._meta.get_field("password_change_required").default is False
        assert UserFactory().password_change_required is False
        assert (
            User.objects.create_user(
                email="x@test.mx", password="Abc-12345-xyz"
            ).password_change_required
            is False
        )

    @pytest.mark.parametrize("body", [{}, {"password": "ClaveFamiliar2026"}])
    def test_admin_family_reset_generated_or_typed(self, api_client, body):
        family = ParentFactory(email="familia@test.mx")
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(reverse("admin-set-password", args=[family.pk]), body, format="json")
        assert resp.status_code == 200, resp.data
        family.refresh_from_db()
        assert family.password_change_required is True

    def test_password_request_resolved(self, admin_client):
        family = ParentFactory(email="pide@test.mx")
        req = PasswordRequest.objects.create(user=family, requested_email=family.email)
        resp = admin_client.patch(
            reverse("password-request-detail", args=[req.pk]), {"action": "resolve"}, format="json"
        )
        assert resp.status_code == 200, resp.data
        family.refresh_from_db()
        assert family.password_change_required is True
        # The message the office sends says it is temporary (no longer «no se puede cambiar»).
        assert (
            "la primera vez que entre, el portal le pedirá crear la suya"
            in resp.data["templates"]["whatsapp_text"]
        )

    def test_staff_invite_and_staff_reset(self, admin_client, mailoutbox):
        resp = admin_client.post(
            reverse("admin-staff"),
            {"email": "caja@test.mx", "first_name": "Caja", "role": "staff"},
            format="json",
        )
        assert resp.status_code == 201, resp.data
        staff = User.objects.get(email="caja@test.mx")
        assert staff.password_change_required is True
        User.objects.filter(pk=staff.pk).update(password_change_required=False)
        assert (
            admin_client.post(
                reverse("admin-staff-reset", args=[staff.pk]), {}, format="json"
            ).status_code
            == 200
        )
        staff.refresh_from_db()
        assert staff.password_change_required is True

    def test_a_refused_reset_sets_nothing(self, admin_client):
        other_admin = AdminFactory()
        assert (
            admin_client.post(
                reverse("admin-staff-reset", args=[other_admin.pk]), {}, format="json"
            ).status_code
            == 403
        )
        other_admin.refresh_from_db()
        assert other_admin.password_change_required is False


# ── the server-side gate ───────────────────────────────────────────────────
class TestGate:
    def test_a_normal_endpoint_is_refused_with_the_code(self):
        resp = _bearer(_flagged()).get(NORMAL)
        assert resp.status_code == 403
        assert resp.data["code"] == "password_change_required"
        assert resp.data["detail"] == "Antes de continuar, cree su propia contraseña."

    def test_an_admin_endpoint_is_refused_too(self):
        admin = AdminFactory()
        User.objects.filter(pk=admin.pk).update(password_change_required=True)
        resp = _bearer(admin).get(reverse("admin-staff"))
        assert resp.status_code == 403 and resp.data["code"] == "password_change_required"

    def test_everyone_else_is_untouched(self):
        assert _bearer(ParentFactory()).get(NORMAL).status_code == 200

    def test_me_is_readable_and_says_so_but_not_editable(self):
        client = _bearer(_flagged())
        resp = client.get(ME)
        assert resp.status_code == 200 and resp.data["password_change_required"] is True
        assert client.patch(ME, {"first_name": "Otro"}, format="json").status_code == 403

    def test_logout_and_refresh_still_work(self):
        user = _flagged()
        refresh = RefreshToken.for_user(user)
        client = _bearer(user)
        client.cookies[settings.AUTH_REFRESH_COOKIE] = str(refresh)
        client.cookies[settings.AUTH_CSRF_COOKIE] = CSRF
        renewed = client.post(reverse("token-refresh"), {}, format="json", HTTP_X_CSRF_TOKEN=CSRF)
        assert renewed.status_code == 200 and renewed.data["access"]
        client.cookies[settings.AUTH_CSRF_COOKIE] = CSRF
        assert (
            client.post(reverse("logout"), {}, format="json", HTTP_X_CSRF_TOKEN=CSRF).status_code
            == 200
        )

    def test_a_public_endpoint_answers_as_to_any_visitor(self):
        assert _bearer(_flagged()).get(reverse("legal-notice")).status_code == 200

    def test_public_views_never_see_the_account(self):
        class WhoAmI(APIView):
            permission_classes = [AllowAny]

            def get(self, request):
                return Response({"anonymous": request.user.is_anonymous})

        token = RefreshToken.for_user(_flagged()).access_token
        request = APIRequestFactory().get("/x/", HTTP_AUTHORIZATION=f"Bearer {token}")
        assert WhoAmI.as_view()(request).data == {"anonymous": True}
        normal = RefreshToken.for_user(ParentFactory()).access_token
        request = APIRequestFactory().get("/x/", HTTP_AUTHORIZATION=f"Bearer {normal}")
        assert WhoAmI.as_view()(request).data == {"anonymous": False}

    def test_a_reset_reaches_a_session_already_open(self):
        """The admin resets while the family is signed in: its next call is gated
        (the access token lives up to 15 minutes, the flag is read every request)."""
        family = ParentFactory()
        client = _bearer(family)
        assert client.get(NORMAL).status_code == 200
        admin = APIClient()
        admin.force_authenticate(AdminFactory())
        assert (
            admin.post(
                reverse("admin-set-password", args=[family.pk]), {}, format="json"
            ).status_code
            == 200
        )
        assert client.get(NORMAL).status_code == 403


# ── POST /accounts/me/password/ ────────────────────────────────────────────
class TestChangeOwnPassword:
    def test_replaces_the_temporary_password_and_opens_the_portal(self):
        user = _flagged(email="temporal@test.mx")
        this_browser = RefreshToken.for_user(user)
        elsewhere = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {this_browser.access_token}")
        client.cookies[settings.AUTH_REFRESH_COOKIE] = str(this_browser)
        resp = client.post(
            MY_PASSWORD,
            {"current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        assert resp.data["user"]["password_change_required"] is False
        user.refresh_from_db()
        assert user.password_change_required is False and user.check_password(NEW_PASSWORD)
        # Other sessions closed; this browser keeps its own.
        assert resp.data["sessions_revoked"] == 1
        assert BlacklistedToken.objects.filter(token__jti=elsewhere["jti"]).exists()
        assert not BlacklistedToken.objects.filter(token__jti=this_browser["jti"]).exists()
        # The same access token now opens everything.
        assert client.get(NORMAL).status_code == 200
        row = AuditLog.objects.get(context="accounts.change_own_password")
        assert row.changes["was_temporary"] is True and NEW_PASSWORD not in str(row.changes)
        assert _sign_in(APIClient(), "temporal@test.mx", NEW_PASSWORD).status_code == 200

    def test_wrong_current_password(self):
        resp = _bearer(_flagged()).post(
            MY_PASSWORD, {"current_password": "nope", "new_password": NEW_PASSWORD}, format="json"
        )
        assert resp.status_code == 400 and "no es correcta" in resp.data["current_password"][0]

    @pytest.mark.parametrize("weak", ["corta1", "1234567890123", "password1234"])
    def test_django_password_rules_apply(self, weak):
        resp = _bearer(_flagged()).post(
            MY_PASSWORD, {"current_password": DEFAULT_PASSWORD, "new_password": weak}, format="json"
        )
        assert resp.status_code == 400 and resp.data["new_password"]

    def test_too_similar_to_the_email(self):
        user = _flagged(email="mariagonzalez@test.mx")
        resp = _bearer(user).post(
            MY_PASSWORD,
            {"current_password": DEFAULT_PASSWORD, "new_password": "mariagonzalez"},
            format="json",
        )
        assert resp.status_code == 400 and resp.data["new_password"]

    def test_must_differ_from_the_current_one(self):
        resp = _bearer(_flagged()).post(
            MY_PASSWORD,
            {"current_password": DEFAULT_PASSWORD, "new_password": DEFAULT_PASSWORD},
            format="json",
        )
        assert resp.status_code == 400 and "distinta" in resp.data["new_password"][0]
        assert resp.data.keys() == {"new_password"}

    def test_missing_fields(self):
        resp = _bearer(ParentFactory()).post(MY_PASSWORD, {}, format="json")
        assert resp.status_code == 400 and set(resp.data) == {"current_password", "new_password"}

    def test_a_google_only_account_has_no_current_password(self):
        user = ParentFactory()
        user.set_unusable_password()
        user.save(update_fields=["password"])
        resp = _bearer(user).post(
            MY_PASSWORD, {"current_password": "", "new_password": NEW_PASSWORD}, format="json"
        )
        assert resp.status_code == 400 and "current_password" in resp.data

    def test_needs_a_sign_in(self):
        assert APIClient().post(MY_PASSWORD, {}, format="json").status_code == 401

    def test_anyone_signed_in_may_change_it(self):
        user = ParentFactory()
        resp = _bearer(user).post(
            MY_PASSWORD,
            {"current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD},
            format="json",
        )
        assert resp.status_code == 200
        assert (
            AuditLog.objects.get(context="accounts.change_own_password").changes["was_temporary"]
            is False
        )


# ── the password sign-in tells the SPA ─────────────────────────────────────
class TestSignIn:
    def test_the_login_answer_and_me_carry_the_flag(self, api_client):
        _flagged(email="nuevo@test.mx")
        resp = _sign_in(api_client, "nuevo@test.mx", DEFAULT_PASSWORD)
        assert resp.status_code == 200 and resp.data["password_change_required"] is True
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
        assert client.get(ME).data["password_change_required"] is True
        assert client.get(NORMAL).status_code == 403

    def test_a_normal_sign_in_says_false(self, api_client):
        ParentFactory(email="normal@test.mx")
        assert (
            _sign_in(api_client, "normal@test.mx", DEFAULT_PASSWORD).data[
                "password_change_required"
            ]
            is False
        )

    def test_temporary_password_with_totp(self, api_client):
        """An admin-invited staff member who also turned on TOTP: the code first,
        then «Cree su contraseña», then the console."""
        staff = UserFactory(email="caja@test.mx", role=User.Role.STAFF, staff_areas=["cafeteria"])
        User.objects.filter(pk=staff.pk).update(password_change_required=True)
        secret = new_secret()
        TotpDevice.objects.create(user=staff, secret=secret, confirmed=True)

        asked = _sign_in(api_client, "caja@test.mx", DEFAULT_PASSWORD)
        assert (
            asked.status_code == 401
            and asked.data["totp_required"] is True
            and "access" not in asked.data
        )
        resp = _sign_in(api_client, "caja@test.mx", DEFAULT_PASSWORD, totp=totp_code(secret))
        assert resp.status_code == 200 and resp.data["password_change_required"] is True
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
        assert client.get(NORMAL).status_code == 403
        changed = client.post(
            MY_PASSWORD,
            {"current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD},
            format="json",
        )
        assert changed.status_code == 200, changed.data
        assert client.get(NORMAL).status_code == 200
        # The next sign-in still asks for the code (a new one), with the new password.
        later = time.time() + 60
        with patch("apps.accounts.security.time.time", return_value=later):
            assert _sign_in(api_client, "caja@test.mx", NEW_PASSWORD).data["totp_required"] is True
            again = _sign_in(
                api_client, "caja@test.mx", NEW_PASSWORD, totp=totp_code(secret, at=later)
            )
        assert again.status_code == 200 and again.data["password_change_required"] is False


# ── Google sign-in retires an unused temporary password ────────────────────
@patch("apps.accounts.views.google_id_token.verify_oauth2_token")
class TestGoogleRetiresTheTemporaryPassword:
    def _google(self, mock_verify, sub, email):
        mock_verify.return_value = {"sub": sub, "email": email, "email_verified": True}
        return APIClient().post(reverse("google-token"), {"credential": "fake"}, format="json")

    def test_google_sign_in_clears_the_flag_and_the_password(self, mock_verify):
        family = _flagged(email="familia@test.mx")
        opened_with_it = RefreshToken.for_user(family)
        resp = self._google(mock_verify, "g-familia", "familia@test.mx")
        assert resp.status_code == 200, resp.data
        assert resp.data["user"]["password_change_required"] is False
        family.refresh_from_db()
        assert family.password_change_required is False and not family.has_usable_password()
        # A session opened with the temporary password (maybe not theirs) is closed.
        assert BlacklistedToken.objects.filter(token__jti=opened_with_it["jti"]).exists()
        row = AuditLog.objects.get(context="accounts.temporary_password_retired")
        assert row.changes["via"] == "google" and row.actor_id == family.pk
        assert _sign_in(APIClient(), "familia@test.mx", DEFAULT_PASSWORD).status_code == 401
        # The Google session itself works everywhere.
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
        assert client.get(NORMAL).status_code == 200

    def test_a_password_the_person_made_is_kept(self, mock_verify):
        family = ParentFactory(email="propia@test.mx")
        assert self._google(mock_verify, "g-propia", "propia@test.mx").status_code == 200
        family.refresh_from_db()
        assert family.has_usable_password()
        assert not AuditLog.objects.filter(context="accounts.temporary_password_retired").exists()

    def test_google_mismatch_retires_nothing(self, mock_verify):
        """``_google_id_conflict`` runs first: someone else's Google account
        must not be able to wipe a staff member's temporary password."""
        staff = UserFactory(email="staff@test.mx", role=User.Role.STAFF, google_id="g-staff")
        User.objects.filter(pk=staff.pk).update(password_change_required=True)
        resp = self._google(mock_verify, "g-intruso", "staff@test.mx")
        assert resp.status_code == 403 and resp.data["code"] == "google_mismatch"
        staff.refresh_from_db()
        assert staff.password_change_required is True and staff.check_password(DEFAULT_PASSWORD)
        assert not AuditLog.objects.filter(context="accounts.temporary_password_retired").exists()

    @patch("apps.accounts.views.requests.get")
    @patch("apps.accounts.views.requests.post")
    def test_the_redirect_flow_too(self, mock_post, mock_get, mock_verify):
        class _Resp:
            def __init__(self, payload):
                self.status_code, self._payload = 200, payload

            def json(self):
                return self._payload

        family = _flagged(email="redir@test.mx")
        mock_post.return_value = _Resp({"access_token": "ya29.fake"})
        mock_get.return_value = _Resp(
            {"sub": "g-redir", "email": "redir@test.mx", "email_verified": True}
        )
        client = APIClient()
        session = client.session
        session["google_oauth_state"] = "st"
        session.save()
        resp = client.get(reverse("google-callback"), {"code": "abc", "state": "st"})
        assert resp.status_code == 302 and "login=ok" in resp["Location"]
        family.refresh_from_db()
        assert family.password_change_required is False and not family.has_usable_password()

    @patch("apps.accounts.views.requests.get")
    @patch("apps.accounts.views.requests.post")
    def test_the_redirect_flow_mismatch_retires_nothing(self, mock_post, mock_get, mock_verify):
        class _Resp:
            def __init__(self, payload):
                self.status_code, self._payload = 200, payload

            def json(self):
                return self._payload

        admin = AdminFactory(email="jefa@test.mx", google_id="g-jefa")
        User.objects.filter(pk=admin.pk).update(password_change_required=True)
        mock_post.return_value = _Resp({"access_token": "ya29.fake"})
        mock_get.return_value = _Resp(
            {"sub": "g-otra", "email": "jefa@test.mx", "email_verified": True}
        )
        client = APIClient()
        session = client.session
        session["google_oauth_state"] = "st"
        session.save()
        resp = client.get(reverse("google-callback"), {"code": "abc", "state": "st"})
        assert "error=google_mismatch" in resp["Location"]
        admin.refresh_from_db()
        assert admin.password_change_required is True and admin.has_usable_password()


# ── the staff invitation email ─────────────────────────────────────────────
class TestStaffInvitationEmail:
    def _invite(self, client, email="nueva@test.mx"):
        return client.post(
            reverse("admin-staff"),
            {"email": email, "first_name": "Nora", "last_name": "Vega", "role": "staff"},
            format="json",
        )

    def test_says_where_to_sign_in_and_never_the_password(self, admin_client, mailoutbox, settings):
        settings.FRONTEND_URL = "https://colegio.test"
        resp = self._invite(admin_client)
        assert resp.status_code == 201, resp.data
        assert resp.data["invite_email_sent"] is True
        password = resp.data["temporary_password"]
        assert len(mailoutbox) == 1
        sent = mailoutbox[0]
        assert sent.to == ["nueva@test.mx"]
        html = "".join(str(alt[0]) for alt in getattr(sent, "alternatives", []))
        text = sent.subject + sent.body + html
        assert password not in text
        assert password.replace("-", "") not in text
        assert "https://colegio.test/login" in text
        assert "Continuar con Google" in sent.body
        assert "contraseña temporal" in sent.body and "en persona" in sent.body
        assert "se le pedirá crear su propia contraseña" in sent.body

    def test_a_mail_failure_never_fails_the_invite(self, admin_client):
        with patch("apps.portal.services.send_email", return_value=False):
            resp = self._invite(admin_client)
        assert resp.status_code == 201 and resp.data["invite_email_sent"] is False
        assert resp.data["temporary_password"]
        assert User.objects.filter(email="nueva@test.mx").exists()

    def test_even_an_exception_never_fails_the_invite(self, admin_client):
        with patch("apps.portal.services.send_email", side_effect=RuntimeError("smtp down")):
            resp = self._invite(admin_client, "otra@test.mx")
        assert resp.status_code == 201 and resp.data["invite_email_sent"] is False

    def test_a_reset_sends_no_email(self, admin_client):
        staff = UserFactory(email="caja@test.mx", role=User.Role.STAFF)
        mail.outbox.clear()
        assert (
            admin_client.post(
                reverse("admin-staff-reset", args=[staff.pk]), {}, format="json"
            ).status_code
            == 200
        )
        assert mail.outbox == []

    def test_a_refused_invite_sends_nothing(self, admin_client, mailoutbox):
        StudentUserFactory(email="ya@test.mx")
        assert self._invite(admin_client, "ya@test.mx").status_code == 400
        assert mailoutbox == []
