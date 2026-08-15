"""
Cafeteria: Loyverse balance sync (idempotent, network mocked), the low-balance
signal, and the admin-only permission gate around balances / top-up application.

No Loyverse HTTP call is ever made — the ``services.*`` helpers are patched.
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria import services
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.cafeteria.serializers import TopUpRequestSerializer
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


def _receipt(customer_id, number, total, *, receipt_type="SALE", line_items=None,
             date="2026-07-01T12:00:00.000Z", cash=0, points_deducted=0,
             points_earned=0):
    """Build a Loyverse receipt payload matching the store's REAL shape.

    The school POS charges the wallet via points redemption, so ``total`` (the
    wallet spend) lands in a receipt-level ``DISCOUNT_BY_POINTS`` entry and
    ``total_money`` carries only the cash/card portion (``cash``, usually 0).
    """
    discounts = ([{"type": "DISCOUNT_BY_POINTS", "name": "Discount by points",
                   "money_amount": total}] if total else [])
    return {
        "customer_id": customer_id,
        "receipt_number": number,
        "receipt_type": receipt_type,
        "total_money": cash,
        "total_discounts": discounts,
        "points_deducted": points_deducted,
        "points_earned": points_earned,
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

        # In-app + email to linked guardians and the school-email student User
        # when that account is not already on parents M2M.
        note = Notification.objects.get(user=parent)
        assert note.notif_type == Notification.NotifType.CAFETERIA
        assert "$30.00" in note.message
        assert Notification.objects.filter(user=student.user).count() == 1
        assert len(mailoutbox) == 2
        assert {m.to[0] for m in mailoutbox} == {parent.email, student.user.email}

        assert result["created"] == 1
        assert result["notified"] == 2

    @patch("apps.cafeteria.services.get_receipts")
    def test_sync_is_idempotent(self, mock_receipts, mailoutbox):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        mock_receipts.return_value = [_receipt("loy-buyer", "R-1", 30)]

        services.sync_purchases()
        second = services.sync_purchases()

        # Re-processing the same receipt neither duplicates the row, re-debits the
        # balance, nor re-notifies (unique loyverse_receipt_id).
        assert CafeteriaTransaction.objects.filter(loyverse_receipt_id="R-1").count() == 1
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("70")
        assert Notification.objects.filter(user=parent).count() == 1
        assert Notification.objects.filter(user=student.user).count() == 1
        assert len(mailoutbox) == 2
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
        assert result == {
            "students": 0, "receipts": 0, "created": 0, "notified": 0,
            "unmatched": 0, "skipped": 0}
        mock_receipts.assert_not_called()

    @patch("apps.cafeteria.services.get_receipts")
    def test_sync_reports_unmatched_receipts(self, mock_receipts):
        """A receipt whose customer isn't a linked student is counted, not silently
        dropped (F21 visibility) — and never recorded."""
        parent = ParentFactory()
        StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        mock_receipts.return_value = [
            _receipt("loy-buyer", "R-1", 30),
            _receipt("stranger", "R-2", 15),
        ]
        result = services.sync_purchases()
        assert result["created"] == 1
        assert result["unmatched"] == 1

    @patch("apps.cafeteria.services.get_receipts")
    def test_webhook_purchase_does_not_poison_poll_watermark(self, mock_receipts):
        """A webhook-recorded newer purchase must NOT advance the poll's cursor,
        or a lost webhook for an OLDER receipt would be permanently skipped by the
        poll fallback. The poll drives from its own persisted cursor, not
        max(PURCHASE.date)."""
        student = StudentProfileFactory(loyverse_id="loy-buyer")
        CafeteriaBalance.objects.create(student=student, balance=Decimal("500"))

        now = timezone.now()
        t1 = now - timedelta(minutes=20)   # the poll's last scanned receipt
        t2 = now - timedelta(minutes=2)    # a LATER purchase, via the webhook

        # First poll scans a receipt at t1 → cursor advances to t1.
        mock_receipts.return_value = [_receipt("loy-buyer", "R-poll", 10, date=t1.isoformat())]
        services.sync_purchases()

        # A webhook then records a NEWER purchase (t2) via the shared record path.
        services.record_receipts([_receipt("loy-buyer", "R-web", 15, date=t2.isoformat())])

        # Next poll must still key off the poll's own cursor (t1), NOT the webhook's
        # newer purchase (t2) — otherwise an older lost-webhook receipt is skipped.
        mock_receipts.return_value = []
        services.sync_purchases()
        _, kwargs = mock_receipts.call_args
        assert kwargs["since"] == services._loyverse_ts(t1 - timedelta(minutes=5))


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


def _recent_receipt(customer_id, number, total, *, line_items=None, receipt_type="SALE"):
    """A receipt stamped ``now`` so it falls inside 'today'/rolling-window queries."""
    return _receipt(customer_id, number, total, receipt_type=receipt_type,
                    line_items=line_items, date=timezone.now().isoformat())


class TestLoyverseWebhook:
    """F17: near-real-time receipt push. Shared secret, fail-closed, idempotent."""

    def test_missing_secret_is_fail_closed(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = ""  # not configured
        resp = api_client.post(
            reverse("cafeteria-loyverse-webhook"),
            {"receipts": [_receipt("loy-x", "R-1", 30)]},
            format="json", HTTP_X_WEBHOOK_TOKEN="anything")
        assert resp.status_code == 401

    def test_wrong_token_rejected(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = "s3cr3t"
        resp = api_client.post(
            reverse("cafeteria-loyverse-webhook"),
            {"receipts": [_receipt("loy-x", "R-1", 30)]},
            format="json", HTTP_X_WEBHOOK_TOKEN="wrong")
        assert resp.status_code == 401
        assert CafeteriaTransaction.objects.count() == 0

    def test_valid_webhook_records_and_debits(self, api_client, settings, mailoutbox):
        settings.LOYVERSE_WEBHOOK_SECRET = "s3cr3t"
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))

        resp = api_client.post(
            reverse("cafeteria-loyverse-webhook"),
            {"receipts": [_recent_receipt("loy-buyer", "R-1", 30)]},
            format="json", HTTP_X_WEBHOOK_TOKEN="s3cr3t")

        assert resp.status_code == 200, resp.data
        assert resp.data["created"] == 1
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("70")
        assert Notification.objects.filter(user=parent).exists()

    def test_webhook_is_idempotent_with_poll(self, api_client, settings):
        """A webhook delivery that races the cron poll must not double-debit."""
        settings.LOYVERSE_WEBHOOK_SECRET = "s3cr3t"
        student = StudentProfileFactory(loyverse_id="loy-buyer")
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        payload = {"receipts": [_recent_receipt("loy-buyer", "R-1", 30)]}

        api_client.post(reverse("cafeteria-loyverse-webhook"), payload,
                        format="json", HTTP_X_WEBHOOK_TOKEN="s3cr3t")
        # Same receipt again (retry / overlap) → no-op.
        resp = api_client.post(reverse("cafeteria-loyverse-webhook"), payload,
                               format="json", HTTP_X_WEBHOOK_TOKEN="s3cr3t")
        assert resp.data["created"] == 0
        assert CafeteriaTransaction.objects.filter(loyverse_receipt_id="R-1").count() == 1
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("70")

    def test_single_receipt_payload_shape(self, api_client, settings):
        """Accepts a bare receipt object (not wrapped in a 'receipts' list)."""
        settings.LOYVERSE_WEBHOOK_SECRET = "s3cr3t"
        student = StudentProfileFactory(loyverse_id="loy-buyer")
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        resp = api_client.post(
            reverse("cafeteria-loyverse-webhook"),
            _recent_receipt("loy-buyer", "R-9", 25),
            format="json", HTTP_X_WEBHOOK_TOKEN="s3cr3t")
        assert resp.status_code == 200, resp.data
        assert resp.data["created"] == 1

    def test_secret_in_url_path_records(self, api_client, settings):
        """Loyverse dashboard / access-token webhooks send no headers, so the
        secret rides in the URL path: .../webhook/<secret>/."""
        settings.LOYVERSE_WEBHOOK_SECRET = "s3cr3t"
        student = StudentProfileFactory(loyverse_id="loy-buyer")
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        resp = api_client.post(
            reverse("cafeteria-loyverse-webhook-token", args=["s3cr3t"]),
            {"receipts": [_recent_receipt("loy-buyer", "R-url", 25)]},
            format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data["created"] == 1

    def test_wrong_url_path_secret_rejected(self, api_client, settings):
        settings.LOYVERSE_WEBHOOK_SECRET = "s3cr3t"
        resp = api_client.post(
            reverse("cafeteria-loyverse-webhook-token", args=["wrong"]),
            {"receipts": []}, format="json")
        assert resp.status_code == 401

    def test_loyverse_signature_records(self, api_client, settings):
        """OAuth-created webhooks sign the raw body with hex SHA-1 HMAC."""
        import hashlib
        import hmac as _hmac
        import json
        settings.LOYVERSE_WEBHOOK_SECRET = "s3cr3t"
        student = StudentProfileFactory(loyverse_id="loy-buyer")
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        raw = json.dumps({"receipts": [_recent_receipt("loy-buyer", "R-sig", 15)]})
        sig = _hmac.new(b"s3cr3t", raw.encode(), hashlib.sha1).hexdigest()
        resp = api_client.post(
            reverse("cafeteria-loyverse-webhook"), raw,
            content_type="application/json", HTTP_X_LOYVERSE_SIGNATURE=sig)
        assert resp.status_code == 200, resp.data
        assert resp.data["created"] == 1


class TestSpendingBudgets:
    """F13: parent-set daily/weekly caps + overspend alerts."""

    @patch("apps.cafeteria.services.get_receipts")
    def test_daily_budget_overspend_alerts_once(self, mock_receipts):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("500"),
            daily_spend_limit=Decimal("50"))

        # A 60-peso purchase exceeds the 50/day cap.
        mock_receipts.return_value = [_recent_receipt("loy-buyer", "R-1", 60)]
        services.sync_purchases()

        alerts = Notification.objects.filter(user=parent, title="Límite de gasto alcanzado")
        assert alerts.count() == 1
        assert "límite diario" in alerts.first().message

        # A second purchase the same day must not re-alert (deduped).
        mock_receipts.return_value = [_recent_receipt("loy-buyer", "R-2", 10)]
        services.sync_purchases()
        assert Notification.objects.filter(
            user=parent, title="Límite de gasto alcanzado").count() == 1

    @patch("apps.cafeteria.services.get_receipts")
    def test_no_alert_when_under_budget(self, mock_receipts):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("500"),
            daily_spend_limit=Decimal("100"))
        mock_receipts.return_value = [_recent_receipt("loy-buyer", "R-1", 30)]
        services.sync_purchases()
        assert not Notification.objects.filter(
            user=parent, title="Límite de gasto alcanzado").exists()

    @patch("apps.cafeteria.services.get_receipts")
    def test_no_alert_when_budget_disabled(self, mock_receipts):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("500"))  # limits 0
        mock_receipts.return_value = [_recent_receipt("loy-buyer", "R-1", 400)]
        services.sync_purchases()
        assert not Notification.objects.filter(
            user=parent, title="Límite de gasto alcanzado").exists()

    def test_parent_can_set_budget(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        api_client.force_authenticate(user=parent)
        resp = api_client.patch(
            reverse("cafeteria-budget", args=[student.id]),
            {"daily_spend_limit": "75.00", "weekly_spend_limit": "300.00"},
            format="json")
        assert resp.status_code == 200, resp.data
        cb = CafeteriaBalance.objects.get(student=student)
        assert cb.daily_spend_limit == Decimal("75.00")
        assert cb.weekly_spend_limit == Decimal("300.00")

    def test_cannot_set_budget_for_other_family(self, api_client):
        outsider = ParentFactory()
        student = StudentProfileFactory(parents=[ParentFactory()])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        api_client.force_authenticate(user=outsider)
        resp = api_client.patch(
            reverse("cafeteria-budget", args=[student.id]),
            {"daily_spend_limit": "10.00"}, format="json")
        assert resp.status_code == 403

    def test_budget_serializer_requires_a_field(self):
        from apps.cafeteria.serializers import SpendLimitsSerializer
        assert not SpendLimitsSerializer(data={}).is_valid()
        assert SpendLimitsSerializer(data={"daily_spend_limit": "20"}).is_valid()


class TestSpendingCategories:
    """F14: coarse category breakdown from line-item names."""

    def test_categorize_item(self):
        from apps.cafeteria.services import categorize_item
        assert categorize_item("Torta de jamón") == "Comida"
        assert categorize_item("Jugo de naranja") == "Bebidas"
        assert categorize_item("Café con leche") == "Bebidas"
        assert categorize_item("Sabritas") == "Snacks"
        assert categorize_item("Cuaderno") == "Otros"
        assert categorize_item("") == "Otros"

    @patch("apps.cafeteria.services.get_receipts")
    def test_receipt_items_carry_category(self, mock_receipts):
        student = StudentProfileFactory(loyverse_id="loy-buyer")
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        mock_receipts.return_value = [
            _recent_receipt("loy-buyer", "R-1", 30, line_items=[
                {"item_name": "Torta", "quantity": 1, "total_money": 20},
                {"item_name": "Agua", "quantity": 1, "total_money": 10},
            ]),
        ]
        services.sync_purchases()
        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id="R-1")
        cats = {i["name"]: i["category"] for i in tx.items}
        assert cats == {"Torta": "Comida", "Agua": "Bebidas"}

    @patch("apps.cafeteria.services.get_receipts")
    def test_categories_endpoint_aggregates(self, mock_receipts, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("500"))
        mock_receipts.return_value = [
            _recent_receipt("loy-buyer", "R-1", 30, line_items=[
                {"item_name": "Torta", "quantity": 1, "total_money": 20},
                {"item_name": "Jugo", "quantity": 1, "total_money": 10},
            ]),
            _recent_receipt("loy-buyer", "R-2", 15, line_items=[
                {"item_name": "Sabritas", "quantity": 1, "total_money": 15},
            ]),
        ]
        services.sync_purchases()

        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("cafeteria-spending-categories"))
        assert resp.status_code == 200, resp.data
        by_cat = {c["category"]: c["total"] for c in resp.data["categories"]}
        assert by_cat["Comida"] == 20.0
        assert by_cat["Bebidas"] == 10.0
        assert by_cat["Snacks"] == 15.0
        assert resp.data["total"] == 45.0


class TestSpendingDigest:
    """F15: one roll-up per family instead of / alongside per-purchase pings."""

    @patch("apps.cafeteria.services.get_receipts")
    def test_digest_mode_suppresses_per_purchase_and_digest_summarises(
            self, mock_receipts, settings):
        settings.CAFETERIA_PURCHASE_DIGEST = True
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("500"))
        mock_receipts.return_value = [
            _recent_receipt("loy-buyer", "R-1", 30),
            _recent_receipt("loy-buyer", "R-2", 20),
        ]
        services.sync_purchases()

        # Digest mode: no immediate per-purchase notification.
        assert not Notification.objects.filter(
            user=parent, title="Compra en cafetería").exists()

        call_command("send_spending_digest", period="daily")
        digest = Notification.objects.filter(
            user=parent, title__startswith="Resumen de cafetería").first()
        assert digest is not None
        assert "$50.00" in digest.message  # 30 + 20 total

    @patch("apps.cafeteria.services.get_receipts")
    def test_digest_skips_families_without_spend(self, mock_receipts):
        ParentFactory()
        StudentProfileFactory(loyverse_id="loy-buyer")
        mock_receipts.return_value = []
        services.sync_purchases()
        call_command("send_spending_digest", period="weekly")
        assert not Notification.objects.filter(
            title__startswith="Resumen de cafetería").exists()


class TestReviewFixes:
    """Regression tests for the adversarial-review findings on the cafetería diff."""

    def test_low_balance_alert_claim_is_race_safe(self):
        """Two concurrent record paths each hold a stale (None) balance row; the
        atomic claim must let only ONE send the low-balance alert."""
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        cb = CafeteriaBalance.objects.create(
            student=student, balance=Decimal("20"), low_balance_threshold=Decimal("50"))
        now = timezone.now()
        # Two independent reads, both seeing last_low_balance_alert_at = None.
        cb1 = CafeteriaBalance.objects.get(pk=cb.pk)
        cb2 = CafeteriaBalance.objects.get(pk=cb.pk)
        n1 = services._maybe_low_balance_alert(cb1, now)
        n2 = services._maybe_low_balance_alert(cb2, now)
        assert n1 > 0 and n2 == 0
        assert Notification.objects.filter(
            user=parent, title="Saldo bajo en cafetería").count() == 1

    def test_budget_alert_claim_is_race_safe(self):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        cb = CafeteriaBalance.objects.create(
            student=student, balance=Decimal("500"), daily_spend_limit=Decimal("50"))
        # A purchase today pushes spend over the daily cap.
        CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal("60"), date=timezone.now())
        now = timezone.now()
        cb1 = CafeteriaBalance.objects.get(pk=cb.pk)
        cb2 = CafeteriaBalance.objects.get(pk=cb.pk)
        n1 = services._maybe_budget_alert(cb1, now)
        n2 = services._maybe_budget_alert(cb2, now)
        assert n1 > 0 and n2 == 0
        assert Notification.objects.filter(
            user=parent, title="Límite de gasto alcanzado").count() == 1

    def test_admin_balance_list_omits_spend(self, api_client):
        """Admin wide balance list must keep today/week spend null (no per-row
        aggregates) — the serializer's documented cheap-admin contract."""
        student = StudentProfileFactory()
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("cafeteria-balance"))
        assert resp.status_code == 200
        assert all(row["today_spend"] is None and row["week_spend"] is None
                   for row in resp.data)

    def test_parent_balance_includes_spend(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("100"))
        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("cafeteria-balance"))
        assert resp.status_code == 200
        assert resp.data[0]["today_spend"] is not None

    def test_webhook_non_ascii_token_is_401_not_500(self, api_client, settings):
        """A non-ASCII X-Webhook-Token must yield a clean 401, not a 500 from
        hmac.compare_digest raising on non-ASCII str."""
        settings.LOYVERSE_WEBHOOK_SECRET = "s3cr3t"
        resp = api_client.post(
            reverse("cafeteria-loyverse-webhook"), {"receipts": []},
            format="json", HTTP_X_WEBHOOK_TOKEN="\xf1\xf1\xf1")
        assert resp.status_code == 401

    @patch("apps.cafeteria.services.get_receipts")
    def test_categories_reconcile_with_null_line_totals(self, mock_receipts, api_client):
        """A receipt whose line items carry no total_money still counts its full
        amount (shortfall → 'Otros'), so the category total matches spend."""
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-buyer", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("500"))
        mock_receipts.return_value = [
            _recent_receipt("loy-buyer", "R-1", 50, line_items=[
                {"item_name": "Combo del día", "quantity": 1},  # no total_money
            ]),
        ]
        services.sync_purchases()
        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("cafeteria-spending-categories"))
        assert resp.status_code == 200
        assert resp.data["total"] == 50.0
        by_cat = {c["category"]: c["total"] for c in resp.data["categories"]}
        assert by_cat.get("Otros") == 50.0


class TestCafeteriaCards:
    """Digital student card endpoint: identity + code (QR/barcode) + stats."""

    def test_parent_sees_child_card_with_code_and_stats(self, api_client):
        from apps.cafeteria.models import LoyverseProfile
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-card-1", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("120"))
        LoyverseProfile.objects.create(
            student=student, loyverse_id="loy-card-1", customer_code="10020",
            total_visits=267, total_spent=Decimal("111"), total_points=Decimal("70"))
        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("cafeteria-cards"))
        assert resp.status_code == 200
        card = resp.data[0]
        assert card["code"] == "10020"           # POS scans this
        assert card["balance"] == "120.00"
        assert card["linked"] is True
        assert card["loyverse"]["total_visits"] == 267
        assert card["loyverse"]["total_spent"] == "111.00"

    def test_code_falls_back_to_student_id_when_no_loyverse_profile(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="", parents=[parent])
        CafeteriaBalance.objects.create(student=student, balance=Decimal("0"))
        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("cafeteria-cards"))
        assert resp.data[0]["code"] == student.student_id
        assert resp.data[0]["linked"] is False
        assert resp.data[0]["loyverse"] is None

    def test_outsider_sees_no_cards(self, api_client):
        outsider = ParentFactory()
        StudentProfileFactory(parents=[ParentFactory()])
        api_client.force_authenticate(user=outsider)
        resp = api_client.get(reverse("cafeteria-cards"))
        assert resp.data == []


class TestLoyverseReadOnlyHistory:
    """Read-only recent purchases pulled live from Loyverse (no ledger writes)."""

    @patch("apps.cafeteria.services.get_recent_transactions")
    def test_returns_parsed_readonly_receipts(self, mock_get, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-h1", parents=[parent])
        mock_get.return_value = [
            {"customer_id": "loy-h1", "receipt_number": "R-1", "total_money": 30,
             "receipt_date": "2026-01-01T12:00:00.000Z",
             "line_items": [{"item_name": "Torta", "quantity": 1, "total_money": 30}]},
        ]
        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("cafeteria-loyverse-history"), {"student": student.id})
        assert resp.status_code == 200
        assert resp.data["linked"] is True
        assert len(resp.data["receipts"]) == 1
        assert resp.data["receipts"][0]["amount"] == "30.00"
        assert resp.data["receipts"][0]["items"][0]["name"] == "Torta"
        # READ-ONLY: nothing written to the local ledger.
        assert CafeteriaTransaction.objects.count() == 0

    @patch("apps.cafeteria.services.get_recent_transactions")
    def test_drops_foreign_customer_receipts(self, mock_get, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-h2", parents=[parent])
        mock_get.return_value = [
            {"customer_id": "loy-h2", "receipt_number": "R-1", "total_money": 30,
             "receipt_date": "2026-01-01T12:00:00.000Z", "line_items": []},
            {"customer_id": "stranger", "receipt_number": "R-2", "total_money": 99,
             "receipt_date": "2026-01-01T12:00:00.000Z", "line_items": []},
        ]
        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("cafeteria-loyverse-history"), {"student": student.id})
        assert len(resp.data["receipts"]) == 1

    def test_unlinked_student_returns_empty(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="", parents=[parent])
        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("cafeteria-loyverse-history"), {"student": student.id})
        assert resp.data == {"linked": False, "receipts": []}

    @patch("apps.cafeteria.services.get_recent_transactions")
    def test_failsoft_when_loyverse_unreachable(self, mock_get, api_client):
        mock_get.side_effect = RuntimeError("boom")
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-h3", parents=[parent])
        api_client.force_authenticate(user=parent)
        resp = api_client.get(reverse("cafeteria-loyverse-history"), {"student": student.id})
        assert resp.status_code == 200
        assert resp.data["receipts"] == []
        assert resp.data.get("error") == "loyverse_unreachable"


class TestPointsWalletExtraction:
    """Bug fix 2026-08-13: the store charges the wallet via Loyverse points
    redemption (receipt-level ``DISCOUNT_BY_POINTS``), so ``total_money`` is
    only the cash/card portion. The old code debited ``total_money`` — points
    sales recorded $0.00, wallets never decreased, parents got "$0.00" alerts.
    """

    @patch("apps.cafeteria.services.get_receipts")
    def test_real_store_receipt_debits_points_not_total_money(self, mock_receipts):
        """Trimmed copy of live receipt 3-1023: $10 'Agua sabor' fully paid by
        points → total_money 0, DISCOUNT_BY_POINTS 10. Must debit $10."""
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-real", parents=[parent])
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("100"), last_synced=timezone.now())
        mock_receipts.return_value = [{
            "receipt_number": "3-1023",
            "receipt_type": "SALE",
            "receipt_date": "2026-08-12T22:42:08.000Z",
            "total_money": 0.0,
            "points_earned": 0.0,
            "points_deducted": 0.0,
            "points_balance": 5575.0,
            "customer_id": "loy-real",
            "total_discount": 10.0,
            "total_discounts": [
                {"type": "DISCOUNT_BY_POINTS", "name": "Discount by points",
                 "money_amount": 10.0},
            ],
            "line_items": [
                {"item_name": "Agua sabor", "variant_name": "Chica",
                 "quantity": 1, "price": 10.0, "gross_total_money": 10.0,
                 "total_money": 0.0, "total_discount": 10.0,
                 "line_discounts": [
                     {"type": "DISCOUNT_BY_POINTS", "name": "Discount by points",
                      "money_amount": 10.0},
                 ]},
            ],
            "payments": [{"name": "Efectivo", "type": "CASH", "money_amount": 0.0}],
        }]

        result = services.sync_purchases()

        assert result["created"] == 1
        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id="3-1023")
        assert tx.amount == Decimal("10")
        assert tx.balance_after == Decimal("90")
        # Line value = money + points paid, so the category donut doesn't
        # collapse into "Otros" on points sales (line total_money is 0).
        assert Decimal(tx.items[0]["total"]) == Decimal("10")
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("90")
        note = Notification.objects.get(user=parent)
        assert "$10.00" in note.message
        assert "$0.00" not in note.message

    @patch("apps.cafeteria.services.get_receipts")
    def test_cash_only_receipt_is_skipped_entirely(self, mock_receipts):
        """A cash sale merely attached to the student must not touch the wallet,
        create a ledger row, or notify — and is counted as skipped."""
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-cash", parents=[parent])
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("100"), last_synced=timezone.now())
        mock_receipts.return_value = [_receipt("loy-cash", "R-cash", 0, cash=30)]

        result = services.sync_purchases()

        assert result["created"] == 0
        assert result["skipped"] == 1
        assert CafeteriaTransaction.objects.count() == 0
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("100")
        assert Notification.objects.filter(user=parent).count() == 0

    @patch("apps.cafeteria.services.get_receipts")
    def test_partial_points_plus_cash_debits_only_points(self, mock_receipts):
        student = StudentProfileFactory(loyverse_id="loy-mix")
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("50"), last_synced=timezone.now())
        mock_receipts.return_value = [_receipt("loy-mix", "R-mix", 10, cash=15)]

        services.sync_purchases()

        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id="R-mix")
        assert tx.amount == Decimal("10")
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("40")

    def test_points_deducted_and_discount_do_not_double_debit(self):
        """Some Loyverse flows report the redemption in ``points_deducted`` —
        if BOTH carry it, take the max, never the sum (R1: no double-count)."""
        r = _receipt("c", "R-both", 10, points_deducted=10)
        amount, *_ = services._parse_receipt(r)
        assert amount == Decimal("10")

    def test_points_deducted_alone_debits(self):
        r = _receipt("c", "R-pd", 0, points_deducted=12)
        amount, *_ = services._parse_receipt(r)
        assert amount == Decimal("12")

    def test_points_earned_reduces_debit_clamped_at_zero(self):
        r = _receipt("c", "R-earn", 10, points_earned=25)
        amount, *_ = services._parse_receipt(r)
        assert amount == Decimal("0")

    @patch("apps.cafeteria.services.get_receipts")
    def test_refund_with_points_credits_wallet(self, mock_receipts):
        student = StudentProfileFactory(loyverse_id="loy-ref")
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("90"), last_synced=timezone.now())
        mock_receipts.return_value = [
            _receipt("loy-ref", "R-refund", 10, receipt_type="REFUND")]

        services.sync_purchases()

        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id="R-refund")
        assert tx.transaction_type == CafeteriaTransaction.TxType.REFUND
        assert tx.amount == Decimal("10")
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("100")


class TestRepairWalletLedger:
    """One-time repair command for the points-debit bug: re-price $0 rows and
    reconcile drifted balances to Loyverse total_points."""

    _CMD = "apps.cafeteria.management.commands.repair_wallet_ledger"

    @patch(f"{_CMD}.get_all_customers")
    @patch(f"{_CMD}.get_receipts")
    def test_apply_reprices_zero_rows_and_reconciles(self, mock_receipts, mock_customers):
        parent = ParentFactory()
        student = StudentProfileFactory(loyverse_id="loy-fix", parents=[parent])
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("5768"), last_synced=timezone.now())
        # A $0 row recorded by the old code for a points-paid receipt.
        CafeteriaTransaction.objects.create(
            student=student,
            transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal("0"), loyverse_receipt_id="3-1023",
            date=timezone.now() - timedelta(days=1), balance_after=Decimal("5768"),
        )
        mock_receipts.return_value = [_receipt("loy-fix", "3-1023", 10)]
        mock_customers.return_value = [{"id": "loy-fix", "total_points": 5575}]

        call_command("repair_wallet_ledger", "--apply")

        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id="3-1023")
        assert tx.amount == Decimal("10")          # history re-priced…
        cb = CafeteriaBalance.objects.get(student=student)
        assert cb.balance == Decimal("5575")       # …and balance = Loyverse points
        adj = CafeteriaTransaction.objects.get(
            transaction_type=CafeteriaTransaction.TxType.ADJUSTMENT)
        assert adj.balance_after == Decimal("5575")
        # Silent repair: reconcile must NOT blast guardians with notifications.
        assert Notification.objects.filter(user=parent).count() == 0

    @patch(f"{_CMD}.get_all_customers")
    @patch(f"{_CMD}.get_receipts")
    def test_dry_run_changes_nothing(self, mock_receipts, mock_customers):
        student = StudentProfileFactory(loyverse_id="loy-dry")
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("100"), last_synced=timezone.now())
        mock_receipts.return_value = []
        mock_customers.return_value = [{"id": "loy-dry", "total_points": 60}]

        call_command("repair_wallet_ledger")   # no --apply

        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("100")
        assert CafeteriaTransaction.objects.count() == 0

    @patch(f"{_CMD}.get_all_customers")
    @patch(f"{_CMD}.get_receipts")
    def test_pending_pos_topup_is_skipped(self, mock_receipts, mock_customers):
        """A completed online top-up not yet loaded into the POS means the local
        ledger legitimately leads Loyverse — reconciling would erase real money."""
        student = StudentProfileFactory(loyverse_id="loy-pend")
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("300"), last_synced=timezone.now())
        TopUpRequest.objects.create(
            student=student, amount=Decimal("200"),
            method=TopUpRequest.Method.ONLINE,
            status=TopUpRequest.Status.COMPLETED, pos_loaded_at=None,
        )
        mock_receipts.return_value = []
        mock_customers.return_value = [{"id": "loy-pend", "total_points": 100}]

        call_command("repair_wallet_ledger", "--apply")

        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("300")


class TestLedgerSumInvariant:
    """The books must balance: opening seed + Σ(signed ledger effects) == balance.

    Exercises every mutation path in one mixed sequence — opening seed (not a
    ledger row), online top-up credit, POS purchase debit, manual adjustment,
    and a purchase refund — then proves the ledger *derives* the balance and
    that each row's ``balance_after`` snapshot chains from the previous one.
    """

    @patch("apps.cafeteria.services.get_customer_by_id")
    def test_mixed_sequence_sums_to_balance(self, mock_get):
        from apps.payments.models import Payment

        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent], loyverse_id="loy-sum")

        # Opening seed from Loyverse: $100 (no ledger row — R1 seed-once).
        mock_get.return_value = {"total_points": 100}
        opening = services.sync_student_balance(student)
        assert opening == Decimal("100")

        # Online top-up +150 via the webhook credit path.
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal("150"),
            method=TopUpRequest.Method.ONLINE,
        )
        payment = Payment.objects.create(
            user=parent, payment_type=Payment.Type.CAFETERIA,
            amount=Decimal("150"), related_topup=topup,
            status=Payment.Status.PENDING,
        )
        payment.mark_success("GP-SUM-1", {"status": "CAPTURED"})
        services.complete_online_topup(payment)

        # POS purchase -40 via the shared receipt record path.
        services.record_receipts([_receipt("loy-sum", "R-SUM-1", 40)])

        # Manual audited adjustment -10.
        services.adjust_balance(student, Decimal("-10"), "cobro duplicado")

        # Refund the POS purchase (+40, audited).
        purchase = CafeteriaTransaction.objects.get(
            student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE)
        services.refund_transaction(purchase, reason="devolución de compra")

        cb = CafeteriaBalance.objects.get(student=student)
        expected = Decimal("100") + 150 - 40 - 10 + 40
        assert cb.balance == expected == Decimal("240")

        txs = list(CafeteriaTransaction.objects.filter(student=student).order_by("pk"))
        assert len(txs) == 4
        # 1. Ledger derives the balance: opening + Σ signed effects == balance.
        assert opening + sum(services._net_effect(t) for t in txs) == cb.balance
        # 2. balance_after chains: each snapshot = previous + this row's effect.
        running = opening
        for tx in txs:
            running += services._net_effect(tx)
            assert tx.balance_after == running
        assert txs[-1].balance_after == cb.balance
