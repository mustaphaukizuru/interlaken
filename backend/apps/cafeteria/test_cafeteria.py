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

    @patch("apps.cafeteria.services.get_customer_by_id")
    def test_seed_is_once_and_never_overwrites_local_ledger(self, mock_get):
        """R1: Loyverse seeds the OPENING balance once; the local ledger then owns
        it. A later sync must not overwrite — nor even call Loyverse again."""
        mock_get.return_value = {"total_points": 100}
        student = StudentProfileFactory()

        assert services.sync_student_balance(student) == Decimal("100")   # seed

        # Any ledger activity (here, a top-up) lifts the local balance to 600.
        cb = CafeteriaBalance.objects.get(student=student)
        cb.balance = Decimal("600")
        cb.save(update_fields=["balance"])

        # Loyverse still reads 100 (can't be written per R1). A re-sync must keep
        # the local 600 and skip the API entirely.
        mock_get.reset_mock()
        mock_get.return_value = {"total_points": 100}
        assert services.sync_student_balance(student) == Decimal("600")
        mock_get.assert_not_called()
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("600")

    @patch("apps.cafeteria.services.get_customer_by_id")
    def test_cron_sync_does_not_clobber_topped_up_student(self, mock_get):
        """The scheduled sync_balances must never erase an online top-up."""
        mock_get.return_value = {"total_points": 50}
        student = StudentProfileFactory(loyverse_id="loy-x")

        services.sync_all_balances()                 # seeds opening 50
        cb = CafeteriaBalance.objects.get(student=student)
        cb.balance = Decimal("550")                  # +500 online top-up (local)
        cb.save(update_fields=["balance"])

        services.sync_all_balances()                 # cron runs again → no-op
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("550")

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


class TestSyncPurchases:
    """Prompt 09 pipeline: receipts → transaction + balance debit + parent alerts."""

    @patch("apps.cafeteria.services.get_receipts")
    def test_purchase_records_debits_and_notifies(self, mock_receipts, mailoutbox):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        mock_receipts.return_value = [
            _receipt("loy-buyer", "R-1", 30, line_items=[
                {"item_name": "Torta", "quantity": 1, "total_money": 20},
                {"item_name": "Jugo", "quantity": 2, "total_money": 10},
            ]),
        ]

        result = services.sync_purchases()

        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id="R-1")
        assert tx.transaction_type == CafeteriaTransaction.TxType.PURCHASE
        assert tx.amount == Decimal("30")
        assert tx.balance_after == Decimal("70")
        # Itemised receipt lines are captured for the F2 history view.
        assert [i["name"] for i in tx.items] == ["Torta", "Jugo"]
        assert "Torta" in tx.description and "2× Jugo" in tx.description

        cb = CafeteriaBalance.objects.get(student=student)
        assert cb.balance == Decimal("70")
        assert cb.last_synced is not None

        # In-app notification + email fan out to the guardian.
        note = Notification.objects.get(user=parent)
        assert note.notif_type == Notification.NotifType.CAFETERIA
        assert "$30.00" in note.message
        assert len(mailoutbox) == 1
        assert parent.email in mailoutbox[0].to

        assert result["created"] == 1
        assert result["notified"] == 1

    @patch("apps.cafeteria.services.get_receipts")
    def test_sync_is_idempotent(self, mock_receipts, mailoutbox):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        mock_receipts.return_value = [_receipt("loy-buyer", "R-1", 30)]

        services.sync_purchases()
        second = services.sync_purchases()

        # Re-processing the same receipt neither duplicates the row, re-debits the
        # balance, nor re-notifies the parent (unique loyverse_receipt_id).
        assert CafeteriaTransaction.objects.filter(loyverse_receipt_id="R-1").count() == 1
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("70")
        assert Notification.objects.filter(user=parent).count() == 1
        assert len(mailoutbox) == 1
        assert second["created"] == 0

    @patch("apps.cafeteria.services.get_receipts")
    def test_refund_credits_balance(self, mock_receipts, mailoutbox):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("40"))
        mock_receipts.return_value = [
            _receipt("loy-buyer", "R-refund", 15, receipt_type="REFUND"),
        ]

        services.sync_purchases()

        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id="R-refund")
        assert tx.transaction_type == CafeteriaTransaction.TxType.REFUND
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("55")

    @patch("apps.cafeteria.services.get_receipts")
    def test_unlinked_customer_is_ignored(self, mock_receipts, mailoutbox):
        parent = ParentFactory()
        StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        mock_receipts.return_value = [_receipt("stranger", "R-x", 30)]

        result = services.sync_purchases()

        assert result["created"] == 0
        assert CafeteriaTransaction.objects.count() == 0
        assert len(mailoutbox) == 0

    @patch("apps.cafeteria.services.get_receipts")
    def test_low_balance_alert_fires_once(self, mock_receipts, mailoutbox):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("60"), low_balance_threshold=Decimal("50"),
        )
        # A 40-peso purchase drops the balance to 20 (< 50 threshold).
        mock_receipts.return_value = [_receipt("loy-buyer", "R-1", 40)]

        services.sync_purchases()

        titles = set(Notification.objects.filter(user=parent).values_list("title", flat=True))
        assert "Compra en cafetería" in titles
        assert "Saldo bajo en cafetería" in titles

        cb = CafeteriaBalance.objects.get(student=student)
        assert cb.last_low_balance_alert_at is not None

        # A second purchase within the cooldown window must not re-alert (deduped).
        mock_receipts.return_value = [_receipt("loy-buyer", "R-2", 5)]
        services.sync_purchases()
        assert Notification.objects.filter(
            user=parent, title="Saldo bajo en cafetería").count() == 1

    @patch("apps.cafeteria.services.get_receipts")
    def test_no_linked_students_is_noop(self, mock_receipts):
        StudentProfileFactory(loyverse_id="")  # not linked to Loyverse
        result = services.sync_purchases()
        assert result == {"students": 0, "receipts": 0, "created": 0, "notified": 0}
        mock_receipts.assert_not_called()


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
        # The credit must NOT be followed by a Loyverse balance re-pull — that would
        # overwrite the just-applied credit with the (un-writable) Loyverse points.
        mock_sync.assert_not_called()

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
