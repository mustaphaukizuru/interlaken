"""Concurrent checkout reuse + stale expiry."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from io import StringIO

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import TopUpRequest
from apps.payments.models import Payment
from apps.payments.services import expire_stale_checkouts

pytestmark = pytest.mark.django_db


class TestCafeteriaCheckoutReuse:
    def test_second_online_topup_reuses_payment(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(user=parent)
        url = reverse("cafeteria-topup")
        payload = {
            "student": student.id, "amount": "200.00", "method": "online",
            "gateway": "global_payments",
        }
        first = api_client.post(url, payload, format="json")
        assert first.status_code == 201, first.data
        second = api_client.post(url, payload, format="json")
        assert second.status_code == 201, second.data
        assert first.data["payment_id"] == second.data["payment_id"]
        assert Payment.objects.filter(
            related_topup__student=student, status=Payment.Status.PENDING,
        ).count() == 1
        assert TopUpRequest.objects.filter(
            student=student, status=TopUpRequest.Status.PENDING,
        ).count() == 1

    def test_different_amount_supersedes_prior_checkout(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(user=parent)
        url = reverse("cafeteria-topup")
        first = api_client.post(
            url,
            {"student": student.id, "amount": "100.00", "method": "online",
             "gateway": "global_payments"},
            format="json",
        )
        assert first.status_code == 201, first.data
        second = api_client.post(
            url,
            {"student": student.id, "amount": "250.00", "method": "online",
             "gateway": "global_payments"},
            format="json",
        )
        assert second.status_code == 201, second.data
        assert first.data["payment_id"] != second.data["payment_id"]
        old = Payment.objects.get(pk=first.data["payment_id"])
        assert old.status == Payment.Status.FAILED


class TestExpireStalePayments:
    def test_expire_fails_old_pending(self):
        parent = ParentFactory()
        payment = Payment.objects.create(
            user=parent,
            payment_type=Payment.Type.TUITION,
            amount=Decimal("100.00"),
            status=Payment.Status.PENDING,
        )
        Payment.objects.filter(pk=payment.pk).update(
            created_at=timezone.now() - timedelta(minutes=90))
        n = expire_stale_checkouts(older_than_minutes=45)
        assert n == 1
        payment.refresh_from_db()
        assert payment.status == Payment.Status.FAILED

    def test_expire_command_dry_run_does_not_mutate(self):
        parent = ParentFactory()
        payment = Payment.objects.create(
            user=parent,
            payment_type=Payment.Type.CAFETERIA,
            amount=Decimal("50.00"),
            status=Payment.Status.PENDING,
        )
        Payment.objects.filter(pk=payment.pk).update(
            created_at=timezone.now() - timedelta(minutes=90))
        out = StringIO()
        call_command("expire_stale_payments", dry_run=True, stdout=out)
        payment.refresh_from_db()
        assert payment.status == Payment.Status.PENDING
        assert "DRY RUN" in out.getvalue()
