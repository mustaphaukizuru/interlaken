"""«Pedir un enlace nuevo»: a family whose documents link was used or expired
asks for a fresh one from the page, with its email.

The answer is always the same 200 (no account or application enumeration).
A link goes out only where the staff reminder would send one (the ficha is
sent and documents are missing), only to the address on file, through the
same function (single-use, the older link stops working), and the
registration's history says the family asked for it.
"""

import re
import time as _time

import pytest
from django.core import mail
from django.core.cache import cache
from django.urls import reverse

from apps.admissions.document_models import RequiredDocument
from apps.admissions.models import Registration
from apps.admissions.services import FAMILY_LINK_ACTOR, FAMILY_LINK_CONTEXT, FAMILY_LINK_MESSAGE
from apps.admissions.tokens import issue_invite, redeem_invite
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

URL = reverse("documents-new-link")
ON_FILE = "Tutora.Prueba@Ejemplo.test"


@pytest.fixture(autouse=True)
def _env(settings, tmp_path):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.MEDIA_ROOT = str(tmp_path)
    mail.outbox.clear()


@pytest.fixture(autouse=True)
def sync_background(monkeypatch):
    """The view sends from a daemon thread; run it inline here."""
    from apps.portal import services

    started = []

    def run(fn, *, name):
        started.append(name)
        fn()

    monkeypatch.setattr(services, "run_in_background", run)
    return started


def _reg(status=Registration.Status.SUBMITTED, email=ON_FILE):
    reg = Registration.objects.create(
        child_first_name="Beto",
        child_last_name="Prueba",
        child_dob="2018-01-01",
        level="primaria",
        grade_applying="2° Primaria",
        parent1_name="Tutora Prueba",
        parent1_email=email,
        parent1_phone="5511112222",
        status=status,
    )
    raw = issue_invite(reg)  # the link the family already used or let expire
    reg.refresh_from_db()
    return reg, raw


def _ask(client, email, registration=None):
    body = {"email": email}
    if registration is not None:
        body["registration"] = registration
    return client.post(URL, body, format="json")


def _assert_generic(resp):
    assert resp.status_code == 200, resp.data
    assert resp.json() == {"detail": FAMILY_LINK_MESSAGE}


def _assert_nothing_sent(reg, before_hash):
    reg.refresh_from_db()
    assert reg.invite_token_hash == before_hash
    assert mail.outbox == []
    assert not AuditLog.objects.filter(context=FAMILY_LINK_CONTEXT).exists()


class TestSendsWhenEligible:
    def test_fresh_link_to_the_address_on_file(self, api_client, sync_background):
        reg, old_raw = _reg()
        before = reg.invite_token_hash
        # Typed in another letter case: still that family, the email keeps the address on file.
        _assert_generic(_ask(api_client, "  tutora.prueba@ejemplo.TEST ", reg.pk))
        assert sync_background == ["admissions-docs-new-link"]

        assert len(mail.outbox) == 1
        msg = mail.outbox[0]
        assert msg.to == [ON_FILE]
        assert f"/inscripcion/documentos?rid={reg.pk}&token=" in msg.body
        new_raw = re.search(r"token=([\w-]+)", msg.body).group(1)

        reg.refresh_from_db()
        assert reg.invite_token_hash != before
        # The same single-use link as the staff send: the old one is dead, the new one works once.
        assert redeem_invite(reg, old_raw) is False
        assert redeem_invite(reg, new_raw) is True
        assert redeem_invite(reg, new_raw) is False

    def test_history_says_the_family_asked(self, api_client):
        reg, _raw = _reg()
        _ask(api_client, ON_FILE, reg.pk)
        row = AuditLog.objects.get(
            object_type="admissions.registration",
            object_id=str(reg.pk),
            context=FAMILY_LINK_CONTEXT,
        )
        assert row.action == "update"
        assert row.actor is None and row.actor_label == FAMILY_LINK_ACTOR
        assert row.changes["requested_by"] == "familia"
        assert "Acta de nacimiento" in row.changes["requested_docs"]

    def test_without_the_page_rid_only_the_eligible_registrations(self, api_client):
        sent, _raw = _reg()
        draft, _raw2 = _reg(status=Registration.Status.DRAFT)
        draft_hash = draft.invite_token_hash
        _assert_generic(_ask(api_client, ON_FILE))
        assert len(mail.outbox) == 1 and f"rid={sent.pk}&" in mail.outbox[0].body
        draft.refresh_from_db()
        assert draft.invite_token_hash == draft_hash  # its ficha link stays usable


class TestSameAnswerWhenNothingIsSent:
    def test_unknown_address(self, api_client, sync_background):
        _assert_generic(_ask(api_client, "nadie@ejemplo.test"))
        assert mail.outbox == [] and sync_background == []

    def test_ficha_not_sent_yet(self, api_client):
        # Same rule as the staff reminder: documents wait for the ficha
        # (test_docs_after_ficha), and the ficha link in the family's email survives.
        reg, _raw = _reg(status=Registration.Status.DRAFT)
        before = reg.invite_token_hash
        _assert_generic(_ask(api_client, ON_FILE, reg.pk))
        _assert_nothing_sent(reg, before)

    def test_nothing_missing(self, api_client):
        reg, _raw = _reg()
        RequiredDocument.objects.update(active=False)
        before = reg.invite_token_hash
        _assert_generic(_ask(api_client, ON_FILE, reg.pk))
        _assert_nothing_sent(reg, before)

    @pytest.mark.parametrize(
        "typed",
        [
            "otra.persona@ejemplo.test",
            "tutora.prueba@ejemplo.test.mx",
            "x" + ON_FILE,
        ],
    )
    def test_a_different_address_never_gets_it(self, api_client, typed):
        reg, _raw = _reg()
        before = reg.invite_token_hash
        _assert_generic(_ask(api_client, typed, reg.pk))
        _assert_nothing_sent(reg, before)

    def test_the_rid_of_another_family(self, api_client):
        mine, _raw = _reg()
        other, _raw2 = _reg(email="otra@ejemplo.test")
        before = other.invite_token_hash
        _assert_generic(_ask(api_client, ON_FILE, other.pk))
        _assert_nothing_sent(other, before)
        mine.refresh_from_db()

    def test_a_malformed_address_is_a_field_error(self, api_client):
        resp = _ask(api_client, "no-es-correo")
        assert resp.status_code == 400 and "email" in resp.data
        assert mail.outbox == []


class _FrozenTime:
    """Pin django-ratelimit's window (a real minute rollover would reset it)."""

    _now = _time.time()

    @staticmethod
    def time():
        return _FrozenTime._now


class TestRateLimits:
    @pytest.fixture(autouse=True)
    def _limits_on(self, settings, monkeypatch):
        settings.RATELIMIT_ENABLE = True
        monkeypatch.setattr("django_ratelimit.core.time", _FrozenTime)
        cache.clear()

    def test_per_address(self, api_client):
        codes = [
            _ask(api_client, email).status_code
            for email in ("a@ejemplo.test", "A@Ejemplo.test", "a@ejemplo.test", "a@EJEMPLO.test")
        ]
        assert codes == [200, 200, 200, 429]
        assert _ask(api_client, "b@ejemplo.test").status_code == 200

    def test_per_network(self, api_client):
        codes = [_ask(api_client, f"familia{i}@ejemplo.test").status_code for i in range(11)]
        assert codes[:10] == [200] * 10 and codes[10] == 429


class TestFinishedProcessesAreNotReopened:
    @pytest.mark.parametrize("status", [Registration.Status.REJECTED, Registration.Status.COMPLETE])
    def test_rejected_or_complete_registration_gets_nothing(self, api_client, status):
        reg, _raw = _reg(status=status)
        before = reg.invite_token_hash
        _assert_generic(_ask(api_client, ON_FILE, reg.pk))
        _assert_nothing_sent(reg, before)

    def test_closed_case_gets_nothing(self, api_client):
        from django.utils import timezone

        from apps.admissions.models import PreRegistration

        reg, _raw = _reg()
        pre = PreRegistration.objects.create(
            child_first_name="Beto",
            child_last_name="Prueba",
            level="primaria",
            grade_applying="2° Primaria",
            parent_name="Tutora Prueba",
            parent_email=ON_FILE,
            parent_phone="5511112222",
            closed_at=timezone.now(),
        )
        Registration.objects.filter(pk=reg.pk).update(pre_registration=pre)
        before = reg.invite_token_hash
        _assert_generic(_ask(api_client, ON_FILE, reg.pk))
        _assert_nothing_sent(reg, before)
