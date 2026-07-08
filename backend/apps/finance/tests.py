"""
finance — tuition billing tests (Prompt 17 acceptance).

Covers the acceptance checks:
- ``generate_invoices`` creates one invoice per active student and re-running is a
  no-op (idempotent per student+period), applying discounts/becas.
- an overdue invoice gets a one-time late fee (idempotent) and flips to *overdue*.
- a parent pays via the sandbox gateway and the invoice flips to *paid* on the
  **signed** webhook (and a replayed webhook is a no-op).
- admin dashboard reports outstanding vs collected.
"""
import hashlib
import hmac
import json
from datetime import timedelta
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.finance import services
from apps.finance.models import (Discount, FeeSchedule, Invoice,
                                 InvoiceLineItem, InvoicePayment)
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

SECRET = "test-webhook-secret"
PERIOD = "2025-08"


def _schedule(**kw):
    defaults = dict(name="Primaria 2025", grade="", monthly_amount=Decimal("3000.00"),
                    due_day=5, late_fee_type=FeeSchedule.LateFeeType.PERCENT,
                    late_fee_amount=Decimal("10"), late_fee_grace_days=0, active=True)
    defaults.update(kw)
    return FeeSchedule.objects.create(**defaults)


def _sign(body: bytes) -> str:
    return hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


# ── generation ────────────────────────────────────────────────────────────────

class TestGeneration:
    def test_creates_one_invoice_per_active_student(self):
        _schedule()
        StudentProfileFactory()
        StudentProfileFactory()
        StudentProfileFactory(is_active=False)

        result = services.generate_invoices(PERIOD)
        assert result["created"] == 2
        assert Invoice.objects.filter(period=PERIOD).count() == 2

    def test_rerun_is_idempotent(self):
        _schedule()
        StudentProfileFactory()
        services.generate_invoices(PERIOD)
        second = services.generate_invoices(PERIOD)
        assert second["created"] == 0
        assert second["existing"] == 1
        assert Invoice.objects.filter(period=PERIOD).count() == 1

    def test_applies_percent_discount_beca(self):
        _schedule(monthly_amount=Decimal("3000.00"))
        student = StudentProfileFactory()
        Discount.objects.create(student=student, name="Beca 20%",
                                kind=Discount.Kind.SCHOLARSHIP,
                                method=Discount.Method.PERCENT, value=Decimal("20"))
        services.generate_invoices(PERIOD)
        inv = Invoice.objects.get(student=student, period=PERIOD)
        assert inv.subtotal == Decimal("3000.00")
        assert inv.discount_total == Decimal("600.00")
        assert inv.amount == Decimal("2400.00")

    def test_due_date_from_schedule_due_day(self):
        _schedule(due_day=10)
        StudentProfileFactory()
        services.generate_invoices(PERIOD)
        inv = Invoice.objects.get(period=PERIOD)
        assert inv.due_date.day == 10

    def test_student_without_schedule_is_skipped(self):
        _schedule(grade="6° Secundaria")  # no default, non-matching grade
        StudentProfileFactory(grade="3° Primaria")
        result = services.generate_invoices(PERIOD)
        assert result["created"] == 0
        assert result["skipped"] == 1


# ── late fees ─────────────────────────────────────────────────────────────────

class TestLateFees:
    def _overdue_invoice(self, pct="10"):
        _schedule(late_fee_type=FeeSchedule.LateFeeType.PERCENT, late_fee_amount=Decimal(pct))
        student = StudentProfileFactory()
        services.generate_invoices(PERIOD)
        inv = Invoice.objects.get(student=student, period=PERIOD)
        inv.due_date = timezone.localdate() - timedelta(days=3)
        inv.save(update_fields=["due_date"])
        return inv

    def test_late_fee_applied_and_marks_overdue(self):
        inv = self._overdue_invoice()
        services.apply_late_fees()
        inv.refresh_from_db()
        assert inv.status == Invoice.Status.OVERDUE
        assert inv.late_fee_applied is True
        assert inv.late_fee_total == Decimal("300.00")   # 10% of 3000
        assert inv.amount == Decimal("3300.00")

    def test_late_fee_is_idempotent(self):
        inv = self._overdue_invoice()
        services.apply_late_fees()
        services.apply_late_fees()
        inv.refresh_from_db()
        assert inv.line_items.filter(kind=InvoiceLineItem.Kind.LATE_FEE).count() == 1
        assert inv.amount == Decimal("3300.00")

    def test_not_yet_due_gets_no_fee(self):
        _schedule()
        StudentProfileFactory()
        services.generate_invoices(PERIOD)
        inv = Invoice.objects.get(period=PERIOD)
        inv.due_date = timezone.localdate() + timedelta(days=5)
        inv.save(update_fields=["due_date"])
        services.apply_late_fees()
        inv.refresh_from_db()
        assert inv.late_fee_applied is False
        assert inv.status == Invoice.Status.PENDING


# ── online payment via signed webhook ─────────────────────────────────────────

class TestPaymentWebhook:
    def _invoice_with_parent(self):
        _schedule()
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        services.generate_invoices(PERIOD)
        return Invoice.objects.get(student=student, period=PERIOD), parent

    def test_pay_creates_pending_payment_link(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        invoice, parent = self._invoice_with_parent()
        api_client.force_authenticate(user=parent)
        resp = api_client.post(reverse("finance-invoice-pay", args=[invoice.id]), {})
        assert resp.status_code == 201
        payment = Payment.objects.get(pk=resp.data["payment_id"])
        assert payment.status == Payment.Status.PENDING
        assert payment.payment_type == Payment.Type.TUITION
        assert InvoicePayment.objects.filter(payment=payment, invoice=invoice).exists()
        invoice.refresh_from_db()
        assert invoice.status == Invoice.Status.PENDING  # not paid until webhook

    def test_signed_webhook_flips_invoice_paid(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        invoice, parent = self._invoice_with_parent()
        payment, _ = services.start_invoice_payment(invoice, parent)

        payload = {"order_id": payment.id, "status": "CAPTURED", "id": "tx-123"}
        body = json.dumps(payload).encode()
        resp = api_client.post(reverse("payment-webhook"), data=body,
                               content_type="application/json",
                               HTTP_X_WEBHOOK_SIGNATURE=_sign(body))
        assert resp.status_code == 200
        invoice.refresh_from_db()
        assert invoice.status == Invoice.Status.PAID
        assert invoice.amount_paid == invoice.amount
        assert invoice.paid_at is not None

    def test_replayed_webhook_is_noop(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        invoice, parent = self._invoice_with_parent()
        payment, _ = services.start_invoice_payment(invoice, parent)
        payload = {"order_id": payment.id, "status": "CAPTURED", "id": "tx-123"}
        body = json.dumps(payload).encode()
        sig = _sign(body)
        url = reverse("payment-webhook")
        api_client.post(url, data=body, content_type="application/json",
                        HTTP_X_WEBHOOK_SIGNATURE=sig)
        api_client.post(url, data=body, content_type="application/json",
                        HTTP_X_WEBHOOK_SIGNATURE=sig)
        invoice.refresh_from_db()
        assert invoice.amount_paid == invoice.amount  # credited once, not twice


# ── admin ─────────────────────────────────────────────────────────────────────

class TestAdmin:
    def test_dashboard_outstanding_vs_collected(self, admin_client):
        _schedule()
        s1 = StudentProfileFactory()
        StudentProfileFactory()
        services.generate_invoices(PERIOD)
        services.mark_invoice_paid(Invoice.objects.get(student=s1, period=PERIOD))

        resp = admin_client.get(reverse("finance-admin-dashboard"), {"period": PERIOD})
        assert resp.status_code == 200
        assert resp.data["billed"] == "6000.00"
        assert resp.data["collected"] == "3000.00"
        assert resp.data["outstanding"] == "3000.00"
        assert resp.data["collection_rate"] == 50.0

    def test_mark_paid_is_audited(self, admin_client, admin_user):
        _schedule()
        student = StudentProfileFactory()
        services.generate_invoices(PERIOD)
        invoice = Invoice.objects.get(student=student, period=PERIOD)
        resp = admin_client.post(reverse("finance-admin-mark-paid", args=[invoice.id]),
                                 {"reason": "Pago en caja"})
        assert resp.status_code == 200
        invoice.refresh_from_db()
        assert invoice.status == Invoice.Status.PAID
        assert invoice.adjustments.filter(kind="mark_paid").count() == 1

    def test_parent_cannot_see_other_childs_invoice(self, api_client):
        _schedule()
        mine = ParentFactory()
        other_student = StudentProfileFactory()
        services.generate_invoices(PERIOD)
        inv = Invoice.objects.get(student=other_student, period=PERIOD)
        api_client.force_authenticate(user=mine)
        resp = api_client.get(reverse("finance-invoice-detail", args=[inv.id]))
        assert resp.status_code == 404
