"""
Staff work on Banorte operations (payments.multicobros) and the admin flows
around them: "Conciliar con MultiCobros", the pending report, the MultiCobros
verification, simulations kept out of the POS, card refunds, failure labels.

The Banorte fixtures and helpers come from ``test_banorte``.
"""

import json
from datetime import timedelta
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.core.models import AuditLog
from apps.payments import test_banorte as tb
from apps.payments.models import BanorteCheckout, Payment
from apps.payments.multicobros import needs_review_q, review_reason
from apps.payments.services import fail_checkout_if_still_open
from apps.payments.test_banorte import _bank_answer, _family, _report, _start

# The Banorte fixtures (fake configuration, certificate, an opened checkout).
banorte = tb.banorte
cert_bundle = tb.cert_bundle
opened = tb.opened

pytestmark = pytest.mark.django_db


def _open(api_client, settings_, *, live=True, amount="200.00"):
    settings_.PAYMENTS_LIVE = live
    parent, student = _family()
    resp = _start(api_client, parent, student, amount=amount)
    assert resp.status_code == 201, resp.data
    return BanorteCheckout.objects.get(payment_id=resp.data["payment_id"])


def _alerts(mailoutbox, subject_word):
    """Emails to the admins (family notifications are sent too)."""
    return [m for m in mailoutbox if subject_word in m.subject]


def _balance(student):
    row = CafeteriaBalance.objects.filter(student=student).first()
    return row.balance if row else Decimal("0")


def _reconcile(api_client, payment_id, **body):
    api_client.force_authenticate(user=body.pop("admin", None) or AdminFactory())
    return api_client.post(
        reverse("admin-payment-banorte-reconcile", args=[payment_id]), body, format="json"
    )


def _approve(api_client, payment_id, **extra):
    body = {
        "outcome": "approved",
        "referencia": "248233587990",
        "codigo_aut": "214414",
        "amount": "200.00",
    }
    body.update(extra)
    return _reconcile(api_client, payment_id, **body)


# ── Conciliar con MultiCobros ────────────────────────────────


class TestReconcileApproved:
    def test_expired_payment_is_credited_once_verified_and_a_late_answer_is_a_no_op(
        self, api_client, banorte
    ):
        checkout = _open(api_client, banorte)
        student = checkout.payment.related_topup.student
        assert fail_checkout_if_still_open(checkout.payment_id, reason="t", stage="expire")
        late_answer = _bank_answer(checkout)  # what the parent's browser still holds

        admin = AdminFactory()
        resp = _approve(api_client, checkout.payment_id, admin=admin, note="Visto en MC")
        assert resp.status_code == 200, resp.data
        assert resp.data["detail"] == "settled"
        assert resp.data["payment"]["status"] == "success"
        assert _balance(student) == Decimal("200.00")

        checkout.refresh_from_db()
        payment = checkout.payment
        assert payment.status == Payment.Status.SUCCESS
        assert payment.gateway_ref == "248233587990"
        assert checkout.resultado_payw == "A" and checkout.codigo_aut == "214414"
        assert checkout.verified_by == admin and not checkout.needs_verification
        assert checkout.key_material == ""
        assert TopUpRequest.objects.get(pk=payment.related_topup_id).status == "completed"
        assert AuditLog.objects.filter(context="payments.banorte.reconcile").exists()

        # The parent's browser answers after all: nothing moves again.
        api_client.force_authenticate(user=payment.user)
        again = _report(api_client, payment.pk, "success", late_answer)
        assert again.status_code == 200
        assert _balance(student) == Decimal("200.00")
        assert CafeteriaTransaction.objects.filter(student=student).count() == 1

        # Verified by the reconciliation: it can go straight into the POS.
        api_client.force_authenticate(user=admin)
        loaded = api_client.post(reverse("admin-topup-pos-loaded", args=[payment.related_topup_id]))
        assert loaded.status_code == 200, loaded.data

    def test_pending_payment_and_idempotent_replay(self, api_client, banorte):
        checkout = _open(api_client, banorte)
        student = checkout.payment.related_topup.student
        assert _approve(api_client, checkout.payment_id).status_code == 200
        replay = _approve(api_client, checkout.payment_id)
        assert replay.status_code == 200 and replay.data["detail"] == "already_processed"
        other = _approve(api_client, checkout.payment_id, referencia="111")
        assert other.status_code == 409
        assert _balance(student) == Decimal("200.00")

    @pytest.mark.parametrize(
        "extra,code",
        [
            ({"amount": "150.00"}, "amount_mismatch"),
            ({"referencia": "ABC"}, "invalid_reference"),
            ({"codigo_aut": ""}, "invalid_auth_code"),
        ],
    )
    def test_bad_input_moves_nothing(self, api_client, banorte, extra, code):
        checkout = _open(api_client, banorte)
        resp = _approve(api_client, checkout.payment_id, **extra)
        assert resp.status_code == 400 and resp.data["code"] == code
        assert Payment.objects.get(pk=checkout.payment_id).status == Payment.Status.PENDING

    def test_a_bank_decline_is_final(self, api_client, banorte):
        checkout = _open(api_client, banorte)
        api_client.force_authenticate(user=checkout.payment.user)
        _report(
            api_client, checkout.payment_id, "success", _bank_answer(checkout, resultadoPayw="D")
        )
        resp = _approve(api_client, checkout.payment_id)
        assert resp.status_code == 409

    def test_simulation_cannot_be_reconciled_when_live(self, api_client, banorte):
        checkout = _open(api_client, banorte, live=False)
        banorte.PAYMENTS_LIVE = True
        resp = _approve(api_client, checkout.payment_id)
        assert resp.status_code == 400 and resp.data["code"] == "simulation"

    def test_admin_only(self, api_client, banorte):
        checkout = _open(api_client, banorte)
        api_client.force_authenticate(user=checkout.payment.user)
        url = reverse("admin-payment-banorte-reconcile", args=[checkout.payment_id])
        assert api_client.post(url, {"outcome": "not_found", "note": "x"}).status_code == 403


class TestReconcileNotFound:
    def test_closes_it_but_a_genuine_late_approval_still_credits(self, api_client, banorte):
        checkout = _open(api_client, banorte)
        student = checkout.payment.related_topup.student
        Payment.objects.filter(pk=checkout.payment_id).update(
            created_at=timezone.now() - timedelta(hours=2)
        )
        assert review_reason(Payment.objects.get(pk=checkout.payment_id), checkout)

        missing_note = _reconcile(api_client, checkout.payment_id, outcome="not_found")
        assert missing_note.status_code == 400
        resp = _reconcile(
            api_client, checkout.payment_id, outcome="not_found", note="No aparece en MC"
        )
        assert resp.status_code == 200, resp.data
        assert resp.data["payment"]["failure_reason"] == "not_found"
        payment = Payment.objects.get(pk=checkout.payment_id)
        assert payment.is_soft_failed()
        assert review_reason(payment, checkout) is None
        assert not Payment.objects.filter(needs_review_q(), pk=payment.pk).exists()

        checkout.refresh_from_db()
        assert checkout.key_material
        api_client.force_authenticate(user=payment.user)
        _report(api_client, payment.pk, "success", _bank_answer(checkout))
        assert Payment.objects.get(pk=payment.pk).status == Payment.Status.SUCCESS
        assert _balance(student) == Decimal("200.00")


# ── what needs a MultiCobros check ───────────────────────────


class TestPendingReport:
    def _admin(self):
        return AdminFactory(email="direccion@interlaken.test")

    def test_lists_superseded_attempts_and_emails_only_news(self, api_client, banorte, mailoutbox):
        self._admin()
        banorte.PAYMENTS_LIVE = True
        parent, student = _family()
        first = _start(api_client, parent, student).data["payment_id"]
        second = _start(api_client, parent, student).data["payment_id"]
        superseded = Payment.objects.get(pk=first)
        assert superseded.failure_stage() == "supersede"
        control = BanorteCheckout.objects.get(payment_id=first).control_number

        out = StringIO()
        call_command("banorte_pending_report", stdout=out)
        assert control in out.getvalue()
        assert BanorteCheckout.objects.get(payment_id=second).control_number not in out.getvalue()
        reports = _alerts(mailoutbox, "por revisar")
        assert len(reports) == 1
        assert "Conciliar con MultiCobros" in reports[0].body
        assert "ajuste manual" in reports[0].body  # warns against it

        call_command("banorte_pending_report", stdout=StringIO())
        assert len(_alerts(mailoutbox, "por revisar")) == 1  # nothing new: stays quiet

        assert fail_checkout_if_still_open(second, reason="t", stage="expire")
        call_command("banorte_pending_report", stdout=StringIO())
        assert len(_alerts(mailoutbox, "por revisar")) == 2  # a new operation to check

    def test_the_filter_and_the_report_agree(self, api_client, banorte):
        banorte.PAYMENTS_LIVE = True
        made = [_open(api_client, banorte) for _ in range(5)]
        fresh, old, expired, cancelled, approved = made
        Payment.objects.filter(pk=old.payment_id).update(
            created_at=timezone.now() - timedelta(hours=2)
        )
        fail_checkout_if_still_open(expired.payment_id, reason="t", stage="expire")
        api_client.force_authenticate(user=cancelled.payment.user)
        _report(api_client, cancelled.payment_id, "cancel", {})
        api_client.force_authenticate(user=approved.payment.user)
        _report(api_client, approved.payment_id, "success", _bank_answer(approved))

        by_rule = {
            c.payment_id
            for c in made
            if review_reason(
                Payment.objects.get(pk=c.payment_id), BanorteCheckout.objects.get(pk=c.pk)
            )
        }
        by_query = set(Payment.objects.filter(needs_review_q()).values_list("pk", flat=True))
        assert by_rule == by_query == {old.payment_id, expired.payment_id}

        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-topups"), {"needs_review": 1})
        assert {r["payment_id"] for r in resp.data["results"]} == by_rule
        row = next(r for r in resp.data["results"] if r["payment_id"] == expired.payment_id)
        assert row["banorte"]["can_reconcile"] is True
        assert row["banorte"]["failure_label"] == "Expirado"
        assert "expiró" in row["banorte"]["review_reason"]


# ── MultiCobros verification ─────────────────────────────────


class TestVerify:
    @pytest.fixture
    def approved(self, api_client, banorte):
        checkout = _open(api_client, banorte)
        _report(api_client, checkout.payment_id, "success", _bank_answer(checkout))
        checkout.refresh_from_db()
        assert checkout.needs_verification
        return checkout

    def _verify(self, api_client, checkout, **body):
        api_client.force_authenticate(user=AdminFactory())
        return api_client.post(
            reverse("admin-payment-banorte-verify", args=[checkout.payment_id]), body, format="json"
        )

    def test_reference_and_amount_must_match(self, api_client, approved):
        bad_ref = self._verify(api_client, approved, referencia="1", amount="200")
        assert bad_ref.status_code == 400 and bad_ref.data["code"] == "reference_mismatch"
        bad_amount = self._verify(api_client, approved, referencia="248233587990", amount="20")
        assert bad_amount.status_code == 400 and bad_amount.data["code"] == "amount_mismatch"
        ok = self._verify(api_client, approved, referencia="248233587990", amount="$200.00")
        assert ok.status_code == 200, ok.data
        approved.refresh_from_db()
        assert approved.verified_at is not None

    def test_a_refunded_payment_is_not_verified(self, api_client, approved):
        Payment.objects.filter(pk=approved.payment_id).update(status=Payment.Status.REFUNDED)
        resp = self._verify(api_client, approved, referencia="248233587990", amount="200")
        assert resp.status_code == 400 and resp.data["code"] == "not_success"


# ── simulations never reach the POS ──────────────────────────


class TestSimulationStaysOutOfThePos:
    def test_aut_approval_is_not_loaded(self, api_client, banorte):
        from apps.cafeteria.admin_data import _pos_loaded_plan
        from apps.core.bulk import BulkSkip

        checkout = _open(api_client, banorte, live=False)
        _report(api_client, checkout.payment_id, "success", _bank_answer(checkout))
        topup = TopUpRequest.objects.get(pk=checkout.payment.related_topup_id)
        assert topup.status == TopUpRequest.Status.COMPLETED

        api_client.force_authenticate(user=AdminFactory())
        queue = api_client.get(reverse("admin-topups"), {"needs_pos": 1})
        assert queue.data["count"] == 0
        row = api_client.get(reverse("admin-topups")).data["results"][0]
        assert row["needs_pos_load"] is False and row["banorte"]["simulation"] is True

        single = api_client.post(reverse("admin-topup-pos-loaded", args=[topup.pk]))
        assert single.status_code == 400 and single.data["code"] == "simulation"
        with pytest.raises(BulkSkip, match="simulación"):
            _pos_loaded_plan(topup, {})

    def test_badge_and_dashboard_count_real_card_top_ups(self, api_client, banorte):
        from apps.core.badges import _compute_badges

        simulated = _open(api_client, banorte, live=False)
        _report(api_client, simulated.payment_id, "success", _bank_answer(simulated))
        real = _open(api_client, banorte, live=True)
        _report(api_client, real.payment_id, "success", _bank_answer(real))
        office_parent, office_child = _family()
        TopUpRequest.objects.create(student=office_child, amount=Decimal("50"))

        admin = AdminFactory()
        assert _compute_badges(admin)["cafeteria"] == 2  # cash request + real card top-up
        api_client.force_authenticate(user=admin)
        data = api_client.get(reverse("dashboard")).data
        assert data["pending_topups"] == 2
        assert data["pending_topups_office"] == 1
        assert data["pending_topups_online"] == 1


# ── refunds of card top-ups ──────────────────────────────────


class TestCardRefund:
    def _credited(self, api_client, settings_, live=True):
        checkout = _open(api_client, settings_, live=live)
        _report(api_client, checkout.payment_id, "success", _bank_answer(checkout))
        return CafeteriaTransaction.objects.get(
            loyverse_receipt_id=f"topup-payment-{checkout.payment_id}"
        )

    def test_needs_the_multicobros_confirmation(self, api_client, banorte):
        tx = self._credited(api_client, banorte)
        api_client.force_authenticate(user=AdminFactory())
        url = reverse("admin-refund", args=[tx.id])
        refused = api_client.post(url, {"reason": "Duplicado"}, format="json")
        assert refused.status_code == 400 and refused.data["code"] == "bank_refund_required"

        ok = api_client.post(
            url, {"reason": "Duplicado", "bank_refund_confirmed": True}, format="json"
        )
        assert ok.status_code == 201, ok.data
        assert ok.data["bank_refund_confirmed"] is True
        assert "MultiCobros" in ok.data["reason"] and "Duplicado" in ok.data["reason"]
        assert AuditLog.objects.filter(context="cafeteria.refund.card").exists()

    def test_a_simulation_needs_no_bank_refund(self, api_client, banorte):
        tx = self._credited(api_client, banorte, live=False)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.post(reverse("admin-refund", args=[tx.id]), {}, format="json")
        assert resp.status_code == 201, resp.data
        assert resp.data["bank_refund_confirmed"] is False


# ── the browser answer ───────────────────────────────────────


class TestBrowserAnswers:
    def test_success_without_data_stays_pending_with_a_reason(self, api_client, opened):
        _, _, checkout = opened
        resp = _report(api_client, checkout.payment_id, "success", {"status3D": "451"})
        assert resp.data["status"] == "pending"
        checkout.refresh_from_db()
        assert "451" in checkout.last_error and checkout.status_3d == "451"

    def test_3ds_cancel_is_a_soft_cancel(self, api_client, opened):
        _, _, checkout = opened
        resp = _report(api_client, checkout.payment_id, "error", {"status3D": "423"})
        assert resp.data["status"] == "failed"
        payment = Payment.objects.get(pk=checkout.payment_id)
        assert payment.failure_reason() == "cancelled" and payment.is_soft_failed()

    def test_later_callbacks_keep_the_first_meaningful_values(self, api_client, opened):
        _, _, checkout = opened
        _report(
            api_client,
            checkout.payment_id,
            "error",
            {"status3D": "200", "eci": "05", "message": "x"},
        )
        _report(api_client, checkout.payment_id, "closed", {})
        checkout.refresh_from_db()
        assert (checkout.status_3d, checkout.eci, checkout.last_error) == ("200", "05", "x")
        assert checkout.event == "closed"

    def test_merchant_configuration_errors_email_the_admins_once(
        self, api_client, opened, mailoutbox
    ):
        AdminFactory(email="direccion@interlaken.test")
        _, _, checkout = opened
        answer = _bank_answer(
            checkout,
            resultadoPayw="R",
            codigoAut=None,
            codigoPayw="PAYW-3008",
            texto="La terminal no existe",
        )
        resp = _report(api_client, checkout.payment_id, "success", answer)
        assert resp.data["status"] == "failed"
        payment = Payment.objects.get(pk=checkout.payment_id)
        assert payment.failure_reason() == "config_error"
        assert payment.failure_label() == "Error de configuración"
        alerts = _alerts(mailoutbox, "configuración")
        assert len(alerts) == 1
        assert "direccion@interlaken.test" in alerts[0].to
        assert "PAYW-3008" in alerts[0].body
        assert "Ab12" not in alerts[0].body and "EJECUCION01" not in alerts[0].body

        # The same problem on the next attempt is not emailed again.
        parent, student = _family()
        again = BanorteCheckout.objects.get(
            payment_id=_start(api_client, parent, student).data["payment_id"]
        )
        _report(
            api_client,
            again.payment_id,
            "success",
            _bank_answer(
                again,
                resultadoPayw="R",
                codigoAut=None,
                codigoPayw="PAYW-3008",
                texto="La terminal no existe",
            ),
        )
        assert len(_alerts(mailoutbox, "configuración")) == 1

    def test_aut10_alerts_too(self, api_client, opened, mailoutbox):
        AdminFactory(email="direccion@interlaken.test")
        _, _, checkout = opened
        _report(api_client, checkout.payment_id, "error", {"id": 4, "message": "auth"})
        alerts = _alerts(mailoutbox, "configuración")
        assert len(alerts) == 1 and "AUT-10" in alerts[0].body


# ── what families and staff read ─────────────────────────────


class TestLabelsAndLedger:
    def test_family_history_says_why_and_shows_the_bank_reference(self, api_client, banorte):
        cancelled = _open(api_client, banorte, live=False)
        parent = cancelled.payment.user
        api_client.force_authenticate(user=parent)
        _report(api_client, cancelled.payment_id, "cancel", {})
        rows = {r["id"]: r for r in api_client.get(reverse("payment-history")).data["results"]}
        assert rows[cancelled.payment_id]["failure_reason"] == "cancelled"
        assert rows[cancelled.payment_id]["failure_label"] == "Cancelado por el usuario"

        approved = _open(api_client, banorte, live=False)
        api_client.force_authenticate(user=approved.payment.user)
        _report(api_client, approved.payment_id, "success", _bank_answer(approved))
        detail = api_client.get(reverse("payment-detail", args=[approved.payment_id])).data
        assert detail["bank_reference"] == "248233587990"
        assert detail["auth_code"] == "214414"
        assert detail["failure_reason"] == ""

    def test_receipt_cites_the_bank_reference_and_authorisation(self, api_client, opened):
        from unittest import mock

        _, _, checkout = opened
        _report(api_client, checkout.payment_id, "success", _bank_answer(checkout))
        with mock.patch("apps.core.pdf.simple_document_pdf", return_value=b"%PDF") as pdf:
            resp = api_client.get(reverse("payment-receipt", args=[checkout.payment_id]))
        assert resp.status_code == 200
        lines = pdf.call_args.args[1]
        assert "Referencia bancaria: 248233587990" in lines
        assert "Código de autorización: 214414" in lines
        assert f"Número de control: {checkout.control_number}" in lines

    def test_admin_ledger_search_payer_and_failure_split(self, api_client, banorte):
        checkout = _open(api_client, banorte, live=False)
        api_client.force_authenticate(user=checkout.payment.user)
        _report(api_client, checkout.payment_id, "cancel", {})
        declined = _open(api_client, banorte, live=False)
        api_client.force_authenticate(user=declined.payment.user)
        _report(
            api_client, declined.payment_id, "success", _bank_answer(declined, resultadoPayw="D")
        )

        api_client.force_authenticate(user=AdminFactory())
        found = api_client.get(reverse("admin-payments"), {"q": checkout.control_number}).data
        assert [r["id"] for r in found["results"]] == [checkout.payment_id]
        row = found["results"][0]
        assert row["payer_email"] == checkout.payment.user.email
        assert row["control_number"] == checkout.control_number
        assert row["simulation"] is True

        summary = api_client.get(reverse("admin-payments-summary")).data
        assert summary["failed_by_reason"] == {"cancelled": 1, "declined": 1}

    def test_django_admin_cannot_flip_the_status(self):
        from django.contrib import admin as django_admin

        model_admin = django_admin.site._registry[Payment]
        assert "status" in model_admin.readonly_fields
        assert not model_admin.has_add_permission(None)
        assert not model_admin.has_delete_permission(None)


def test_payload_is_json_serialisable(api_client, banorte):
    checkout = _open(api_client, banorte)
    api_client.force_authenticate(user=AdminFactory())
    row = api_client.get(reverse("admin-topups")).data["results"][0]
    json.dumps(row, default=str)
    assert {"codigo_payw", "texto", "last_error", "resultado", "created_at"} <= set(row["banorte"])
    assert row["banorte"]["control_number"] == checkout.control_number
