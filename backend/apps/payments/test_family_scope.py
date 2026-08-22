"""Family-scoped payment history + detail (co-guardian / school-email login)."""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import TopUpRequest
from apps.payments.factories import PaymentFactory
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db


def _family_topup_payment(student, payer, amount="1500.00"):
    """A cafeteria top-up payment made by ``payer`` for ``student``."""
    topup = TopUpRequest.objects.create(
        student=student, amount=Decimal(amount), method=TopUpRequest.Method.ONLINE,
    )
    return Payment.objects.create(
        user=payer, payment_type=Payment.Type.CAFETERIA, amount=Decimal(amount),
        related_topup=topup, status=Payment.Status.PENDING,
    )


class TestFamilyScopedPayments:
    def test_co_guardian_sees_sibling_parent_topup_payment(self, api_client):
        parent_a = ParentFactory()
        parent_b = ParentFactory()
        student = StudentProfileFactory(parents=[parent_a, parent_b])
        payment = _family_topup_payment(student, parent_a)

        api_client.force_authenticate(user=parent_b)
        history = api_client.get(reverse("payment-history"))
        assert history.status_code == 200
        rows = history.data.get("results", history.data)
        assert any(row["id"] == payment.id for row in rows)

        detail = api_client.get(reverse("payment-detail", args=[payment.id]))
        assert detail.status_code == 200
        assert detail.data["id"] == payment.id

    def test_parent_sees_student_payer_cafeteria_topup(self, api_client):
        student = StudentProfileFactory()
        student.parents.add(student.user)
        parent = ParentFactory()
        student.parents.add(parent)

        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal("100.00"),
            method=TopUpRequest.Method.ONLINE,
        )
        payment = Payment.objects.create(
            user=student.user,
            payment_type=Payment.Type.CAFETERIA,
            amount=Decimal("100.00"),
            related_topup=topup,
            status=Payment.Status.PENDING,
        )

        api_client.force_authenticate(user=parent)
        rows = api_client.get(reverse("payment-history")).data
        rows = rows.get("results", rows)
        assert any(row["id"] == payment.id for row in rows)

    def test_student_without_m2m_sees_own_topup_payment(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])  # student not self-guardian
        payment = _family_topup_payment(student, parent)

        api_client.force_authenticate(user=student.user)
        detail = api_client.get(reverse("payment-detail", args=[payment.id]))
        assert detail.status_code == 200
        assert detail.data["id"] == payment.id

    def test_unrelated_user_cannot_see_payment(self, api_client):
        payment = PaymentFactory()
        other = ParentFactory()
        api_client.force_authenticate(user=other)
        assert api_client.get(
            reverse("payment-detail", args=[payment.id])
        ).status_code == 404
        rows = api_client.get(reverse("payment-history")).data
        rows = rows.get("results", rows)
        assert all(row["id"] != payment.id for row in rows)

    def test_dashboard_recent_includes_family_payments(self, api_client):
        parent_a = ParentFactory()
        parent_b = ParentFactory()
        student = StudentProfileFactory(parents=[parent_a, parent_b])
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal("80.00"),
            method=TopUpRequest.Method.ONLINE,
        )
        payment = Payment.objects.create(
            user=parent_a,
            payment_type=Payment.Type.CAFETERIA,
            amount=Decimal("80.00"),
            related_topup=topup,
            status=Payment.Status.SUCCESS,
        )

        api_client.force_authenticate(user=parent_b)
        resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        ids = [p["id"] for p in resp.data.get("recent_payments", [])]
        assert payment.id in ids
