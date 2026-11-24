"""QA sweep 2026-11-24: a manual adjustment or refund can never push a wallet
past what ``DecimalField(10, 2)`` stores (the request used to answer 500)."""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.cafeteria import services
from apps.cafeteria.models import BalanceAdjustment, CafeteriaBalance, CafeteriaTransaction

pytestmark = pytest.mark.django_db


def _wallet(student, amount):
    return CafeteriaBalance.objects.create(student=student, balance=Decimal(amount))


def _adjust(api_client, student, amount):
    api_client.force_authenticate(user=AdminFactory())
    return api_client.post(reverse("admin-adjust", args=[student.id]),
                           {"amount": amount, "reason": "QA"}, format="json")


class TestAdjustmentAmountBounds:
    def test_huge_amount_is_a_400_not_a_500(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _wallet(student, "10")
        resp = _adjust(api_client, student, "99999999.99")
        assert resp.status_code == 400
        assert "amount" in resp.data
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("10")
        assert not BalanceAdjustment.objects.exists()

    def test_huge_negative_amount_is_refused_too(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _wallet(student, "10")
        resp = _adjust(api_client, student, "-100000.01")
        assert resp.status_code == 400
        assert "amount" in resp.data

    def test_real_sized_corrections_still_work(self, api_client):
        # Staff really made +8,740 corrections; the cap is far above that.
        student = StudentProfileFactory(loyverse_id="")
        _wallet(student, "10")
        resp = _adjust(api_client, student, "8740.00")
        assert resp.status_code == 201, resp.data
        resp = _adjust(api_client, student, "100000.00")
        assert resp.status_code == 201, resp.data
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("108750.00")

    def test_result_above_the_column_ceiling_is_a_clean_400(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _wallet(student, "99999990.00")
        resp = _adjust(api_client, student, "50.00")
        assert resp.status_code == 400
        assert "saldo máximo" in str(resp.data)
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("99999990.00")
        assert not CafeteriaTransaction.objects.filter(student=student).exists()

    def test_service_refuses_overflow_directly(self):
        student = StudentProfileFactory(loyverse_id="")
        _wallet(student, "99999999.00")
        with pytest.raises(ValueError, match="saldo máximo"):
            services.adjust_balance(student, Decimal("5"), "x", notify=False)


class TestRefundCeiling:
    def test_refund_that_would_overflow_is_a_400(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _wallet(student, "99999990.00")
        tx = CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal("50.00"), loyverse_receipt_id="qa-purchase-1")
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(reverse("admin-refund", args=[tx.id]),
                               {"reason": "QA"}, format="json")
        assert resp.status_code == 400
        assert "saldo máximo" in str(resp.data)
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("99999990.00")


class TestBulkTopUpCeiling:
    def test_overflowing_student_is_reported_as_failed(self, api_client):
        full = StudentProfileFactory(loyverse_id="", grade="QA1")
        ok = StudentProfileFactory(loyverse_id="", grade="QA1")
        _wallet(full, "99999999.00")
        _wallet(ok, "0")
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(reverse("admin-bulk-topup"),
                               {"amount": "10", "reason": "QA", "grade": "QA1",
                                "batch_id": "qa-batch-0001"}, format="json")
        assert resp.status_code == 201, resp.data
        assert resp.data["credited"] == 1
        assert [f["id"] for f in resp.data["failed"]] == [full.pk]
        assert CafeteriaBalance.objects.get(student=ok).balance == Decimal("10.00")


class TestMovimientosSignedAmounts:
    """QA sweep 2026-11-24 (round 2): the school-wide Movimientos list carries
    ``adjustment_amount``, so a deduction reads apart from a credit."""

    def test_adjustments_carry_their_sign(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        _wallet(student, "100")
        services.adjust_balance(student, Decimal("-12.50"), "Cobro duplicado", notify=False)
        services.adjust_balance(student, Decimal("20.00"), "Cortesía", notify=False)
        api_client.force_authenticate(user=AdminFactory())
        rows = api_client.get(reverse("admin-transactions")).data["results"]
        by_reason = {r["description"]: r for r in rows}
        assert by_reason["Ajuste manual: Cobro duplicado"]["amount"] == "12.50"
        assert by_reason["Ajuste manual: Cobro duplicado"]["adjustment_amount"] == "-12.50"
        assert by_reason["Ajuste manual: Cortesía"]["adjustment_amount"] == "20.00"
