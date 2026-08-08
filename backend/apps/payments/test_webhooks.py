"""
Payment webhook security + idempotency, and the initiate endpoint.

The webhook verifies an HMAC-SHA256 signature over the raw body and must be a
no-op for a payment that already reached a final state (replay protection).
A later ``REFUNDED`` event on a successful payment reverses cafeteria/tuition
credits.
"""

import hashlib
import hmac
import json
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.finance import services as finance_services
from apps.finance.models import FeeSchedule, InvoicePayment
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


def _signed(api_client, payload):
    body = json.dumps(payload).encode()
    return api_client.post(
        reverse("payment-webhook"),
        data=body,
        content_type="application/json",
        HTTP_X_WEBHOOK_SIGNATURE=_sign(body),
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


class TestWebhookRefund:
    def test_refund_reverses_cafeteria_topup(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal('200.00'),
            method=TopUpRequest.Method.ONLINE,
        )
        payment = Payment.objects.create(
            user=parent, payment_type=Payment.Type.CAFETERIA,
            amount=Decimal('200.00'), gateway=Payment.Gateway.GLOBAL_PAYMENTS,
            related_topup=topup, status=Payment.Status.PENDING,
        )

        assert _signed(api_client, {
            'order_id': payment.id, 'status': 'CAPTURED', 'id': 'gp-1',
        }).status_code == 200
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('200.00')

        resp = _signed(api_client, {
            'order_id': payment.id, 'status': 'REFUNDED', 'id': 'gp-refund-1',
        })
        assert resp.status_code == 200
        assert resp.data['detail'] == 'refunded'
        payment.refresh_from_db()
        assert payment.status == Payment.Status.REFUNDED
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('0.00')
        assert CafeteriaTransaction.objects.filter(
            student=student,
            transaction_type=CafeteriaTransaction.TxType.REFUND,
        ).exists()

        # Replay is a no-op.
        again = _signed(api_client, {
            'order_id': payment.id, 'status': 'REFUNDED', 'id': 'gp-refund-1',
        })
        assert again.data['detail'] == 'already_processed'
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('0.00')

    def test_refund_reopens_tuition_invoice(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        FeeSchedule.objects.create(
            name='Mensual', grade='', monthly_amount=Decimal('1500.00'),
            due_day=5, active=True,
        )
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        finance_services.generate_invoices('2026-08')
        from apps.finance.models import Invoice
        invoice = Invoice.objects.get(student=student, period='2026-08')
        payment, _ = finance_services.start_invoice_payment(invoice, parent)

        assert _signed(api_client, {
            'order_id': payment.id, 'status': 'CAPTURED', 'id': 'tu-1',
        }).status_code == 200
        invoice.refresh_from_db()
        assert invoice.status == invoice.Status.PAID

        resp = _signed(api_client, {
            'order_id': payment.id, 'status': 'REFUNDED', 'id': 'tu-refund',
        })
        assert resp.status_code == 200
        payment.refresh_from_db()
        invoice.refresh_from_db()
        assert payment.status == Payment.Status.REFUNDED
        assert invoice.amount_paid == Decimal('0.00')
        assert invoice.status in (invoice.Status.PENDING, invoice.Status.OVERDUE)
        assert InvoicePayment.objects.get(payment=payment).applied_at is None


class TestPaymentInitiate:
    def test_requires_authentication(self, api_client):
        resp = api_client.post(
            reverse("payment-initiate"),
            {
                "amount": "500.00",
                "payment_type": "other",
            },
            format="json",
        )
        assert resp.status_code == 401

    @pytest.mark.parametrize("payment_type", ["tuition", "cafeteria", "enrollment", "other"])
    def test_rejects_unlinked_money_types(self, api_client, payment_type):
        """Bare initiate must not open an HPP session that credits nothing."""
        api_client.force_authenticate(user=ParentFactory())
        resp = api_client.post(
            reverse("payment-initiate"),
            {"amount": "500.00", "payment_type": payment_type},
            format="json",
        )
        assert resp.status_code == 400, resp.data
        assert "payment_type" in resp.data
        assert not Payment.objects.exists()

    def test_history_is_scoped_to_the_user(self, api_client):
        mine = ParentFactory()
        PaymentFactory(user=mine)
        PaymentFactory(user=ParentFactory())  # someone else's payment
        api_client.force_authenticate(user=mine)
        resp = api_client.get(reverse("payment-history"))
        assert resp.status_code == 200
        rows = resp.data.get("results", resp.data)
        assert len(rows) == 1
