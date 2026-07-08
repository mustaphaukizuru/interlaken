"""
Cafeteria: Loyverse balance sync (idempotent, network mocked), the low-balance
signal, and the admin-only permission gate around balances / top-up application.

No Loyverse HTTP call is ever made — the ``services.*`` helpers are patched.
"""

from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria import services
from apps.cafeteria.models import (CafeteriaBalance, CafeteriaTransaction,
                                   TopUpRequest)
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


def _receipt(customer_id, number, total, *, receipt_type="SALE", line_items=None,
             date="2026-07-01T12:00:00.000Z"):
    """Build a minimal Loyverse receipt payload matching ``_parse_receipt``."""
    return {
        "customer_id": customer_id,
        "receipt_number": number,
        "receipt_type": receipt_type,
        "total_money": total,
        "receipt_date": date,
        "line_items": line_items or [],
    }


class TestBalanceSync:
    @patch("apps.cafeteria.services.get_customer_by_id")
    def test_sync_writes_balance_and_is_idempotent(self, mock_get):
        mock_get.return_value = {"total_points": 125}
        student = StudentProfileFactory()

        first = services.sync_student_balance(student)
        assert first == Decimal("125")

        cb = CafeteriaBalance.objects.get(student=student)
        assert cb.balance == Decimal("125")
        assert cb.last_synced is not None

        # Re-syncing the same points must not create a second balance row or change value.
        second = services.sync_student_balance(student)
        assert second == Decimal("125")
        assert CafeteriaBalance.objects.filter(student=student).count() == 1

    @patch("apps.cafeteria.services.get_customer_by_id")
    def test_sync_all_counts_successes_and_failures(self, mock_get):
        ok_student = StudentProfileFactory(loyverse_id="loy-ok")
        bad_student = StudentProfileFactory(loyverse_id="loy-bad")

        def _side_effect(loyverse_id):
            if loyverse_id == "loy-bad":
                raise services.LoyverseError("boom")
            return {"total_points": 40}

        mock_get.side_effect = _side_effect
        result = services.sync_all_balances()
        assert result == {"synced": 1, "failed": 1}
        assert CafeteriaBalance.objects.get(student=ok_student).balance == Decimal("40")
        assert not CafeteriaBalance.objects.filter(student=bad_student).exists()

    def test_low_balance_flag(self):
        student = StudentProfileFactory()
        cb = CafeteriaBalance.objects.create(
            student=student,
            balance=Decimal("10"),
            low_balance_threshold=Decimal("50"),
        )
        assert cb.is_low_balance is True
        cb.balance = Decimal("80")
        assert cb.is_low_balance is False


class TestAdminPermissions:
    def test_balances_endpoint_is_admin_only(self, api_client):
        api_client.force_authenticate(user=ParentFactory())
        assert api_client.get(reverse("admin-balances")).status_code == 403

    def test_sync_all_is_admin_only(self, api_client):
        api_client.force_authenticate(user=ParentFactory())
        assert api_client.post(reverse("admin-sync-all")).status_code == 403

    def test_admin_can_list_balances(self, api_client):
        StudentProfileFactory()
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-balances"))
        assert resp.status_code == 200


class TestApplyTopUp:
    @patch("apps.cafeteria.views.sync_student_balance")
    @patch("apps.cafeteria.views.add_points_to_customer")
    def test_apply_marks_completed(self, mock_add, mock_sync, api_client):
        student = StudentProfileFactory(loyverse_id="loy-1")
        topup = TopUpRequest.objects.create(student=student, amount=Decimal("200"))

        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(reverse("admin-apply-topup", args=[topup.id]))
        assert resp.status_code == 200, resp.data

        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert topup.processed_at is not None
        mock_add.assert_called_once()
        mock_sync.assert_called_once_with(student)

    def test_apply_twice_is_rejected(self, api_client):
        student = StudentProfileFactory(loyverse_id="loy-1")
        topup = TopUpRequest.objects.create(
            student=student,
            amount=Decimal("200"),
            status=TopUpRequest.Status.COMPLETED,
        )
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(reverse("admin-apply-topup", args=[topup.id]))
        assert resp.status_code == 400

    def test_apply_without_loyverse_id_is_rejected(self, api_client):
        student = StudentProfileFactory(loyverse_id="")
        topup = TopUpRequest.objects.create(student=student, amount=Decimal("200"))
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(reverse("admin-apply-topup", args=[topup.id]))
        assert resp.status_code == 400
