"""
Online cafeteria top-up flow (Prompt 10 / spec §2.2):

    initiate → gateway redirect → signed webhook → local-ledger credit + notify.

Per spec R1 the webhook credits the **local** ``CafeteriaBalance`` only (no Loyverse
write). The flow is idempotent (replayed webhook is a no-op) and a failed payment
credits nothing.
"""
import hashlib
import hmac
import json
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.payments.models import Payment
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db

SECRET = "test-webhook-secret"


def _sign(body: bytes) -> str:
    return hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


def _post_webhook(api_client, payload):
    body = json.dumps(payload).encode()
    return api_client.post(
        reverse("payment-webhook"),
        data=body,
        content_type="application/json",
        HTTP_X_WEBHOOK_SIGNATURE=_sign(body),
    )


class TestTopUpInitiation:
    def test_online_topup_creates_linked_payment_and_returns_redirect(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])

        api_client.force_authenticate(user=parent)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": "200.00", "method": "online",
             "gateway": "global_payments"},
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["redirect_url"]
        assert resp.data["gateway"] == "global_payments"

        topup = TopUpRequest.objects.get(pk=resp.data["id"])
        assert topup.status == TopUpRequest.Status.PENDING
        payment = Payment.objects.get(pk=resp.data["payment_id"])
        assert payment.payment_type == Payment.Type.CAFETERIA
        assert payment.status == Payment.Status.PENDING
        assert payment.related_topup_id == topup.id
        # No credit yet — the webhook does that.
        assert not CafeteriaTransaction.objects.filter(student=student).exists()

    def test_parent_cannot_topup_another_students_child(self, api_client):
        parent = ParentFactory()
        other_student = StudentProfileFactory()  # not linked to parent
        api_client.force_authenticate(user=parent)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": other_student.id, "amount": "100.00", "method": "online"},
            format="json",
        )
        assert resp.status_code == 403

    def test_office_topup_creates_no_payment(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(user=parent)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": "100.00", "method": "office"},
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert "redirect_url" not in resp.data
        assert not Payment.objects.filter(related_topup_id=resp.data["id"]).exists()

    def test_student_self_guardian_can_topup_own_balance(self, api_client):
        """Loyverse family login: role=student, linked on student.parents."""
        student = StudentProfileFactory()
        student.parents.add(student.user)

        api_client.force_authenticate(user=student.user)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": "150.00", "method": "online",
             "gateway": "global_payments"},
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["redirect_url"]
        payment = Payment.objects.get(pk=resp.data["payment_id"])
        assert payment.user_id == student.user_id
        assert payment.related_topup_id == resp.data["id"]

    def test_student_can_topup_own_profile_without_parents_m2m(self, api_client):
        """Own OneToOne profile is enough even if self-guardian link is missing."""
        student = StudentProfileFactory()  # no parents.add(self)

        api_client.force_authenticate(user=student.user)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": "100.00", "method": "office"},
            format="json",
        )
        assert resp.status_code == 201, resp.data

    def test_student_cannot_topup_another_student(self, api_client):
        student = StudentProfileFactory()
        other = StudentProfileFactory()
        student.parents.add(student.user)

        api_client.force_authenticate(user=student.user)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": other.id, "amount": "100.00", "method": "office"},
            format="json",
        )
        assert resp.status_code == 403

    def test_online_topup_gateway_failure_marks_payment_failed(self, api_client):
        """A gateway checkout failure must not leave an orphan PENDING payment."""
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(user=parent)
        with patch(
            "apps.payments.gateways.global_payments.GlobalPaymentsGateway.create_checkout",
            side_effect=RuntimeError("boom"),
        ):
            resp = api_client.post(
                reverse("cafeteria-topup"),
                {"student": student.id, "amount": "100.00", "method": "online",
                 "gateway": "global_payments"},
                format="json",
            )
        assert resp.status_code == 502, resp.data
        payment = Payment.objects.get(related_topup__student=student)
        assert payment.status == Payment.Status.FAILED
        assert not Payment.objects.filter(status=Payment.Status.PENDING).exists()
        topup = payment.related_topup
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.FAILED


def _make_online_topup(parent, student, amount="200.00"):
    topup = TopUpRequest.objects.create(
        student=student, amount=Decimal(amount), method=TopUpRequest.Method.ONLINE,
    )
    payment = Payment.objects.create(
        user=parent, payment_type=Payment.Type.CAFETERIA, amount=Decimal(amount),
        gateway=Payment.Gateway.GLOBAL_PAYMENTS, related_topup=topup,
        status=Payment.Status.PENDING,
    )
    return topup, payment


class TestTopUpWebhookCredit:
    def test_success_webhook_credits_local_ledger_and_notifies(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup, payment = _make_online_topup(parent, student)

        resp = _post_webhook(
            api_client,
            {"order_id": payment.id, "status": "CAPTURED", "id": "gp-tx-1"},
        )
        assert resp.status_code == 200, resp.data

        payment.refresh_from_db()
        topup.refresh_from_db()
        assert payment.status == Payment.Status.SUCCESS
        assert topup.status == TopUpRequest.Status.COMPLETED

        topups = CafeteriaTransaction.objects.filter(
            student=student, transaction_type=CafeteriaTransaction.TxType.TOPUP)
        assert topups.count() == 1
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("200.00")

        notes = Notification.objects.filter(
            user=parent, notif_type=Notification.NotifType.PAYMENT)
        assert notes.count() == 1

    def test_replayed_success_webhook_is_noop(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup, payment = _make_online_topup(parent, student)

        payload = {"order_id": payment.id, "status": "CAPTURED", "id": "gp-tx-1"}
        assert _post_webhook(api_client, payload).status_code == 200
        replay = _post_webhook(api_client, payload)
        assert replay.status_code == 200
        assert replay.data["detail"] == "already_processed"

        # Still exactly one credit and one notification.
        assert CafeteriaTransaction.objects.filter(
            student=student,
            transaction_type=CafeteriaTransaction.TxType.TOPUP).count() == 1
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("200.00")
        assert Notification.objects.filter(user=parent).count() == 1

    def test_failed_webhook_credits_nothing(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup, payment = _make_online_topup(parent, student)

        resp = _post_webhook(
            api_client,
            {"order_id": payment.id, "status": "DECLINED", "id": "gp-tx-2"},
        )
        assert resp.status_code == 200

        payment.refresh_from_db()
        topup.refresh_from_db()
        assert payment.status == Payment.Status.FAILED
        assert topup.status == TopUpRequest.Status.FAILED
        assert not CafeteriaTransaction.objects.filter(student=student).exists()

    def test_credit_is_skipped_if_topup_already_finalised(self):
        # Defence in depth: if an admin already applied this top-up manually
        # (status flipped away from PENDING) before the webhook arrives, the
        # webhook credit must be a no-op — the reference guard alone only catches
        # a replay of the same payment, not a separate manual credit.
        from apps.cafeteria.services import complete_online_topup

        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup, payment = _make_online_topup(parent, student)
        topup.status = TopUpRequest.Status.COMPLETED
        topup.save(update_fields=["status"])
        payment.status = Payment.Status.SUCCESS
        payment.save(update_fields=["status"])

        assert complete_online_topup(payment) is None
        assert not CafeteriaTransaction.objects.filter(student=student).exists()
        assert not CafeteriaBalance.objects.filter(student=student).exists()
        assert CafeteriaBalance.objects.filter(
            student=student, balance__gt=0).count() == 0


class TestSandboxComplete:
    """The DEV-only mock-checkout completion reuses the webhook path (no signature),
    so a sandbox 'success' credits the ledger exactly like production does."""

    def test_sandbox_success_completes_and_credits(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup, payment = _make_online_topup(parent, student)

        resp = api_client.post(
            reverse("payment-sandbox-complete"),
            {"order_id": payment.id, "result": "success"}, format="json")
        assert resp.status_code == 200, resp.data

        payment.refresh_from_db()
        assert payment.status == Payment.Status.SUCCESS
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("200.00")
        assert Notification.objects.filter(
            user=parent, notif_type=Notification.NotifType.PAYMENT).count() == 1

    def test_sandbox_failed_credits_nothing(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup, payment = _make_online_topup(parent, student)

        resp = api_client.post(
            reverse("payment-sandbox-complete"),
            {"order_id": payment.id, "result": "failed"}, format="json")
        assert resp.status_code == 200
        payment.refresh_from_db()
        assert payment.status == Payment.Status.FAILED
        assert not CafeteriaTransaction.objects.filter(student=student).exists()

    def test_sandbox_disabled_returns_404(self, api_client, monkeypatch):
        """In production (no DEBUG/SQLITE_LOCAL) the endpoint must not exist."""
        monkeypatch.setattr("apps.payments.views._sandbox_payments_enabled", lambda: False)
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        _, payment = _make_online_topup(parent, student)
        resp = api_client.post(
            reverse("payment-sandbox-complete"),
            {"order_id": payment.id, "result": "success"}, format="json")
        assert resp.status_code == 404
        payment.refresh_from_db()
        assert payment.status == Payment.Status.PENDING
