"""Owner 2026-11-26: facturación requests reach every billing address, and the
family's confirmation goes out when the office marks the request «Atendido»
(once), never when the form is sent."""

import importlib
from unittest import mock

import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.content.models import SiteSettings
from apps.core.facturacion import clean_recipients, recipients, request_data
from apps.core.models import AuditLog, ContactMessage

pytestmark = pytest.mark.django_db

PAYLOAD = {
    "student": "Ana Pérez López",
    "razon_social": "Luis Pérez",
    "rfc": "pelu800101ab1",
    "cp": "54000",
    "regimen": "Régimen simplificado de confianza",
    "email": "luis@test.mx",
    "phone": "(55) 1234-5678",
}
BILLING = ["facturas@interlaken.com.mx", "vvega@interlaken.com.mx"]


@pytest.fixture(autouse=True)
def _no_ratelimit(settings):
    settings.RATELIMIT_ENABLE = False
    settings.BILLING_EMAIL = "facturas@interlaken.com.mx"


def _billing(emails):
    s = SiteSettings.load()
    s.billing_emails = emails
    s.save()


def _submit(api_client):
    mail.outbox.clear()
    resp = api_client.post(reverse("facturacion-request"), PAYLOAD, format="json")
    assert resp.status_code == 201, resp.data
    return ContactMessage.objects.latest("pk")


def _family_mails():
    return [m for m in mail.outbox if m.to == ["luis@test.mx"]]


def _admin(api_client):
    admin = AdminFactory()
    api_client.force_authenticate(user=admin)
    return admin


# ── recipients ─────────────────────────────────────────────────────────────
def test_request_reaches_every_billing_address_and_not_the_family(api_client):
    _billing(BILLING)
    msg = _submit(api_client)
    to_billing = [m for m in mail.outbox if m.to == BILLING]
    assert len(to_billing) == 1 and to_billing[0].reply_to == ["luis@test.mx"]
    assert _family_mails() == []
    assert msg.facturacion["rfc"] == "PELU800101AB1" and msg.ack_sent_at is None


def test_empty_list_falls_back_to_the_billing_setting():
    _billing([])
    assert recipients() == ["facturas@interlaken.com.mx"]


def test_clean_recipients_validates_dedupes_and_caps():
    assert clean_recipients("A@x.mx, a@x.mx\nb@x.mx") == ["a@x.mx", "b@x.mx"]
    with pytest.raises(ValueError, match="Revise el correo"):
        clean_recipients(["bueno@x.mx", "malo"])
    with pytest.raises(ValueError, match="Máximo"):
        clean_recipients([f"p{i}@x.mx" for i in range(6)])


def test_ajustes_saves_the_list_admin_only(api_client):
    url = reverse("admin-site-settings")
    _admin(api_client)
    bad = api_client.patch(
        url, {"billing_emails": ["facturas@interlaken.com.mx", "nope"]}, format="json"
    )
    assert bad.status_code == 400 and "billing_emails" in bad.data
    ok = api_client.patch(url, {"billing_emails": ["VVEGA@interlaken.com.mx"]}, format="json")
    assert ok.status_code == 200 and ok.data["billing_emails"] == ["vvega@interlaken.com.mx"]
    # Never on the public settings (internal mailboxes).
    api_client.force_authenticate(user=None)
    assert "billing_emails" not in api_client.get(reverse("site-settings")).json()


# ── «Atendido» sends the confirmation, once ───────────────────────────────
def test_single_atendido_sends_the_confirmation_once(api_client):
    _billing(BILLING)
    msg = _submit(api_client)
    _admin(api_client)
    url = reverse("core-contact-handle", args=[msg.pk])
    resp = api_client.patch(url, {"is_handled": True}, format="json")
    assert resp.status_code == 200
    assert resp.data["confirmation"] == {"sent": True, "to": "luis@test.mx", "reason": ""}
    sent = _family_mails()
    assert len(sent) == 1 and sent[0].subject == "Sus datos de facturación quedaron registrados"
    assert "PELU800101AB1" in sent[0].body and sent[0].reply_to == ["facturas@interlaken.com.mx"]
    msg.refresh_from_db()
    assert msg.ack_sent_at is not None and resp.data["ack_sent_at"]
    assert AuditLog.objects.filter(
        context="contact.facturacion_confirmada", object_id=str(msg.pk)
    ).exists()
    # Reopen and mark again: no second email.
    api_client.patch(url, {"is_handled": False}, format="json")
    again = api_client.patch(url, {"is_handled": True}, format="json")
    assert again.data["confirmation"]["reason"] == "already_sent"
    assert len(_family_mails()) == 1


def test_contact_messages_never_trigger_a_confirmation(api_client):
    m = ContactMessage.objects.create(name="A", email="a@t.mx", subject="Hola", message="m")
    _admin(api_client)
    mail.outbox.clear()
    resp = api_client.patch(
        reverse("core-contact-handle", args=[m.pk]), {"is_handled": True}, format="json"
    )
    assert "confirmation" not in resp.data and mail.outbox == []


def test_failed_send_keeps_atendido_and_allows_a_later_try(api_client):
    msg = _submit(api_client)
    _admin(api_client)
    url = reverse("core-contact-handle", args=[msg.pk])
    with mock.patch("apps.portal.services.send_email", return_value=False):
        resp = api_client.patch(url, {"is_handled": True}, format="json")
    assert resp.status_code == 200 and resp.data["is_handled"] is True
    assert resp.data["confirmation"]["reason"] == "failed"
    msg.refresh_from_db()
    assert msg.is_handled is True and msg.ack_sent_at is None
    api_client.patch(url, {"is_handled": False}, format="json")
    retry = api_client.patch(url, {"is_handled": True}, format="json")
    assert retry.data["confirmation"]["sent"] is True


def test_older_requests_are_read_from_the_body():
    body = "\n".join(
        [
            "Nombre del alumno: Ana",
            "Razón social: Luis Pérez",
            "RFC: PELU800101AB1",
            "Código postal: 54000",
            "Régimen fiscal: Régimen simplificado de confianza",
            "Correo para enviar facturas: viejo@test.mx",
            "Teléfono de contacto: 5512345678",
        ]
    )
    old = ContactMessage.objects.create(
        name="Luis", email="viejo@test.mx", subject="[Facturación] X · Ana", message=body
    )
    assert request_data(old)["email"] == "viejo@test.mx"
    broken = ContactMessage.objects.create(
        name="L", email="x@test.mx", subject="[Facturación] Y", message="sin datos"
    )
    assert request_data(broken) is None


def test_unreadable_old_request_sends_nothing_and_says_why(api_client):
    m = ContactMessage.objects.create(
        name="L", email="x@test.mx", subject="[Facturación] Y", message="sin datos"
    )
    _admin(api_client)
    mail.outbox.clear()
    resp = api_client.patch(
        reverse("core-contact-handle", args=[m.pk]), {"is_handled": True}, format="json"
    )
    assert resp.data["confirmation"]["reason"] == "no_data" and mail.outbox == []


def test_requests_already_atendido_get_nothing(api_client):
    msg = _submit(api_client)
    ContactMessage.objects.filter(pk=msg.pk).update(is_handled=True)
    _admin(api_client)
    mail.outbox.clear()
    resp = api_client.patch(
        reverse("core-contact-handle", args=[msg.pk]), {"is_handled": True}, format="json"
    )
    assert "confirmation" not in resp.data and mail.outbox == []


# ── bulk «Marcar atendidos» ───────────────────────────────────────────────
def test_bulk_mark_handled_confirms_each_request_once_and_counts(api_client):
    a = _submit(api_client)
    b = _submit(api_client)
    contact = ContactMessage.objects.create(name="C", email="c@t.mx", subject="Hola", message="m")
    _admin(api_client)
    mail.outbox.clear()
    url = reverse("core-contact-inbox-bulk")
    resp = api_client.post(
        url, {"action": "mark_handled", "ids": [a.pk, b.pk, contact.pk]}, format="json"
    )
    assert resp.status_code == 200 and resp.data["ok"] == 3
    assert resp.data["confirmations"] == {"sent": 2, "failed": 0, "no_data": 0}
    assert len(_family_mails()) == 2
    # Reopen all, mark again: nothing more goes out.
    api_client.post(url, {"action": "reopen", "ids": [a.pk, b.pk]}, format="json")
    mail.outbox.clear()
    again = api_client.post(url, {"action": "mark_handled", "ids": [a.pk, b.pk]}, format="json")
    assert again.data["ok"] == 2 and "confirmations" not in again.data and _family_mails() == []


def test_bulk_dry_run_sends_nothing(api_client):
    a = _submit(api_client)
    _admin(api_client)
    mail.outbox.clear()
    resp = api_client.post(
        reverse("core-contact-inbox-bulk"),
        {"action": "mark_handled", "ids": [a.pk], "dry_run": True},
        format="json",
    )
    assert resp.status_code == 200 and mail.outbox == []
    a.refresh_from_db()
    assert a.is_handled is False and a.ack_sent_at is None


# ── data migration ─────────────────────────────────────────────────────────
def test_data_migration_sets_both_addresses_only_when_empty():
    mig = importlib.import_module("apps.content.migrations.0038_facturacion_atendido")
    from django.apps import apps as django_apps

    s = SiteSettings.load()
    s.billing_emails = []
    s.save()
    mig.set_billing_emails(django_apps, None)
    assert SiteSettings.objects.get(pk=1).billing_emails == BILLING
    s = SiteSettings.objects.get(pk=1)
    s.billing_emails = ["otra@interlaken.com.mx"]
    s.save()
    mig.set_billing_emails(django_apps, None)
    assert SiteSettings.objects.get(pk=1).billing_emails == ["otra@interlaken.com.mx"]
