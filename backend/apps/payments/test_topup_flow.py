"""
Online cafeteria top-up flow (spec §2.2):

    initiate → Banorte checkout → settled result → local-ledger credit + notify.

Per spec R1 settlement credits the **local** ``CafeteriaBalance`` only (no
Loyverse write). The flow is idempotent (a replayed result is a no-op) and a
failed payment credits nothing. Banorte specifics (encryption, lightbox,
result decryption) live in ``test_banorte.py``.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.payments.gateways.base import PaymentEvent
from apps.payments.models import Payment
from apps.payments.settlement import settle
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


def _settle(payment, status, tx="IK-test-1"):
    return settle(PaymentEvent(payment_id=payment.id, status=status, transaction_id=tx,
                               raw={"test": status}), actor_label="test")


class TestTopUpInitiation:
    def test_online_topup_creates_linked_payment_and_returns_checkout(self, api_client):
        """Without Banorte credentials (local dev/tests) the checkout is the mock page."""
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])

        api_client.force_authenticate(user=parent)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": "200.00", "method": "online",
             "gateway": "banorte"},
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["checkout"]["kind"] == "redirect"
        assert resp.data["redirect_url"] == resp.data["checkout"]["url"]
        assert "/pago/simulado" in resp.data["redirect_url"]
        assert resp.data["gateway"] == "banorte"

        topup = TopUpRequest.objects.get(pk=resp.data["id"])
        assert topup.status == TopUpRequest.Status.PENDING
        payment = Payment.objects.get(pk=resp.data["payment_id"])
        assert payment.payment_type == Payment.Type.CAFETERIA
        assert payment.status == Payment.Status.PENDING
        assert payment.related_topup_id == topup.id
        # No credit yet — settlement of the bank result does that.
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

    def test_topup_without_loyverse_id_is_rejected(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent], loyverse_id="")
        api_client.force_authenticate(user=parent)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": "100.00", "method": "online",
             "gateway": "banorte"},
            format="json",
        )
        assert resp.status_code == 400, resp.data
        assert "Loyverse" in resp.data["detail"]
        assert not TopUpRequest.objects.filter(student=student).exists()
        assert not Payment.objects.filter(user=parent, payment_type=Payment.Type.CAFETERIA).exists()

    def test_families_cannot_request_a_cash_desk_topup(self, api_client):
        """Owner, 2026-10-20: «Pago en caja escolar» is gone; cash is loaded at
        the cafeteria POS, so a family request creates nothing."""
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(user=parent)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": "100.00", "method": "office"},
            format="json",
        )
        assert resp.status_code == 400, resp.data
        assert not TopUpRequest.objects.filter(student=student).exists()

    def test_student_self_guardian_can_topup_own_balance(self, api_client):
        """Loyverse family login: role=student, linked on student.parents."""
        student = StudentProfileFactory()
        student.parents.add(student.user)

        api_client.force_authenticate(user=student.user)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": "150.00", "method": "online",
             "gateway": "banorte"},
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
            {"student": student.id, "amount": "100.00", "method": "online"},
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
            {"student": other.id, "amount": "100.00", "method": "online"},
            format="json",
        )
        assert resp.status_code == 403

    def test_online_topup_gateway_failure_marks_payment_failed(self, api_client):
        """A gateway checkout failure must not leave an orphan PENDING payment."""
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(user=parent)
        with patch(
            "apps.payments.gateways.banorte.BanorteGateway.start_checkout",
            side_effect=RuntimeError("boom"),
        ):
            resp = api_client.post(
                reverse("cafeteria-topup"),
                {"student": student.id, "amount": "100.00", "method": "online",
                 "gateway": "banorte"},
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
        gateway=Payment.Gateway.BANORTE, related_topup=topup,
        status=Payment.Status.PENDING,
    )
    return topup, payment


# Credit-on-payment mode (CAFETERIA_TOPUP_APPLY_MODE=instant); the default
# scheduled mode is covered in apps/cafeteria/test_topup_scheduled_apply.py.
@pytest.mark.usefixtures("instant_topups")
class TestTopUpSettlementCredit:
    def test_success_credits_local_ledger_and_notifies(self):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup, payment = _make_online_topup(parent, student)

        status, body = _settle(payment, "success")
        assert status == 200, body

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

    def test_replayed_success_is_noop(self):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup, payment = _make_online_topup(parent, student)

        assert _settle(payment, "success")[0] == 200
        status, body = _settle(payment, "success")
        assert status == 200
        assert body["detail"] == "already_processed"

        # Still exactly one credit and one notification.
        assert CafeteriaTransaction.objects.filter(
            student=student,
            transaction_type=CafeteriaTransaction.TxType.TOPUP).count() == 1
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("200.00")
        assert Notification.objects.filter(user=parent).count() == 1

    def test_failed_credits_nothing(self):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup, payment = _make_online_topup(parent, student)

        assert _settle(payment, "failed", tx="IK-test-2")[0] == 200

        payment.refresh_from_db()
        topup.refresh_from_db()
        assert payment.status == Payment.Status.FAILED
        assert topup.status == TopUpRequest.Status.FAILED
        assert not CafeteriaTransaction.objects.filter(student=student).exists()

    def test_credit_is_skipped_if_topup_already_finalised(self):
        # Defence in depth: if an admin already applied this top-up manually
        # (status flipped away from PENDING) before the gateway result arrives, the
        # settlement credit must be a no-op — the reference guard alone only catches
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


# Credit-on-payment mode (CAFETERIA_TOPUP_APPLY_MODE=instant); the default
# scheduled mode is covered in apps/cafeteria/test_topup_scheduled_apply.py.
@pytest.mark.usefixtures("instant_topups")
class TestSandboxComplete:
    """The DEV-only mock-checkout completion reuses the settlement path, so a
    sandbox 'success' credits the ledger exactly like production does."""

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


class TestTopUpLimits:
    """Parent UI copy: mínimo $20 · máximo $2,000."""

    @pytest.mark.parametrize("amount, ok", [("20.00", True), ("19.99", False), ("2000.00", True), ("2000.01", False)])
    def test_amount_limits(self, api_client, amount, ok):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(user=parent)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": amount, "method": "online"},
            format="json",
        )
        assert (resp.status_code == 201) is ok, resp.data
