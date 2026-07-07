"""
Payment webhook security + idempotency, and the initiate endpoint.

The webhook verifies an HMAC-SHA256 signature over the raw body and must be a
no-op for a payment that already reached a final state (replay protection).
"""

import hashlib
import hmac
import json

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory
from apps.payments.factories import PaymentFactory
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

SECRET = "test-webhook-secret"


def _sign(body: bytes) -> str:
    return hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


def _post_webhook(api_client, payload, signature=None):
    body = json.dumps(payload).encode()
    headers = {}
    if signature is not None:
        headers["HTTP_X_WEBHOOK_SIGNATURE"] = signature
    return api_client.post(
        reverse("payment-webhook"),
        data=body,
        content_type="application/json",
        **headers,
    )


class TestWebhookSignature:
    def test_missing_signature_is_rejected(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        payment = PaymentFactory()
        resp = _post_webhook(api_client, {"order_id": payment.id, "status": "CAPTURED"})
        assert resp.status_code == 401
        payment.refresh_from_db()
        assert payment.status == Payment.Status.PENDING

    def test_wrong_signature_is_rejected(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        payment = PaymentFactory()
        resp = _post_webhook(
            api_client,
            {"order_id": payment.id, "status": "CAPTURED"},
            signature="not-the-right-signature",
        )
        assert resp.status_code == 401

    def test_no_configured_secret_fails_closed(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = ""
        settings.BANORTE_WEBHOOK_SECRET = ""
        payment = PaymentFactory()
        payload = {"order_id": payment.id, "status": "CAPTURED"}
        body = json.dumps(payload).encode()
        # Even a "valid-looking" signature can't pass when no secret is set.
        resp = _post_webhook(api_client, payload, signature=_sign(body))
        assert resp.status_code == 401

    def test_valid_signature_marks_payment_success(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        payment = PaymentFactory()
        payload = {"order_id": payment.id, "status": "CAPTURED", "id": "gp-tx-123"}
        body = json.dumps(payload).encode()
        resp = api_client.post(
            reverse("payment-webhook"),
            data=body,
            content_type="application/json",
            HTTP_X_WEBHOOK_SIGNATURE=_sign(body),
        )
        assert resp.status_code == 200, resp.data
        payment.refresh_from_db()
        assert payment.status == Payment.Status.SUCCESS
        assert payment.gateway_tx_id == "gp-tx-123"


class TestWebhookIdempotency:
    def test_replay_on_finalized_payment_is_noop(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        payment = PaymentFactory(status=Payment.Status.SUCCESS, gateway_tx_id="original-tx")
        payload = {"order_id": payment.id, "status": "FAILED", "id": "replay-tx"}
        body = json.dumps(payload).encode()
        resp = api_client.post(
            reverse("payment-webhook"),
            data=body,
            content_type="application/json",
            HTTP_X_WEBHOOK_SIGNATURE=_sign(body),
        )
        assert resp.status_code == 200
        assert resp.data["detail"] == "already_processed"
        payment.refresh_from_db()
        # Neither status nor tx id changed — the replay was ignored.
        assert payment.status == Payment.Status.SUCCESS
        assert payment.gateway_tx_id == "original-tx"

    def test_unknown_payment_is_404(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        payload = {"order_id": 999999, "status": "CAPTURED"}
        body = json.dumps(payload).encode()
        resp = api_client.post(
            reverse("payment-webhook"),
            data=body,
            content_type="application/json",
            HTTP_X_WEBHOOK_SIGNATURE=_sign(body),
        )
        assert resp.status_code == 404


class TestPaymentInitiate:
    def test_requires_authentication(self, api_client):
        resp = api_client.post(
            reverse("payment-initiate"),
            {
                "amount": "500.00",
                "payment_type": "tuition",
            },
            format="json",
        )
        assert resp.status_code == 401

    def test_authenticated_user_creates_pending_payment(self, api_client):
        user = ParentFactory()
        api_client.force_authenticate(user=user)
        resp = api_client.post(
            reverse("payment-initiate"),
            {
                "amount": "500.00",
                "payment_type": "tuition",
                "description": "Colegiatura",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["status"] == Payment.Status.PENDING
        payment = Payment.objects.get(pk=resp.data["payment_id"])
        assert payment.user == user

    def test_history_is_scoped_to_the_user(self, api_client):
        mine = ParentFactory()
        PaymentFactory(user=mine)
        PaymentFactory(user=ParentFactory())  # someone else's payment
        api_client.force_authenticate(user=mine)
        resp = api_client.get(reverse("payment-history"))
        assert resp.status_code == 200
        rows = resp.data.get("results", resp.data)
        assert len(rows) == 1
