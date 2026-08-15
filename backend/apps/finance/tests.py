"""
finance — dormant tuition-billing services/models.

The school does NOT bill tuition through the app: the finance URLs, admin
registrations and crons are gone. The models and service functions remain
(historical tables + the payments webhook still imports the invoice-application
helpers), so these tests keep that retained code valid:

- ``generate_invoices`` / ``apply_late_fees`` service behaviour (idempotency,
  discounts) — service-level only, no finance endpoints.
- the **payments** webhook (a retained endpoint) applying a tuition payment to
  an invoice exactly once, including replay/overpayment ledger behaviour.
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
from apps.finance.models import Discount, FeeSchedule, Invoice, InvoiceLineItem, InvoicePayment
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


# ── invoice application via the (retained) payments webhook ──────────────────

class TestPaymentWebhook:
    def _invoice_with_parent(self):
        _schedule()
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        services.generate_invoices(PERIOD)
        return Invoice.objects.get(student=student, period=PERIOD), parent

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

    def test_second_distinct_payment_is_recorded_as_overpayment(self, api_client, settings):
        # Two distinct gateway charges on one invoice (legacy concurrent HPP
        # sessions, or a charge that slipped past the reuse guard). The second
        # real capture must be recorded as an overpayment — not silently absorbed.
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        invoice, parent = self._invoice_with_parent()
        pay_a, _ = services.start_invoice_payment(invoice, parent)
        # Bypass reuse guard: model a second Payment that already exists at the
        # provider (pre-guard double-tab) so webhook ledger behaviour stays covered.
        pay_b = Payment.objects.create(
            user=parent,
            payment_type=Payment.Type.TUITION,
            amount=invoice.balance_due,
            currency=invoice.currency,
            description=pay_a.description,
            gateway=pay_a.gateway,
            status=Payment.Status.PENDING,
        )
        InvoicePayment.objects.create(invoice=invoice, payment=pay_b, amount=pay_b.amount)

        url = reverse("payment-webhook")
        for p, tx in ((pay_a, "tx-a"), (pay_b, "tx-b")):
            body = json.dumps({"order_id": p.id, "status": "CAPTURED", "id": tx}).encode()
            assert api_client.post(url, data=body, content_type="application/json",
                                   HTTP_X_WEBHOOK_SIGNATURE=_sign(body)).status_code == 200

        invoice.refresh_from_db()
        assert invoice.status == Invoice.Status.PAID
        assert invoice.amount_paid == invoice.amount * 2   # both charges recorded
        assert invoice.balance_due < 0                     # visible, refundable overpayment

    def test_completing_the_same_payment_twice_credits_once(self, settings):
        # Per-payment idempotency guard (applied_at): a second completion of the
        # SAME payment is a no-op even called directly (bypassing the webhook's
        # own final-status guard).
        invoice, parent = self._invoice_with_parent()
        payment, _ = services.start_invoice_payment(invoice, parent)

        services.complete_invoice_payment(payment)
        services.complete_invoice_payment(payment)
        invoice.refresh_from_db()
        assert invoice.amount_paid == invoice.amount


# ── concurrent checkout reuse ─────────────────────────────────────────────────

class TestCheckoutReuse:
    def _invoice_with_parent(self):
        _schedule()
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        services.generate_invoices(PERIOD)
        return Invoice.objects.get(student=student, period=PERIOD), parent

    def test_second_initiate_reuses_same_payment(self):
        invoice, parent = self._invoice_with_parent()
        pay_a, url_a = services.start_invoice_payment(invoice, parent)
        pay_b, url_b = services.start_invoice_payment(invoice, parent)
        assert pay_a.id == pay_b.id
        assert url_a and url_b
        assert Payment.objects.filter(
            invoice_payment__invoice=invoice, status=Payment.Status.PENDING,
        ).count() == 1

    def test_stale_open_checkout_is_superseded(self):
        invoice, parent = self._invoice_with_parent()
        pay_a, _ = services.start_invoice_payment(invoice, parent)
        Payment.objects.filter(pk=pay_a.pk).update(
            created_at=timezone.now() - timedelta(minutes=60))
        pay_b, _ = services.start_invoice_payment(invoice, parent)
        pay_a.refresh_from_db()
        assert pay_a.id != pay_b.id
        assert pay_a.status == Payment.Status.FAILED
        assert pay_b.status == Payment.Status.PENDING

    def test_late_success_after_stale_supersede_still_credits(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        invoice, parent = self._invoice_with_parent()
        pay_a, _ = services.start_invoice_payment(invoice, parent)
        Payment.objects.filter(pk=pay_a.pk).update(
            created_at=timezone.now() - timedelta(minutes=60))
        pay_b, _ = services.start_invoice_payment(invoice, parent)
        pay_a.refresh_from_db()
        assert pay_a.is_soft_failed()

        body = json.dumps({
            "order_id": pay_a.id, "status": "CAPTURED", "id": "late-tuition",
        }).encode()
        resp = api_client.post(
            reverse("payment-webhook"),
            data=body,
            content_type="application/json",
            HTTP_X_WEBHOOK_SIGNATURE=_sign(body),
        )
        assert resp.status_code == 200, resp.data
        pay_a.refresh_from_db()
        invoice.refresh_from_db()
        assert pay_a.status == Payment.Status.SUCCESS
        assert invoice.amount_paid == pay_a.amount
