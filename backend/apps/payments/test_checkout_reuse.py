"""Concurrent checkout reuse + stale expiry."""
from datetime import timedelta
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.payments.models import Payment
from apps.payments.services import expire_stale_checkouts, fail_checkout_if_still_open

pytestmark = pytest.mark.django_db


class TestCafeteriaCheckoutReuse:
    def test_second_online_topup_reuses_payment(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(user=parent)
        url = reverse("cafeteria-topup")
        payload = {
            "student": student.id, "amount": "200.00", "method": "online",
            "gateway": "global_payments",
        }
        first = api_client.post(url, payload, format="json")
        assert first.status_code == 201, first.data
        second = api_client.post(url, payload, format="json")
        assert second.status_code == 201, second.data
        assert first.data["payment_id"] == second.data["payment_id"]
        assert Payment.objects.filter(
            related_topup__student=student, status=Payment.Status.PENDING,
        ).count() == 1
        assert TopUpRequest.objects.filter(
            student=student, status=TopUpRequest.Status.PENDING,
        ).count() == 1

    def test_different_amount_supersedes_prior_checkout(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(user=parent)
        url = reverse("cafeteria-topup")
        first = api_client.post(
            url,
            {"student": student.id, "amount": "100.00", "method": "online",
             "gateway": "global_payments"},
            format="json",
        )
        assert first.status_code == 201, first.data
        second = api_client.post(
            url,
            {"student": student.id, "amount": "250.00", "method": "online",
             "gateway": "global_payments"},
            format="json",
        )
        assert second.status_code == 201, second.data
        assert first.data["payment_id"] != second.data["payment_id"]
        old = Payment.objects.get(pk=first.data["payment_id"])
        assert old.status == Payment.Status.FAILED
        old.related_topup.refresh_from_db()
        assert old.related_topup.status == TopUpRequest.Status.FAILED


class TestExpireStalePayments:
    def test_expire_fails_old_pending(self):
        parent = ParentFactory()
        payment = Payment.objects.create(
            user=parent,
            payment_type=Payment.Type.TUITION,
            amount=Decimal("100.00"),
            status=Payment.Status.PENDING,
        )
        Payment.objects.filter(pk=payment.pk).update(
            created_at=timezone.now() - timedelta(minutes=90))
        n = expire_stale_checkouts(older_than_minutes=45)
        assert n == 1
        payment.refresh_from_db()
        assert payment.status == Payment.Status.FAILED

    def test_expire_command_dry_run_does_not_mutate(self):
        parent = ParentFactory()
        payment = Payment.objects.create(
            user=parent,
            payment_type=Payment.Type.CAFETERIA,
            amount=Decimal("50.00"),
            status=Payment.Status.PENDING,
        )
        Payment.objects.filter(pk=payment.pk).update(
            created_at=timezone.now() - timedelta(minutes=90))
        out = StringIO()
        call_command("expire_stale_payments", dry_run=True, stdout=out)
        payment.refresh_from_db()
        assert payment.status == Payment.Status.PENDING
        assert "DRY RUN" in out.getvalue()


class TestFinalizedPaymentNeverClobbered:
    """A checkout snapshotted as stale must NOT be failed if it finalized since.

    The expire/supersede sweeps take an unlocked snapshot of open PENDING
    checkouts, then mark them FAILED. A SUCCESS webhook can commit between the
    snapshot and that write; without a locked re-check the sweep overwrites
    SUCCESS with FAILED while the ledger keeps the credit — the books disagree
    until the gateway happens to replay the webhook. ``fail_checkout_if_still_open``
    is the per-row locked guard; calling it against an already-finalized payment
    is the deterministic equivalent of that interleaving.
    """

    def _staged_topup(self, minutes_old=90, amount="150.00"):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal(amount),
            method=TopUpRequest.Method.ONLINE,
        )
        payment = Payment.objects.create(
            user=parent, payment_type=Payment.Type.CAFETERIA,
            amount=Decimal(amount), related_topup=topup,
            status=Payment.Status.PENDING,
        )
        Payment.objects.filter(pk=payment.pk).update(
            created_at=timezone.now() - timedelta(minutes=minutes_old))
        return student, topup, payment

    def test_guard_expires_a_still_open_checkout(self):
        _, topup, payment = self._staged_topup()
        assert fail_checkout_if_still_open(
            payment.pk, reason="checkout expired", stage="expire") is True
        payment.refresh_from_db()
        topup.refresh_from_db()
        assert payment.status == Payment.Status.FAILED
        assert payment.is_soft_failed()
        assert topup.status == TopUpRequest.Status.FAILED

    def test_guard_skips_checkout_captured_after_snapshot(self):
        """Webhook captured + credited between the sweep's snapshot and its write."""
        from apps.cafeteria.services import complete_online_topup

        student, topup, payment = self._staged_topup()
        payment.mark_success("GP-RACE-1", {"status": "CAPTURED"})
        complete_online_topup(payment)

        assert fail_checkout_if_still_open(
            payment.pk, reason="checkout expired", stage="expire") is False

        payment.refresh_from_db()
        topup.refresh_from_db()
        assert payment.status == Payment.Status.SUCCESS
        assert topup.status == TopUpRequest.Status.COMPLETED
        cb = CafeteriaBalance.objects.get(student=student)
        assert cb.balance == Decimal("150.00")
        txs = list(CafeteriaTransaction.objects.filter(student=student))
        assert len(txs) == 1
        assert txs[0].transaction_type == CafeteriaTransaction.TxType.TOPUP
        assert txs[0].balance_after == cb.balance

    def test_guard_skips_pending_that_advanced_past_checkout(self):
        """A non-terminal gateway notification stamped a tx id — not ours to expire."""
        _, topup, payment = self._staged_topup()
        payment.gateway_tx_id = "GP-PROCESSING-1"
        payment.save(update_fields=["gateway_tx_id"])

        assert fail_checkout_if_still_open(
            payment.pk, reason="checkout expired", stage="expire") is False
        payment.refresh_from_db()
        topup.refresh_from_db()
        assert payment.status == Payment.Status.PENDING
        assert topup.status == TopUpRequest.Status.PENDING

    def test_guard_missing_payment_is_noop(self):
        assert fail_checkout_if_still_open(
            999999, reason="checkout expired", stage="expire") is False

    def test_expire_sweep_leaves_captured_payment_untouched(self):
        """End-to-end: capture + credit, then the sweep — nothing may move."""
        from apps.cafeteria.services import complete_online_topup

        student, topup, payment = self._staged_topup()
        payment.mark_success("GP-RACE-2", {"status": "CAPTURED"})
        complete_online_topup(payment)

        assert expire_stale_checkouts(older_than_minutes=45) == 0
        payment.refresh_from_db()
        topup.refresh_from_db()
        assert payment.status == Payment.Status.SUCCESS
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("150.00")


class TestLateSuccessAfterSoftFail:
    """Parents who finish an HPP after expire/supersede must still be credited."""

    def test_expire_cascades_topup_then_late_success_credits(self, api_client, settings):
        import hashlib
        import hmac
        import json

        from apps.cafeteria.models import CafeteriaBalance

        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = "test-webhook-secret"
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal("150.00"),
            method=TopUpRequest.Method.ONLINE,
        )
        payment = Payment.objects.create(
            user=parent, payment_type=Payment.Type.CAFETERIA,
            amount=Decimal("150.00"), related_topup=topup,
            status=Payment.Status.PENDING,
        )
        Payment.objects.filter(pk=payment.pk).update(
            created_at=timezone.now() - timedelta(minutes=90))
        assert expire_stale_checkouts(older_than_minutes=45) == 1
        payment.refresh_from_db()
        topup.refresh_from_db()
        assert payment.status == Payment.Status.FAILED
        assert payment.is_soft_failed()
        assert topup.status == TopUpRequest.Status.FAILED

        body = json.dumps({
            "order_id": payment.id, "status": "CAPTURED", "id": "late-tx",
        }).encode()
        sig = hmac.new(b"test-webhook-secret", body, hashlib.sha256).hexdigest()
        resp = api_client.post(
            reverse("payment-webhook"),
            data=body,
            content_type="application/json",
            HTTP_X_WEBHOOK_SIGNATURE=sig,
        )
        assert resp.status_code == 200, resp.data
        payment.refresh_from_db()
        topup.refresh_from_db()
        assert payment.status == Payment.Status.SUCCESS
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("150.00")

    def test_gateway_declined_failed_rejects_late_success(self, api_client, settings):
        """A real DECLINED webhook must not be revived by a later CAPTURED."""
        import hashlib
        import hmac
        import json

        from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = "test-webhook-secret"
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal("100.00"),
            method=TopUpRequest.Method.ONLINE,
        )
        payment = Payment.objects.create(
            user=parent, payment_type=Payment.Type.CAFETERIA,
            amount=Decimal("100.00"), related_topup=topup,
            status=Payment.Status.PENDING,
        )
        body_fail = json.dumps({
            "order_id": payment.id, "status": "DECLINED", "id": "dec-1",
        }).encode()
        sig_fail = hmac.new(
            b"test-webhook-secret", body_fail, hashlib.sha256).hexdigest()
        assert api_client.post(
            reverse("payment-webhook"), data=body_fail,
            content_type="application/json",
            HTTP_X_WEBHOOK_SIGNATURE=sig_fail,
        ).status_code == 200
        payment.refresh_from_db()
        assert payment.status == Payment.Status.FAILED
        assert not payment.is_soft_failed()

        body_ok = json.dumps({
            "order_id": payment.id, "status": "CAPTURED", "id": "cap-late",
        }).encode()
        sig_ok = hmac.new(
            b"test-webhook-secret", body_ok, hashlib.sha256).hexdigest()
        resp = api_client.post(
            reverse("payment-webhook"), data=body_ok,
            content_type="application/json",
            HTTP_X_WEBHOOK_SIGNATURE=sig_ok,
        )
        assert resp.status_code == 200
        assert resp.data["detail"] == "already_processed"
        payment.refresh_from_db()
        assert payment.status == Payment.Status.FAILED
        assert not CafeteriaTransaction.objects.filter(student=student).exists()
        assert not CafeteriaBalance.objects.filter(student=student).exists()
