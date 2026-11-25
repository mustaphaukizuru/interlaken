"""
Two-step sign-in (TOTP) for the console, end to end (2026-11-24 review).

setup → secret + otpauth link (the QR) → enable with a valid code → a password
sign-in without the code asks for it → a wrong code is refused → the right
code signs in → disable. Plus what the review fixed:

* a sign-in that stops at the code step no longer leaves a phantom "open
  session" for 7 days (SimpleJWT had already minted a refresh token);
* a code accepted once is never accepted again (RFC 6238 §5.2): not the one
  that turned TOTP on, not one already used to sign in;
* a wrong code answers ``{"detail", "code": "bad_totp"}`` so the SPA shows the
  sentence (``{"code": [...]}`` was skipped by its error mapper).

The clock is pinned (``security.time.time``) so codes and steps are exact.
"""

from unittest.mock import patch

import pytest
from django.conf import settings
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from apps.accounts.factories import DEFAULT_PASSWORD, AdminFactory, ParentFactory, UserFactory
from apps.accounts.models import User
from apps.accounts.security import LoginEvent, TotpDevice, totp_code, use_totp

pytestmark = pytest.mark.django_db

T0 = 1_800_000_000  # a step boundary (divisible by 30)


def clock(at):
    return patch("apps.accounts.security.time.time", return_value=at)


def _sign_in(email, totp=None, client=None):
    body = {"email": email, "password": DEFAULT_PASSWORD}
    if totp is not None:
        body["totp"] = totp
    return (client or APIClient()).post(reverse("token-obtain"), body, format="json")


def _open_sessions(user) -> int:
    return (
        OutstandingToken.objects.filter(user=user)
        .exclude(id__in=BlacklistedToken.objects.values("token_id"))
        .count()
    )


@pytest.fixture
def boss():
    return AdminFactory(email="direccion@test.mx")


def _enable(user, at=T0) -> str:
    client = APIClient()
    client.force_authenticate(user)
    with clock(at):
        secret = client.post(reverse("totp-setup"), {}, format="json").data["secret"]
        assert (
            client.post(
                reverse("totp-enable"), {"code": totp_code(secret, at=at)}, format="json"
            ).status_code
            == 200
        )
    return secret


class TestTheWholeLoop:
    def test_setup_enable_sign_in_disable(self, boss):
        me = APIClient()
        me.force_authenticate(boss)

        # 1. Setup: a secret and the otpauth link the QR encodes.
        with clock(T0):
            setup = me.post(reverse("totp-setup"), {}, format="json")
        assert setup.status_code == 200
        secret = setup.data["secret"]
        url = setup.data["otpauth_url"]
        assert (
            url.startswith("otpauth://totp/")
            and f"secret={secret}" in url
            and "issuer=Interlaken" in url
        )
        assert "direccion%40test.mx" in url
        assert TotpDevice.objects.get(user=boss).confirmed is False
        # Not active yet: a password sign-in needs no code.
        assert _sign_in(boss.email).status_code == 200

        # 2. Enable: a wrong code says why, the right one turns it on.
        with clock(T0):
            wrong = me.post(
                reverse("totp-enable"),
                {"code": "000000" if totp_code(secret, at=T0) != "000000" else "111111"},
                format="json",
            )
            assert wrong.status_code == 400
            assert wrong.data == {
                "detail": "Código incorrecto. Revise la hora del teléfono.",
                "code": "bad_totp",
            }
            assert me.post(
                reverse("totp-enable"), {"code": totp_code(secret, at=T0)}, format="json"
            ).data == {"totp_enabled": True}
        # A fresh copy, as every real request loads one (force_authenticate reuses
        # the instance, whose cached ``totp`` is the unconfirmed one).
        me.force_authenticate(User.objects.get(pk=boss.pk))
        assert me.get(reverse("my-sessions")).data["totp_enabled"] is True
        sessions_before = _open_sessions(boss)

        # 3. Password without the code: asked for it, nothing handed out.
        with clock(T0 + 5):
            asked = _sign_in(boss.email)
        assert asked.status_code == 401 and asked.data["totp_required"] is True
        assert "access" not in asked.data and settings.AUTH_REFRESH_COOKIE not in asked.cookies
        assert _open_sessions(boss) == sessions_before  # no phantom session in «Seguridad»

        # 4. A wrong code is refused (and logged).
        with clock(T0 + 5):
            bad = _sign_in(
                boss.email, totp="123456" if totp_code(secret, at=T0) != "123456" else "654321"
            )
        assert bad.status_code == 401 and bad.data["detail"] == "Código incorrecto."
        assert LoginEvent.objects.filter(user=boss, success=False, reason="bad_totp").exists()
        assert _open_sessions(boss) == sessions_before

        # 5. The code that turned TOTP on cannot also sign in.
        with clock(T0 + 5):
            replay = _sign_in(boss.email, totp=totp_code(secret, at=T0))
        assert replay.status_code == 401 and "ya se usó" in replay.data["detail"]
        assert LoginEvent.objects.filter(user=boss, reason="reused_totp").exists()

        # 6. The next code signs in: access token, httpOnly cookie, one more session.
        with clock(T0 + 31):
            ok = _sign_in(boss.email, totp=totp_code(secret, at=T0 + 31))
        assert ok.status_code == 200 and ok.data["access"]
        assert ok.cookies[settings.AUTH_REFRESH_COOKIE]["httponly"]
        assert _open_sessions(boss) == sessions_before + 1
        assert LoginEvent.objects.filter(user=boss, success=True, method="password").exists()

        # 7. ...and only once.
        with clock(T0 + 40):
            again = _sign_in(boss.email, totp=totp_code(secret, at=T0 + 31))
        assert again.status_code == 401 and "ya se usó" in again.data["detail"]

        # 8. Disable: a wrong code keeps it, the right one removes it.
        with clock(T0 + 61):
            kept = me.post(
                reverse("totp-disable"),
                {"code": "000000" if totp_code(secret, at=T0 + 61) != "000000" else "111111"},
                format="json",
            )
            assert kept.status_code == 400 and kept.data["code"] == "bad_totp"
            assert TotpDevice.objects.filter(user=boss, confirmed=True).exists()
            off = me.post(
                reverse("totp-disable"), {"code": totp_code(secret, at=T0 + 61)}, format="json"
            )
        assert off.data == {"totp_enabled": False}
        assert not TotpDevice.objects.filter(user=boss).exists()
        assert _sign_in(boss.email).status_code == 200

    def test_a_code_typed_with_a_space(self, boss):
        secret = _enable(boss)
        code = totp_code(secret, at=T0 + 30)
        with clock(T0 + 30):
            assert _sign_in(boss.email, totp=f"{code[:3]} {code[3:]}").status_code == 200

    def test_the_previous_code_still_works_while_the_clock_drifts(self, boss):
        secret = _enable(boss)
        with clock(T0 + 65):  # step +2; the code of step +1 is inside the window
            assert _sign_in(boss.email, totp=totp_code(secret, at=T0 + 31)).status_code == 200

    def test_an_old_code_is_refused(self, boss):
        secret = _enable(boss)
        with clock(T0 + 300):
            resp = _sign_in(boss.email, totp=totp_code(secret, at=T0 + 31))
        assert resp.status_code == 401 and resp.data["detail"] == "Código incorrecto."


class TestSetupRules:
    def test_setting_up_again_before_enabling_replaces_the_secret(self, boss):
        me = APIClient()
        me.force_authenticate(boss)
        with clock(T0):
            first = me.post(reverse("totp-setup"), {}, format="json").data["secret"]
            second = me.post(reverse("totp-setup"), {}, format="json").data["secret"]
            assert first != second
            if totp_code(first, at=T0) != totp_code(second, at=T0):
                assert (
                    me.post(
                        reverse("totp-enable"), {"code": totp_code(first, at=T0)}, format="json"
                    ).status_code
                    == 400
                )
            assert (
                me.post(
                    reverse("totp-enable"), {"code": totp_code(second, at=T0)}, format="json"
                ).status_code
                == 200
            )

    def test_setup_once_active_is_refused(self, boss):
        _enable(boss)
        me = APIClient()
        me.force_authenticate(boss)
        resp = me.post(reverse("totp-setup"), {}, format="json")
        assert resp.status_code == 400 and "ya está activo" in resp.data["detail"]

    def test_enable_needs_a_setup_first(self, boss):
        me = APIClient()
        me.force_authenticate(boss)
        resp = me.post(reverse("totp-enable"), {"code": "123456"}, format="json")
        assert resp.status_code == 400 and resp.data["detail"] == "Primero genere la clave."

    def test_staff_may_use_it_families_may_not(self):
        staff = UserFactory(role=User.Role.STAFF)
        client = APIClient()
        client.force_authenticate(staff)
        assert client.post(reverse("totp-setup"), {}, format="json").status_code == 200
        client.force_authenticate(ParentFactory())
        assert client.post(reverse("totp-setup"), {}, format="json").status_code == 403

    def test_disable_when_not_active(self, boss):
        me = APIClient()
        me.force_authenticate(boss)
        resp = me.post(reverse("totp-disable"), {"code": "123456"}, format="json")
        assert resp.status_code == 400 and "no está activo" in resp.data["detail"]

    def test_it_stays_optional(self, boss):
        """Nobody is forced to turn it on: an admin without TOTP signs in with the password."""
        resp = _sign_in(boss.email)
        assert resp.status_code == 200 and resp.data["access"]


class TestOtherDoors:
    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_google_sign_in_keeps_google_s_own_second_factor(self, mock_verify, boss):
        _enable(boss)
        mock_verify.return_value = {
            "sub": "g-direccion",
            "email": boss.email,
            "email_verified": True,
        }
        resp = APIClient().post(reverse("google-token"), {"credential": "fake"}, format="json")
        assert resp.status_code == 200 and resp.data["access"]

    def test_a_wrong_password_never_reaches_the_code_step(self, boss):
        _enable(boss)
        resp = APIClient().post(
            reverse("token-obtain"), {"email": boss.email, "password": "otra"}, format="json"
        )
        assert resp.status_code == 401 and "totp_required" not in resp.data

    def test_two_sign_ins_racing_with_one_code(self, boss):
        secret = _enable(boss)
        device = TotpDevice.objects.get(user=boss)
        stale = TotpDevice.objects.get(user=boss)  # loaded before the first one wins
        with clock(T0 + 31):
            code = totp_code(secret, at=T0 + 31)
            assert use_totp(device, code) is None
            assert use_totp(stale, code) == "reused_totp"
