"""Portal dashboard family-login shape for school-email students."""

from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.finance.models import Invoice

pytestmark = pytest.mark.django_db


class TestDashboardFamilyLogin:
    def test_student_without_self_guardian_gets_family_payload(self, api_client):
        """Missing parents M2M still yields children[] for ParentDashboard."""
        student = StudentProfileFactory()  # no parents.add(self)
        api_client.force_authenticate(user=student.user)

        resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        assert resp.data["children_count"] == 1
        assert resp.data["children"][0]["id"] == student.id
        assert resp.data["children"][0]["student_id"] == student.student_id
        assert "cafeteria_balances" in resp.data
        assert resp.data["needs_family_link"] is False
        assert resp.data["pending_invoices"] == 0
        assert resp.data["pending_balance"] == "0.00"
        # Legacy thin student-only keys must not be the only shape.
        assert "cafeteria_balance" not in resp.data

    def test_self_guardian_student_gets_family_payload(self, api_client):
        student = StudentProfileFactory()
        student.parents.add(student.user)
        api_client.force_authenticate(user=student.user)

        resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        assert resp.data["children_count"] == 1
        assert resp.data["children"][0]["id"] == student.id
        assert resp.data["needs_family_link"] is False

    def test_parent_without_linked_students_gets_stable_empty_family_payload(self, api_client):
        parent = ParentFactory()
        api_client.force_authenticate(user=parent)

        resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        assert resp.data["children_count"] == 0
        assert resp.data["children"] == []
        assert resp.data["cafeteria_balances"] == []
        assert resp.data["recent_payments"] == []
        assert resp.data["needs_family_link"] is True
        assert resp.data["pending_invoices"] == 0
        assert resp.data["pending_balance"] == "0.00"
        assert "announcements" in resp.data
        assert "unread_notifications" in resp.data

    def test_pending_invoices_counts_unpaid_colegiaturas_not_payment_rows(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        Invoice.objects.create(
            student=student,
            period="2026-08",
            due_date=date(2026, 8, 10),
            amount=Decimal("2500.00"),
            status=Invoice.Status.PENDING,
        )
        Invoice.objects.create(
            student=student,
            period="2026-07",
            due_date=date(2026, 7, 10),
            amount=Decimal("2500.00"),
            amount_paid=Decimal("2500.00"),
            status=Invoice.Status.PAID,
        )
        Invoice.objects.create(
            student=student,
            period="2026-06",
            due_date=date(2026, 6, 10),
            amount=Decimal("1000.00"),
            status=Invoice.Status.OVERDUE,
        )

        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        assert resp.data["pending_invoices"] == 2
        assert resp.data["pending_balance"] == "3500.00"
        # No checkout initiated — recent_payments stays empty (false-zero trap).
        assert resp.data["recent_payments"] == []
