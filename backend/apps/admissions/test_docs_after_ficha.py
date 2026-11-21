"""Documents are asked for only after the ficha is sent.

The ficha and the documents page share the family's single-use link, so a
documents link issued while the ficha is still a draft would cancel the ficha
link the family already has in their email. Every way staff can send a
documents link refuses a draft (409 ``ficha_pending``) and leaves that link
untouched; a sent ficha works as before.
"""
import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.admissions.models import Registration
from apps.admissions.services import FICHA_PENDING_MSG
from apps.admissions.tokens import issue_invite

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _env(settings, tmp_path):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.MEDIA_ROOT = str(tmp_path)


@pytest.fixture
def admin(api_client):
    api_client.force_authenticate(AdminFactory())
    return api_client


def _reg(status=Registration.Status.DRAFT):
    reg = Registration.objects.create(
        child_first_name="Beto",
        child_last_name="Prueba",
        child_dob="2018-01-01",
        level="primaria",
        grade_applying="2° Primaria",
        parent1_name="Tutora Prueba",
        parent1_email="tutora@ejemplo.test",
        parent1_phone="5511112222",
        status=status,
    )
    issue_invite(reg)  # the ficha link the family already has
    reg.refresh_from_db()
    return reg


def _assert_untouched(reg, before_hash):
    reg.refresh_from_db()
    assert reg.invite_token_hash == before_hash
    assert mail.outbox == []


@pytest.mark.parametrize("channel", ["email", "whatsapp"])
def test_reminder_waits_for_the_ficha(admin, channel):
    reg = _reg()
    before = reg.invite_token_hash
    mail.outbox.clear()
    resp = admin.post(
        reverse("register-checklist-reminder", args=[reg.pk]), {"channel": channel}, format="json"
    )
    assert resp.status_code == 409, resp.data
    assert resp.data["code"] == "ficha_pending"
    assert resp.data["detail"] == FICHA_PENDING_MSG
    _assert_untouched(reg, before)


def test_documents_link_waits_for_the_ficha(admin):
    reg = _reg()
    before = reg.invite_token_hash
    mail.outbox.clear()
    resp = admin.post(reverse("register-docs-link", args=[reg.pk]), {}, format="json")
    assert resp.status_code == 409, resp.data
    assert resp.data["code"] == "ficha_pending"
    _assert_untouched(reg, before)


def test_pipeline_request_docs_waits_for_the_ficha(admin):
    reg = _reg()
    before = reg.invite_token_hash
    mail.outbox.clear()
    resp = admin.post(reverse("register-request-docs", args=[reg.pk]), {}, format="json")
    assert resp.status_code == 409, resp.data
    assert resp.data["code"] == "ficha_pending"
    _assert_untouched(reg, before)


def test_bulk_request_docs_skips_a_draft(admin):
    reg = _reg()
    before = reg.invite_token_hash
    mail.outbox.clear()
    resp = admin.post(
        reverse("register-bulk"),
        {"action": "request_docs", "ids": [reg.pk], "all_matching": False, "dry_run": False},
        format="json",
    )
    assert resp.status_code in (200, 400), resp.data
    assert not resp.data.get("ok")
    _assert_untouched(reg, before)


def test_a_sent_ficha_still_gets_its_reminder(admin):
    reg = _reg(status=Registration.Status.SUBMITTED)
    before = reg.invite_token_hash
    mail.outbox.clear()
    resp = admin.post(reverse("register-checklist-reminder", args=[reg.pk]), {}, format="json")
    assert resp.status_code == 200, resp.data
    assert resp.data["missing"]
    reg.refresh_from_db()
    assert reg.invite_token_hash != before  # a fresh documents link replaced it
