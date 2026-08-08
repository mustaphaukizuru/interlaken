"""Family money-notify recipients include school-email student without M2M."""
from decimal import Decimal

import pytest

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.accounts.family import family_notify_recipients
from apps.cafeteria.models import TopUpRequest
from apps.cafeteria.services import notify_topup_result
from apps.finance import services as finance_services
from apps.finance.models import FeeSchedule
from apps.payments.models import Payment
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


class TestFamilyNotifyRecipients:
    def test_includes_own_user_when_parents_m2m_empty(self):
        student = StudentProfileFactory()  # no parents.add
        recipients = family_notify_recipients(student)
        assert [u.pk for u in recipients] == [student.user_id]

    def test_linked_guardians_plus_no_duplicate_self(self):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        student.parents.add(student.user)
        recipients = family_notify_recipients(student)
        ids = {u.pk for u in recipients}
        assert ids == {parent.pk, student.user_id}

    def test_topup_notify_reaches_student_without_m2m(self):
        student = StudentProfileFactory()
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal("100.00"),
            method=TopUpRequest.Method.ONLINE,
        )
        payment = Payment.objects.create(
            user=student.user,
            payment_type=Payment.Type.CAFETERIA,
            amount=Decimal("100.00"),
            related_topup=topup,
            status=Payment.Status.SUCCESS,
            gateway_tx_id="tx-self",
        )
        n = notify_topup_result(payment, success=True)
        assert n == 1
        notif = Notification.objects.get(
            user=student.user, notif_type=Notification.NotifType.PAYMENT,
        )
        assert 'POS' in notif.message

    def test_invoice_notify_reaches_student_without_m2m(self):
        student = StudentProfileFactory()
        FeeSchedule.objects.create(
            name="Mensual", grade="", monthly_amount=Decimal("1500.00"),
            due_day=5, active=True,
        )
        finance_services.generate_invoices("2025-08")
        invoice = student.invoices.get(period="2025-08")
        payment, _ = finance_services.start_invoice_payment(invoice, student.user)
        payment.status = Payment.Status.SUCCESS
        payment.gateway_tx_id = "tx-tuition"
        payment.save(update_fields=["status", "gateway_tx_id"])

        n = finance_services.notify_invoice_result(payment, success=True)
        assert n >= 1
        assert Notification.objects.filter(
            user=student.user, notif_type=Notification.NotifType.PAYMENT,
        ).exists()
