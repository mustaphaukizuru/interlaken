"""
Admin invoice mutations write append-only ``AuditLog`` rows (actor + reason) —
Admin console v2. The rows are explicit (``services._audit_invoice``) because
``Invoice`` is not signal-tracked; a log failure must never break the mutation.
"""
from decimal import Decimal

import pytest
from django.urls import reverse

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
    def test_mark_paid_writes_audit_with_actor_and_reason(self, admin_client, admin_user):
        invoice = _invoice()
        resp = admin_client.post(
            reverse("finance-admin-mark-paid", args=[invoice.id]),
            {"reason": "Pago en caja"}, format="json")
        assert resp.status_code == 200, resp.data

        entry = _logs(invoice, "finance.mark_paid").latest("created_at")
        assert entry.actor_id == admin_user.id
        assert entry.actor_label == admin_user.email
        assert entry.changes["reason"] == "Pago en caja"
        assert entry.changes["status"] == ["pending", "paid"]

    def test_adjust_writes_audit_with_reason(self, admin_client, admin_user):
        invoice = _invoice()
        resp = admin_client.post(
            reverse("finance-admin-adjust", args=[invoice.id]),
            {"amount": "-500.00", "reason": "Beca especial"}, format="json")
        assert resp.status_code == 200, resp.data

        entry = _logs(invoice, "finance.adjust").latest("created_at")
        assert entry.actor_id == admin_user.id
        assert entry.changes["reason"] == "Beca especial"
        assert entry.changes["amount"] == "-500.00"

    def test_cancel_writes_audit_with_reason(self, admin_client, admin_user):
        invoice = _invoice()
        resp = admin_client.post(
            reverse("finance-admin-cancel", args=[invoice.id]),
            {"reason": "Alumno dado de baja"}, format="json")
        assert resp.status_code == 200, resp.data

        entry = _logs(invoice, "finance.cancel").latest("created_at")
        assert entry.actor_id == admin_user.id
        assert entry.changes["reason"] == "Alumno dado de baja"
        assert entry.changes["status"] == ["pending", "cancelled"]

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
