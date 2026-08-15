"""
Money mutations write append-only ``AuditLog`` rows (actor + reason).

The finance admin endpoints are gone (the app does not bill tuition), so the
invoice coverage here is service-level only: the rows are explicit
(``services._audit_invoice``) because ``Invoice`` is not signal-tracked, and a
log failure must never break the mutation. Cafetería audit writes (live money
path) are covered at the bottom.
"""
from decimal import Decimal

import pytest

from apps.accounts.factories import StudentProfileFactory
from apps.core.models import AuditLog
from apps.finance import services
from apps.finance.models import FeeSchedule, Invoice

pytestmark = pytest.mark.django_db

PERIOD = "2026-08"


def _invoice():
    FeeSchedule.objects.create(
        name="Base", grade="", monthly_amount=Decimal("3000.00"), due_day=5, active=True)
    student = StudentProfileFactory()
    services.generate_invoices(PERIOD)
    return Invoice.objects.get(student=student, period=PERIOD)


def _logs(invoice, context):
    return AuditLog.objects.filter(
        object_type="finance.invoice", object_id=str(invoice.pk), context=context)


class TestInvoiceAuditWrites:
    def test_refund_writes_audit_with_reason(self, admin_user):
        from apps.finance.models import InvoicePayment
        from apps.payments.models import Payment

        invoice = _invoice()
        # Overpay via a second applied online payment (webhook path).
        payment = Payment.objects.create(
            user=admin_user, payment_type=Payment.Type.TUITION,
            amount=invoice.amount, gateway=Payment.Gateway.GLOBAL_PAYMENTS,
            status=Payment.Status.SUCCESS)
        InvoicePayment.objects.create(invoice=invoice, payment=payment, amount=payment.amount)
        services.complete_invoice_payment(payment)
        extra = Payment.objects.create(
            user=admin_user, payment_type=Payment.Type.TUITION,
            amount=Decimal("100.00"), gateway=Payment.Gateway.GLOBAL_PAYMENTS,
            status=Payment.Status.SUCCESS)
        InvoicePayment.objects.create(invoice=invoice, payment=extra, amount=extra.amount)
        services.complete_invoice_payment(extra)
        invoice.refresh_from_db()
        assert invoice.balance_due < 0

        services.refund_invoice_overpayment(
            invoice, reason="Doble cargo", admin=admin_user)

        entry = _logs(invoice, "finance.refund").latest("created_at")
        assert entry.actor_id == admin_user.id
        assert entry.changes["reason"] == "Doble cargo"
        assert entry.changes["payment_id"] == extra.id

    def test_audit_failure_does_not_break_the_mutation(self, admin_user, monkeypatch):
        """Fail-open: a broken audit layer must not block the money mutation."""
        invoice = _invoice()

        def _boom(*args, **kwargs):
            raise RuntimeError("audit backend down")

        monkeypatch.setattr("apps.core.audit.record", _boom)
        adj = services.mark_invoice_paid(invoice, reason="Caja", admin=admin_user)
        assert adj is not None
        invoice.refresh_from_db()
        assert invoice.status == Invoice.Status.PAID


class TestCafeteriaAuditWrites:
    def test_balance_adjustment_writes_reason_row(self, admin_user):
        from apps.cafeteria.services import adjust_balance

        student = StudentProfileFactory()
        adjust_balance(student, Decimal("50.00"), "Corrección de saldo",
                       admin=admin_user, notify=False, mirror=False)

        entry = AuditLog.objects.filter(
            object_type="cafeteria.cafeteriabalance",
            context="cafeteria.adjust").latest("created_at")
        assert entry.actor_id == admin_user.id
        assert entry.changes["reason"] == "Corrección de saldo"
        assert entry.changes["amount"] == "50.00"
