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
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.cafeteria.serializers import TopUpRequestSerializer
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
        # Equality with threshold is low (<=), matching serializer / parent UI.
        cb.balance = Decimal("50")
        assert cb.is_low_balance is True
        cb.balance = Decimal("80")
        assert cb.is_low_balance is False

    def test_balance_serializer_exposes_is_low_balance(self):
        from apps.cafeteria.serializers import CafeteriaBalanceSerializer

        student = StudentProfileFactory()
        cb = CafeteriaBalance.objects.create(
            student=student,
            balance=Decimal("50"),
            low_balance_threshold=Decimal("50"),
        )
        data = CafeteriaBalanceSerializer(cb).data
        assert data["is_low_balance"] is True
        assert data["balance"] == "50.00"


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
    def test_first_run_does_not_backfill_history(self, mock_receipts):
        """First run (no prior purchase) must bound the poll — never since=None —
        or historical receipts would double-debit the seeded opening balance."""
        StudentProfileFactory(loyverse_id="loy-x")
        mock_receipts.return_value = []
        services.sync_purchases()
        _, kwargs = mock_receipts.call_args
        assert kwargs.get("since") is not None

    @patch("apps.cafeteria.services.get_receipts")
    def test_go_live_watermark_bounds_first_poll(self, mock_receipts, settings):
        """The configured go-live watermark is the floor for the first poll."""
        settings.CAFETERIA_SYNC_PURCHASES_SINCE = "2026-08-01T00:00:00Z"
        StudentProfileFactory(loyverse_id="loy-x")
        mock_receipts.return_value = []
        services.sync_purchases()
        _, kwargs = mock_receipts.call_args
        assert kwargs["since"] == "2026-08-01T00:00:00Z"

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

    @patch("apps.cafeteria.views.sync_purchases")
    @patch("apps.cafeteria.views.sync_all_balances")
    def test_admin_sync_all_also_polls_purchases(self, mock_balances, mock_purchases, api_client):
        mock_balances.return_value = {"synced": 3, "failed": 0}
        mock_purchases.return_value = {
            "students": 3, "receipts": 2, "created": 1, "notified": 2,
        }
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(reverse("admin-sync-all"))
        assert resp.status_code == 200, resp.data
        assert resp.data["purchases_created"] == 1
        assert resp.data["receipts"] == 2
        mock_balances.assert_called_once()
        mock_purchases.assert_called_once()


class TestRefreshFromLoyverse:
    @patch("apps.cafeteria.views.sync_purchases")
    def test_parent_can_refresh(self, mock_sync, api_client):
        mock_sync.return_value = {
            "students": 2, "receipts": 1, "created": 1, "notified": 1,
        }
        api_client.force_authenticate(user=ParentFactory())
        resp = api_client.post(reverse("cafeteria-refresh"))
        assert resp.status_code == 200, resp.data
        assert resp.data["created"] == 1
        mock_sync.assert_called_once()

    def test_anonymous_cannot_refresh(self, api_client):
        assert api_client.post(reverse("cafeteria-refresh")).status_code in (401, 403)


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

    def test_apply_online_topup_is_rejected(self, api_client):
        # ONLINE top-ups settle via the signed webhook only; applying one here
        # would double-credit once the webhook lands (no shared idempotency key).
        student = StudentProfileFactory(loyverse_id="loy-1")
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal("300"),
            method=TopUpRequest.Method.ONLINE)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(reverse("admin-apply-topup", args=[topup.id]))
        assert resp.status_code == 400
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PENDING  # untouched
        assert not CafeteriaTransaction.objects.filter(student=student).exists()

    @patch("apps.cafeteria.services._session")  # neutralise the best-effort remote write
    def test_apply_office_writes_ledger_row_and_credits_once(self, _session, api_client):
        # Regression: the manual apply used to credit with no `reference`, so no
        # CafeteriaTransaction was written — the balance rose with no ledger line.
        student = StudentProfileFactory(loyverse_id="loy-1")
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal("300"),
            method=TopUpRequest.Method.OFFICE)
        api_client.force_authenticate(user=AdminFactory())

        resp = api_client.post(reverse("admin-apply-topup", args=[topup.id]))
        assert resp.status_code == 200, resp.data

        txs = CafeteriaTransaction.objects.filter(
            student=student, transaction_type=CafeteriaTransaction.TxType.TOPUP)
        assert txs.count() == 1
        assert txs.first().amount == Decimal("300")
        assert txs.first().loyverse_receipt_id == f"topup-request-{topup.id}"
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("300")

    def test_serializer_rejects_nonpositive_amount(self):
        # A zero/negative top-up must be rejected at the boundary — otherwise an
        # applied negative "top-up" would DEBIT the child's balance.
        student = StudentProfileFactory()
        for bad in (Decimal("0"), Decimal("-500"), Decimal("49.99"), Decimal("2000.01")):
            s = TopUpRequestSerializer(
                data={"student": student.id, "amount": bad, "method": "office"})
            assert not s.is_valid()
            assert "amount" in s.errors

    def test_serializer_accepts_amount_within_ui_bounds(self):
        student = StudentProfileFactory()
        s = TopUpRequestSerializer(
            data={"student": student.id, "amount": Decimal("50.00"), "method": "office"})
        assert s.is_valid(), s.errors
        s = TopUpRequestSerializer(
            data={"student": student.id, "amount": Decimal("2000.00"), "method": "office"})
        assert s.is_valid(), s.errors
