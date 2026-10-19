"""
Settlement idempotency + refunds, and the fail-closed initiate endpoint.

``payments.settlement`` is the only code that moves money for a gateway result:
a final payment never moves money again (replay protection), a soft failure
still accepts a late success, and a refund of a successful top-up reverses the
cafeteria credit.
"""

from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.payments.factories import PaymentFactory
from apps.payments.gateways.base import PaymentEvent
from apps.payments.models import Payment
from apps.payments.settlement import settle

pytestmark = pytest.mark.django_db


def _event(payment_id, status, tx=None, **kw):
    return PaymentEvent(
        payment_id=payment_id, status=status, transaction_id=tx, raw={"test": status}, **kw
    )


def _topup_payment(amount="200.00"):
    parent = ParentFactory()
    student = StudentProfileFactory(parents=[parent])
    topup = TopUpRequest.objects.create(
        student=student, amount=Decimal(amount), method=TopUpRequest.Method.ONLINE
    )
    payment = Payment.objects.create(
        user=parent,
        payment_type=Payment.Type.CAFETERIA,
        amount=Decimal(amount),
        gateway=Payment.Gateway.BANORTE,
        related_topup=topup,
        status=Payment.Status.PENDING,
    )
    return student, topup, payment


# Credit-on-payment mode (CAFETERIA_TOPUP_APPLY_MODE=instant); the default
# scheduled mode is covered in apps/cafeteria/test_topup_scheduled_apply.py.
@pytest.mark.usefixtures("instant_topups")
class TestIdempotency:
    def test_success_marks_payment_and_stores_reference(self):
        payment = PaymentFactory()
        status, body = settle(
            _event(payment.id, "success", "IK1ABC", reference="123456789012"), actor_label="test"
        )
        assert status == 200, body
        payment.refresh_from_db()
        assert payment.status == Payment.Status.SUCCESS
        assert payment.gateway_tx_id == "IK1ABC"
        assert payment.gateway_ref == "123456789012"

    def test_replay_on_finalized_payment_is_noop(self):
        payment = PaymentFactory(status=Payment.Status.SUCCESS, gateway_tx_id="original-tx")
        status, body = settle(_event(payment.id, "failed", "replay-tx"), actor_label="test")
        assert status == 200
        assert body["detail"] == "already_processed"
        payment.refresh_from_db()
        assert payment.status == Payment.Status.SUCCESS
        assert payment.gateway_tx_id == "original-tx"

    def test_unknown_payment_is_404(self):
        status, _ = settle(_event(999999, "success"), actor_label="test")
        assert status == 404

    def test_soft_failure_accepts_late_success(self):
        student, _, payment = _topup_payment()
        settle(_event(payment.id, "failed", stage="cancel"), actor_label="test")
        payment.refresh_from_db()
        assert payment.status == Payment.Status.FAILED and payment.is_soft_failed()

        settle(_event(payment.id, "success", "IK-late"), actor_label="test")
        payment.refresh_from_db()
        assert payment.status == Payment.Status.SUCCESS
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("200.00")

    def test_bank_decline_is_final(self):
        student, _, payment = _topup_payment()
        settle(_event(payment.id, "failed", "IK-dec"), actor_label="test")
        status, body = settle(_event(payment.id, "success", "IK-dec"), actor_label="test")
        assert body["detail"] == "already_processed"
        payment.refresh_from_db()
        assert payment.status == Payment.Status.FAILED
        assert not CafeteriaBalance.objects.filter(student=student, balance__gt=0).exists()


# Credit-on-payment mode (CAFETERIA_TOPUP_APPLY_MODE=instant); the default
# scheduled mode is covered in apps/cafeteria/test_topup_scheduled_apply.py.
@pytest.mark.usefixtures("instant_topups")
class TestRefund:
    def test_refund_reverses_cafeteria_topup(self):
        student, topup, payment = _topup_payment()
        settle(_event(payment.id, "success", "IK-1"), actor_label="test")
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("200.00")

        status, body = settle(_event(payment.id, "refunded", "IK-1"), actor_label="test")
        assert status == 200
        assert body["detail"] == "refunded"
        payment.refresh_from_db()
        assert payment.status == Payment.Status.REFUNDED
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("0.00")
        assert CafeteriaTransaction.objects.filter(
            student=student, transaction_type=CafeteriaTransaction.TxType.REFUND
        ).exists()

        _, again = settle(_event(payment.id, "refunded", "IK-1"), actor_label="test")
        assert again["detail"] == "already_processed"
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("0.00")
        topup.refresh_from_db()
        assert topup.pos_unload_needed_at is None  # never loaded into the POS

    def test_refund_after_pos_load_queues_unload(self):
        student, topup, payment = _topup_payment("150.00")
        settle(_event(payment.id, "success", "IK-pos"), actor_label="test")
        topup.refresh_from_db()
        topup.pos_loaded_at = timezone.now()
        topup.save(update_fields=["pos_loaded_at"])

        _, body = settle(_event(payment.id, "refunded", "IK-pos"), actor_label="test")
        assert body["detail"] == "refunded"
        topup.refresh_from_db()
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("0.00")
        assert topup.pos_unload_needed_at is not None
        assert topup.pos_unloaded_at is None


class TestPaymentInitiate:
    def test_requires_authentication(self, api_client):
        resp = api_client.post(
            reverse("payment-initiate"),
            {"amount": "500.00", "payment_type": "other"},
            format="json",
        )
        assert resp.status_code == 401

    @pytest.mark.parametrize("payment_type", ["cafeteria", "other"])
    def test_rejects_unlinked_money_types(self, api_client, payment_type):
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
        PaymentFactory(user=ParentFactory())
        api_client.force_authenticate(user=mine)
        resp = api_client.get(reverse("payment-history"))
        assert resp.status_code == 200
        rows = resp.data.get("results", resp.data)
        assert len(rows) == 1
