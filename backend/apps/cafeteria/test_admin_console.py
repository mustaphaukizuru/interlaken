"""
Cafeteria admin console (Phase D): deposits log, audited manual adjustments,
refunds, reconciliation, low-balance report and CSV/PDF exports.

Every endpoint is admin-only; every balance mutation is audited via
``BalanceAdjustment`` and notifies the guardians. No Loyverse HTTP call is made —
``reconcile`` patches the customer fetch.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria import services
from apps.cafeteria.models import (
    BalanceAdjustment,
    CafeteriaBalance,
    CafeteriaTransaction,
    TopUpRequest,
)
from apps.payments.models import Payment
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


def _balance(student, amount, threshold=Decimal("50")):
    return CafeteriaBalance.objects.create(
        student=student, balance=Decimal(str(amount)), low_balance_threshold=threshold)


class TestAdjustBalance:
    def test_credit_is_audited_notifies_and_changes_balance(self, api_client, mailoutbox):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="", parents=[parent])
        _balance(student, 100)

        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(
            reverse("admin-adjust", args=[student.id]),
            {"amount": "50.00", "reason": "Cortesía dirección"}, format="json")
        assert resp.status_code == 201, resp.data

        cb = CafeteriaBalance.objects.get(student=student)
        assert cb.balance == Decimal("150.00")

        adj = BalanceAdjustment.objects.get(student=student)
        assert adj.amount == Decimal("50.00")
        assert adj.kind == BalanceAdjustment.Kind.ADJUSTMENT
        assert adj.balance_after == Decimal("150.00")
        assert adj.transaction is not None

        tx = CafeteriaTransaction.objects.get(pk=adj.transaction_id)
        assert tx.transaction_type == CafeteriaTransaction.TxType.ADJUSTMENT
        assert tx.balance_after == Decimal("150.00")

        # Parent notified (in-app + email).
        note = Notification.objects.get(user=parent)
        assert note.notif_type == Notification.NotifType.CAFETERIA
        assert len(mailoutbox) == 1

    def test_debit_reduces_balance(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _balance(student, 100)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(
            reverse("admin-adjust", args=[student.id]),
            {"amount": "-30", "reason": "Corrección"}, format="json")
        assert resp.status_code == 201
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("70.00")

    def test_multiple_adjustments_do_not_collide(self):
        # Regression: the adjustment tx left loyverse_receipt_id='' which is
        # unique=True, so a SECOND adjustment (any student) used to raise
        # IntegrityError. Two adjustments across two students must both succeed
        # and get distinct references.
        s1 = StudentProfileFactory(loyverse_id="")
        s2 = StudentProfileFactory(loyverse_id="")
        _balance(s1, 100)
        _balance(s2, 100)
        admin = AdminFactory()

        services.adjust_balance(s1, Decimal("10"), "uno", admin=admin)
        services.adjust_balance(s2, Decimal("20"), "dos", admin=admin)
        # And a second adjustment on the SAME student.
        services.adjust_balance(s1, Decimal("5"), "tres", admin=admin)

        refs = list(CafeteriaTransaction.objects
                    .filter(transaction_type=CafeteriaTransaction.TxType.ADJUSTMENT)
                    .values_list("loyverse_receipt_id", flat=True))
        assert len(refs) == 3
        assert len(set(refs)) == 3            # all distinct
        assert all(r.startswith("adjust-tx-") for r in refs)

    def test_debit_below_zero_is_rejected(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _balance(student, 20)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(
            reverse("admin-adjust", args=[student.id]),
            {"amount": "-50", "reason": "x"}, format="json")
        assert resp.status_code == 400
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("20")

    def test_zero_amount_is_rejected(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _balance(student, 20)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(
            reverse("admin-adjust", args=[student.id]),
            {"amount": "0", "reason": "x"}, format="json")
        assert resp.status_code == 400

    def test_adjust_is_admin_only(self, api_client):
        student = StudentProfileFactory()
        api_client.force_authenticate(user=ParentFactory())
        resp = api_client.post(
            reverse("admin-adjust", args=[student.id]),
            {"amount": "50", "reason": "x"}, format="json")
        assert resp.status_code == 403


class TestRefund:
    def test_refund_topup_debits_and_marks_payment_refunded(self, api_client, mailoutbox):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="", parents=[parent])
        _balance(student, 200)
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal("100"),
            method=TopUpRequest.Method.ONLINE, status=TopUpRequest.Status.COMPLETED)
        payment = Payment.objects.create(
            user=parent, payment_type=Payment.Type.CAFETERIA, amount=Decimal("100"),
            related_topup=topup, status=Payment.Status.SUCCESS)
        # The ledger row a completed online top-up leaves behind.
        tx = CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.TOPUP,
            amount=Decimal("100"), loyverse_receipt_id=f"topup-payment-{payment.id}",
            balance_after=Decimal("200"))

        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(
            reverse("admin-refund", args=[tx.id]), {"reason": "Duplicado"}, format="json")
        assert resp.status_code == 201, resp.data

        # Top-up reversal debits the balance back down.
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("100.00")
        payment.refresh_from_db()
        assert payment.status == Payment.Status.REFUNDED

        refund_tx = CafeteriaTransaction.objects.get(loyverse_receipt_id=f"refund-tx-{tx.id}")
        assert refund_tx.transaction_type == CafeteriaTransaction.TxType.REFUND
        assert refund_tx.balance_after == Decimal("100.00")

        adj = BalanceAdjustment.objects.get(kind=BalanceAdjustment.Kind.REFUND)
        assert adj.source_transaction_id == tx.id
        assert adj.amount == Decimal("-100.00")
        assert Notification.objects.filter(user=parent).exists()

    def test_refund_purchase_credits_balance(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _balance(student, 70)
        tx = CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal("30"), loyverse_receipt_id="R-1", balance_after=Decimal("70"))

        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(reverse("admin-refund", args=[tx.id]), {}, format="json")
        assert resp.status_code == 201, resp.data
        # Refunding a purchase credits the money back.
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("100.00")

    def test_double_refund_is_rejected(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _balance(student, 200)
        tx = CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.TOPUP,
            amount=Decimal("100"), loyverse_receipt_id="t-1", balance_after=Decimal("200"))
        api_client.force_authenticate(user=AdminFactory())
        first = api_client.post(reverse("admin-refund", args=[tx.id]), {}, format="json")
        assert first.status_code == 201
        second = api_client.post(reverse("admin-refund", args=[tx.id]), {}, format="json")
        assert second.status_code == 400

    def test_cannot_refund_an_adjustment(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _balance(student, 100)
        tx = CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.ADJUSTMENT,
            amount=Decimal("10"), balance_after=Decimal("100"))
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(reverse("admin-refund", args=[tx.id]), {}, format="json")
        assert resp.status_code == 400

    def test_refund_is_admin_only(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _balance(student, 100)
        tx = CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.TOPUP,
            amount=Decimal("50"), loyverse_receipt_id="t-x", balance_after=Decimal("100"))
        api_client.force_authenticate(user=ParentFactory())
        resp = api_client.post(reverse("admin-refund", args=[tx.id]), {}, format="json")
        assert resp.status_code == 403


class TestTopUpLog:
    def test_log_lists_topups_with_payment_info(self, api_client):
        student = StudentProfileFactory()
        online = TopUpRequest.objects.create(
            student=student, amount=Decimal("100"), method=TopUpRequest.Method.ONLINE)
        Payment.objects.create(
            user=None, payment_type=Payment.Type.CAFETERIA, amount=Decimal("100"),
            related_topup=online, gateway=Payment.Gateway.BANORTE,
            status=Payment.Status.SUCCESS, gateway_tx_id="gp-1")
        TopUpRequest.objects.create(
            student=student, amount=Decimal("50"), method=TopUpRequest.Method.OFFICE)

        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-topups"))
        assert resp.status_code == 200
        results = resp.data["results"]
        assert len(results) == 2
        online_row = next(r for r in results if r["method"] == "online")
        assert online_row["gateway"] == "banorte"
        assert online_row["payment_status"] == "success"
        assert online_row["student_name"] == student.user.full_name

    def test_log_status_filter(self, api_client):
        student = StudentProfileFactory()
        TopUpRequest.objects.create(
            student=student, amount=Decimal("10"), status=TopUpRequest.Status.COMPLETED)
        TopUpRequest.objects.create(
            student=student, amount=Decimal("20"), status=TopUpRequest.Status.PENDING)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-topups"), {"status": "completed"})
        assert resp.status_code == 200
        assert len(resp.data["results"]) == 1

    def test_log_is_admin_only(self, api_client):
        api_client.force_authenticate(user=ParentFactory())
        assert api_client.get(reverse("admin-topups")).status_code == 403


class TestReconcile:
    @patch("apps.cafeteria.services.get_customer_by_id")
    def test_reconcile_flags_drift(self, mock_get, api_client):
        in_sync = StudentProfileFactory(loyverse_id="loy-ok")
        drifted = StudentProfileFactory(loyverse_id="loy-drift")
        _balance(in_sync, 100)
        _balance(drifted, 80)

        def _side(loyverse_id):
            return {"total_points": 100 if loyverse_id == "loy-ok" else 65}

        mock_get.side_effect = _side
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-reconcile"))
        assert resp.status_code == 200
        assert resp.data["count"] == 2
        assert resp.data["drift_count"] == 1

        drift_row = next(r for r in resp.data["results"] if r["loyverse_id"] == "loy-drift")
        assert drift_row["in_sync"] is False
        assert drift_row["drift"] == "15.00"  # 80 local − 65 remote

    @patch("apps.cafeteria.services.get_customer_by_id")
    def test_reconcile_only_drift_filter(self, mock_get, api_client):
        s1 = StudentProfileFactory(loyverse_id="loy-1")
        s2 = StudentProfileFactory(loyverse_id="loy-2")
        _balance(s1, 100)
        _balance(s2, 40)
        mock_get.side_effect = lambda i: {"total_points": 100 if i == "loy-1" else 10}
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-reconcile"), {"only": "drift"})
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["loyverse_id"] == "loy-2"

    def test_reconcile_is_admin_only(self, api_client):
        api_client.force_authenticate(user=ParentFactory())
        assert api_client.get(reverse("admin-reconcile")).status_code == 403


class TestLowBalanceReport:
    def test_lists_only_students_at_or_below_threshold(self, api_client):
        low = StudentProfileFactory()
        ok = StudentProfileFactory()
        _balance(low, 20, threshold=Decimal("50"))
        _balance(ok, 200, threshold=Decimal("50"))
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-low-balance"))
        assert resp.status_code == 200
        ids = {row["student"]["id"] for row in resp.data}
        assert low.id in ids and ok.id not in ids

    def test_low_balance_is_admin_only(self, api_client):
        api_client.force_authenticate(user=ParentFactory())
        assert api_client.get(reverse("admin-low-balance")).status_code == 403


class TestStudentDetail:
    def test_detail_returns_balance_parents_and_history(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="", parents=[parent])
        _balance(student, 100)
        services.adjust_balance(student, Decimal("25"), "test", admin=AdminFactory())

        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-student-detail", args=[student.id]))
        assert resp.status_code == 200
        assert resp.data["balance"]["balance"] == "125.00"
        assert resp.data["parents"][0]["email"] == parent.email
        assert len(resp.data["transactions"]) == 1
        assert len(resp.data["adjustments"]) == 1

    def test_detail_is_admin_only(self, api_client):
        student = StudentProfileFactory()
        api_client.force_authenticate(user=ParentFactory())
        assert api_client.get(
            reverse("admin-student-detail", args=[student.id])).status_code == 403


class TestExports:
    def test_student_csv_download(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _balance(student, 100)
        services.adjust_balance(student, Decimal("10"), "abono", admin=AdminFactory())
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-export-student", args=[student.id]))
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("text/csv")
        assert "attachment" in resp["Content-Disposition"]
        body = resp.content.decode("utf-8")
        assert student.student_id in body
        assert "Ajuste" in body

    def test_student_pdf_download(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _balance(student, 100)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(
            reverse("admin-export-student", args=[student.id]), {"fmt": "pdf"})
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/pdf"
        assert resp.content.startswith(b"%PDF-1.4")

    def test_school_csv_download(self, api_client):
        s1 = StudentProfileFactory()
        _balance(s1, 100)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-export-school"))
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("text/csv")
        assert s1.student_id in resp.content.decode("utf-8")

    def test_export_is_admin_only(self, api_client):
        student = StudentProfileFactory()
        api_client.force_authenticate(user=ParentFactory())
        assert api_client.get(
            reverse("admin-export-student", args=[student.id])).status_code == 403
        assert api_client.get(reverse("admin-export-school")).status_code == 403


class TestParentExport:
    """GET /api/v1/cafeteria/export/ — family CSV for authenticated parents."""

    def test_parent_export_csv_includes_children_transactions(self, api_client):
        parent = ParentFactory()
        child = StudentProfileFactory(parents=[parent])
        other = StudentProfileFactory()  # not linked — must not appear
        _balance(child, 100)
        _balance(other, 50)
        CafeteriaTransaction.objects.create(
            student=child,
            transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal("25.00"),
            description="Jugo",
            loyverse_receipt_id="R-parent-export-1",
            balance_after=Decimal("75.00"),
        )
        CafeteriaTransaction.objects.create(
            student=other,
            transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal("10.00"),
            description="secreto",
            loyverse_receipt_id="R-parent-export-other",
            balance_after=Decimal("40.00"),
        )

        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("cafeteria-export"))
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("text/csv")
        assert "attachment" in resp["Content-Disposition"]
        body = resp.content.decode("utf-8")
        assert child.student_id in body
        assert "Jugo" in body
        assert other.student_id not in body
        assert "secreto" not in body

    def test_parent_export_rejects_anonymous(self, api_client):
        assert api_client.get(reverse("cafeteria-export")).status_code == 401
