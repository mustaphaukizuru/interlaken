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
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.finance import services
from apps.finance.models import Discount, FeeSchedule, Invoice, InvoiceLineItem, InvoicePayment
from apps.payments.models import Payment

GW_CHECKOUT = "apps.payments.gateways.global_payments.GlobalPaymentsGateway.create_checkout"

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

    def test_checkout_exception_marks_failed_no_orphan(self, api_client):
        """Gateway raise during tuition checkout → FAILED, no PENDING orphan."""
        invoice, parent = self._invoice_with_parent()
        api_client.force_authenticate(user=parent)
        with patch(GW_CHECKOUT, side_effect=RuntimeError("gateway down")):
            resp = api_client.post(reverse("finance-invoice-pay", args=[invoice.id]), {})
        assert resp.status_code == 502, resp.data
        assert not Payment.objects.filter(status=Payment.Status.PENDING).exists()
        payment = Payment.objects.get()
        assert payment.status == Payment.Status.FAILED
        assert "gateway down" in payment.gateway_raw.get("error", "")
        assert payment.gateway_raw.get("stage") == "create_checkout"
        # InvoicePayment link remains for audit; invoice stays unpaid.
        assert InvoicePayment.objects.filter(payment=payment, invoice=invoice).exists()
        invoice.refresh_from_db()
        assert invoice.status == Invoice.Status.PENDING
        assert invoice.amount_paid == Decimal("0.00")

    def test_checkout_empty_url_marks_failed(self, api_client):
        invoice, parent = self._invoice_with_parent()
        api_client.force_authenticate(user=parent)
        with patch(GW_CHECKOUT, return_value=""):
            resp = api_client.post(reverse("finance-invoice-pay", args=[invoice.id]), {})
        assert resp.status_code == 502, resp.data
        assert not Payment.objects.filter(status=Payment.Status.PENDING).exists()
        assert Payment.objects.get().status == Payment.Status.FAILED

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

    def test_bulk_remind_skips_settled_invoices(self, admin_client):
        # A "$0.00 saldo" reminder must not go to a paid/cancelled invoice
        # included in the selection.
        _schedule()
        s1, s2 = StudentProfileFactory(), StudentProfileFactory()
        services.generate_invoices(PERIOD)
        paid = Invoice.objects.get(student=s1, period=PERIOD)
        unpaid = Invoice.objects.get(student=s2, period=PERIOD)
        services.mark_invoice_paid(paid)

        resp = admin_client.post(reverse("finance-admin-bulk"), {
            "action": "remind", "invoice_ids": [paid.id, unpaid.id],
        }, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data["done"] == 1       # only the unpaid invoice reminded
        assert resp.data["skipped"] == 1    # the paid invoice skipped

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

    def test_cancel_requires_reason_and_is_audited(self, admin_client):
        _schedule()
        student = StudentProfileFactory()
        services.generate_invoices(PERIOD)
        invoice = Invoice.objects.get(student=student, period=PERIOD)

        missing = admin_client.post(
            reverse("finance-admin-cancel", args=[invoice.id]), {}, format="json")
        assert missing.status_code == 400

        resp = admin_client.post(
            reverse("finance-admin-cancel", args=[invoice.id]),
            {"reason": "Baja del alumno"}, format="json")
        assert resp.status_code == 200, resp.data
        invoice.refresh_from_db()
        assert invoice.status == Invoice.Status.CANCELLED
        assert invoice.adjustments.filter(kind="cancel").count() == 1

    def test_cancel_rejects_paid_invoice(self, admin_client):
        _schedule()
        student = StudentProfileFactory()
        services.generate_invoices(PERIOD)
        invoice = Invoice.objects.get(student=student, period=PERIOD)
        services.mark_invoice_paid(invoice)
        resp = admin_client.post(
            reverse("finance-admin-cancel", args=[invoice.id]),
            {"reason": "Ya pagada"}, format="json")
        assert resp.status_code == 400

    def test_adjust_credit_and_charge_and_negative_guard(self, admin_client):
        _schedule()
        student = StudentProfileFactory()
        services.generate_invoices(PERIOD)
        invoice = Invoice.objects.get(student=student, period=PERIOD)

        credit = admin_client.post(
            reverse("finance-admin-adjust", args=[invoice.id]),
            {"amount": "-200.00", "reason": "Descuento especial"}, format="json")
        assert credit.status_code == 200, credit.data
        invoice.refresh_from_db()
        assert invoice.amount == Decimal("2800.00")
        assert invoice.adjustments.filter(kind="adjust").count() == 1

        charge = admin_client.post(
            reverse("finance-admin-adjust", args=[invoice.id]),
            {"amount": "50.00", "reason": "Material extra"}, format="json")
        assert charge.status_code == 200, charge.data
        invoice.refresh_from_db()
        assert invoice.amount == Decimal("2850.00")

        overdraw = admin_client.post(
            reverse("finance-admin-adjust", args=[invoice.id]),
            {"amount": "-10000.00", "reason": "Demasiado"}, format="json")
        assert overdraw.status_code == 400

    def test_adjust_reopens_paid_invoice(self, admin_client):
        _schedule()
        student = StudentProfileFactory()
        services.generate_invoices(PERIOD)
        invoice = Invoice.objects.get(student=student, period=PERIOD)
        services.mark_invoice_paid(invoice)

        resp = admin_client.post(
            reverse("finance-admin-adjust", args=[invoice.id]),
            {"amount": "100.00", "reason": "Cargo posterior"}, format="json")
        assert resp.status_code == 200, resp.data
        invoice.refresh_from_db()
        assert invoice.status in (Invoice.Status.PENDING, Invoice.Status.OVERDUE)
        assert invoice.balance_due == Decimal("100.00")

    def test_bulk_mark_paid_and_cancel(self, admin_client):
        _schedule()
        s1, s2, s3 = StudentProfileFactory(), StudentProfileFactory(), StudentProfileFactory()
        services.generate_invoices(PERIOD)

        paid_ids = list(
            Invoice.objects.filter(student__in=[s1, s2], period=PERIOD)
            .values_list("id", flat=True)
        )
        resp = admin_client.post(reverse("finance-admin-bulk"), {
            "action": "mark_paid", "invoice_ids": paid_ids, "reason": "Caja",
        }, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data["done"] == 2
        assert Invoice.objects.filter(id__in=paid_ids, status=Invoice.Status.PAID).count() == 2

        cancel_id = Invoice.objects.get(student=s3, period=PERIOD).id
        resp = admin_client.post(reverse("finance-admin-bulk"), {
            "action": "cancel", "invoice_ids": [cancel_id], "reason": "Error de carga",
        }, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data["done"] == 1
        assert Invoice.objects.get(pk=cancel_id).status == Invoice.Status.CANCELLED

    def test_bulk_rejects_bad_action_and_empty_ids(self, admin_client):
        empty = admin_client.post(reverse("finance-admin-bulk"), {
            "action": "mark_paid", "invoice_ids": [],
        }, format="json")
        assert empty.status_code == 400

        bad = admin_client.post(reverse("finance-admin-bulk"), {
            "action": "explode", "invoice_ids": [1],
        }, format="json")
        assert bad.status_code == 400

    def test_receipt_pdf_paid_vs_unpaid(self, api_client):
        _schedule()
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        services.generate_invoices(PERIOD)
        invoice = Invoice.objects.get(student=student, period=PERIOD)
        api_client.force_authenticate(user=parent)

        unpaid = api_client.get(reverse("finance-invoice-receipt", args=[invoice.id]))
        assert unpaid.status_code == 400

        services.mark_invoice_paid(invoice)
        paid = api_client.get(reverse("finance-invoice-receipt", args=[invoice.id]))
        assert paid.status_code == 200
        assert paid["Content-Type"] == "application/pdf"
        assert paid.content[:4] == b"%PDF"


# ── overpayment refund (admin offline) ────────────────────────────────────────

def _capture_tuition(api_client, payment, tx_id: str):
    body = json.dumps({"order_id": payment.id, "status": "CAPTURED", "id": tx_id}).encode()
    resp = api_client.post(
        reverse("payment-webhook"),
        data=body,
        content_type="application/json",
        HTTP_X_WEBHOOK_SIGNATURE=_sign(body),
    )
    assert resp.status_code == 200
    return resp


class TestOverpaymentRefund:
    def _overpaid_invoice(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        _schedule()
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        services.generate_invoices(PERIOD)
        invoice = Invoice.objects.get(student=student, period=PERIOD)
        pay_a, _ = services.start_invoice_payment(invoice, parent)
        # Bypass reuse guard: model a second captured charge (pre-guard double-tab).
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
        _capture_tuition(api_client, pay_a, "tx-a")
        _capture_tuition(api_client, pay_b, "tx-b")
        invoice.refresh_from_db()
        assert invoice.balance_due < 0
        return invoice, parent, pay_a, pay_b

    def test_admin_refund_reverses_newest_payment(self, api_client, admin_client, settings):
        invoice, _parent, pay_a, pay_b = self._overpaid_invoice(api_client, settings)
        newest = max(pay_a, pay_b, key=lambda p: p.id)

        resp = admin_client.post(
            reverse("finance-admin-refund", args=[invoice.id]),
            {"reason": "Doble cobro — devolución en transferencia"},
            format="json",
        )
        assert resp.status_code == 200, resp.data

        invoice.refresh_from_db()
        newest.refresh_from_db()
        assert newest.status == Payment.Status.REFUNDED
        assert invoice.amount_paid == invoice.amount
        assert invoice.balance_due == Decimal("0.00")
        assert invoice.status == Invoice.Status.PAID
        assert invoice.adjustments.filter(kind="refund").count() == 1

        again = admin_client.post(
            reverse("finance-admin-refund", args=[invoice.id]),
            {"reason": "Otra vez"}, format="json",
        )
        assert again.status_code == 400

    def test_refund_specific_payment_id(self, api_client, admin_client, settings):
        invoice, _parent, pay_a, pay_b = self._overpaid_invoice(api_client, settings)
        resp = admin_client.post(
            reverse("finance-admin-refund", args=[invoice.id]),
            {"reason": "Devolver pago A", "payment_id": pay_a.id},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        pay_a.refresh_from_db()
        pay_b.refresh_from_db()
        assert pay_a.status == Payment.Status.REFUNDED
        assert pay_b.status == Payment.Status.SUCCESS
        invoice.refresh_from_db()
        assert invoice.amount_paid == invoice.amount

    def test_refund_rejects_non_overpaid(self, admin_client):
        _schedule()
        student = StudentProfileFactory()
        services.generate_invoices(PERIOD)
        invoice = Invoice.objects.get(student=student, period=PERIOD)
        services.mark_invoice_paid(invoice)

        resp = admin_client.post(
            reverse("finance-admin-refund", args=[invoice.id]),
            {"reason": "No aplica"}, format="json",
        )
        assert resp.status_code == 400
        assert "saldo a favor" in resp.data["error"].lower()

    def test_refund_requires_reason(self, api_client, admin_client, settings):
        invoice, *_ = self._overpaid_invoice(api_client, settings)
        resp = admin_client.post(
            reverse("finance-admin-refund", args=[invoice.id]),
            {}, format="json",
        )
        assert resp.status_code == 400

    def test_refund_is_admin_only(self, api_client, settings):
        invoice, parent, *_ = self._overpaid_invoice(api_client, settings)
        api_client.force_authenticate(user=parent)
        resp = api_client.post(
            reverse("finance-admin-refund", args=[invoice.id]),
            {"reason": "No debería"}, format="json",
        )
        assert resp.status_code == 403

    def test_dashboard_and_list_surface_overpaid(self, api_client, admin_client, settings):
        invoice, *_ = self._overpaid_invoice(api_client, settings)

        dash = admin_client.get(reverse("finance-admin-dashboard"), {"period": PERIOD})
        assert dash.status_code == 200
        assert dash.data["overpaid"] == 1
        assert Decimal(dash.data["overpaid_credit"]) == invoice.amount

        listing = admin_client.get(
            reverse("finance-admin-invoices"), {"period": PERIOD, "status": "overpaid"})
        assert listing.status_code == 200
        results = listing.data["results"] if "results" in listing.data else listing.data
        assert any(row["id"] == invoice.id for row in results)


# ── school-email / family-login students ──────────────────────────────────────

class TestStudentOwnInvoices:
    """School-email students must see/pay their own colegiaturas (cafeteria parity)."""

    def test_self_guardian_can_list_and_pay(self, api_client):
        _schedule()
        student = StudentProfileFactory()
        student.parents.add(student.user)
        services.generate_invoices(PERIOD)
        invoice = Invoice.objects.get(student=student, period=PERIOD)

        api_client.force_authenticate(user=student.user)
        listing = api_client.get(reverse("finance-invoices"))
        assert listing.status_code == 200
        rows = listing.data["results"] if "results" in listing.data else listing.data
        assert any(row["id"] == invoice.id for row in rows)

        pay = api_client.post(reverse("finance-invoice-pay", args=[invoice.id]), {})
        assert pay.status_code == 201, pay.data
        assert pay.data["payment_id"]
        assert pay.data["redirect_url"]

    def test_own_profile_without_parents_m2m_can_list_and_pay(self, api_client):
        """Own OneToOne profile is enough even if self-guardian link is missing."""
        _schedule()
        student = StudentProfileFactory()  # no parents.add(self)
        services.generate_invoices(PERIOD)
        invoice = Invoice.objects.get(student=student, period=PERIOD)

        api_client.force_authenticate(user=student.user)
        listing = api_client.get(reverse("finance-invoices"))
        assert listing.status_code == 200
        rows = listing.data["results"] if "results" in listing.data else listing.data
        assert any(row["id"] == invoice.id for row in rows)

        pay = api_client.post(reverse("finance-invoice-pay", args=[invoice.id]), {})
        assert pay.status_code == 201, pay.data

    def test_student_cannot_see_or_pay_another_invoice(self, api_client):
        _schedule()
        mine = StudentProfileFactory()
        other = StudentProfileFactory()
        services.generate_invoices(PERIOD)
        foreign = Invoice.objects.get(student=other, period=PERIOD)

        api_client.force_authenticate(user=mine.user)
        assert api_client.get(
            reverse("finance-invoice-detail", args=[foreign.id])
        ).status_code == 404
        assert api_client.post(
            reverse("finance-invoice-pay", args=[foreign.id]), {}
        ).status_code == 404

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
        from datetime import timedelta

        from django.utils import timezone

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

