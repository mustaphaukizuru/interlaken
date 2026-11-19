"""«Verificar en MultiCobros»: one rule for the dialog and the report upload.

``payments.multicobros.verify_approval`` is what ``AdminBanorteVerifyView``
(the per-payment dialog) and «Subir reporte de MultiCobros» both call, so the
two can never verify on different terms. The dialog's own tests
(``test_banorte``, ``test_multicobros``, ``cafeteria/test_topup_verification_flow``)
pin its answers; these pin the shared function. Every value is invented.
"""

from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria.models import TopUpRequest
from apps.core.models import AuditLog
from apps.payments.gateways.base import PaymentEvent
from apps.payments.models import BanorteCheckout, Payment
from apps.payments.multicobros import VerifyError, verify_approval
from apps.payments.settlement import settle

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin(api_client):
    user = AdminFactory()
    api_client.force_authenticate(user=user)
    return user


_seq = iter(range(1, 10_000))


def card_payment(
    amount="200.00",
    *,
    student=None,
    mode="PRD",
    resultado="A",
    settled=True,
    codigo_aut="012345",
    referencia=None,
    when=None,
):
    """An online top-up paid by card the way settlement leaves it (scheduled mode:
    PAID, waiting for the POS load), with its Banorte checkout."""
    n = next(_seq)
    parent = ParentFactory()
    student = student or StudentProfileFactory(parents=[parent], loyverse_id=f"lv-{n}")
    topup = TopUpRequest.objects.create(
        student=student, amount=Decimal(amount), method=TopUpRequest.Method.ONLINE
    )
    payment = Payment.objects.create(
        user=parent,
        payment_type=Payment.Type.CAFETERIA,
        amount=Decimal(amount),
        gateway=Payment.Gateway.BANORTE,
        related_topup=topup,
        status=Payment.Status.PENDING,
    )
    when = when or timezone.now()
    checkout = BanorteCheckout.objects.create(
        payment=payment,
        control_number=f"IK{payment.pk}TST{n:06d}",
        mode=mode,
        resultado_payw=resultado,
        referencia=f"9{n:011d}" if referencia is None else referencia,
        codigo_aut=codigo_aut,
        created_at=when,
        result_at=when if resultado else None,
    )
    if settled:
        settle(
            PaymentEvent(
                payment.pk,
                "success",
                checkout.control_number,
                {"test": "ok"},
                reference=checkout.referencia,
            ),
            actor_label="test",
        )
    checkout.refresh_from_db()
    return checkout


# ── the shared rule ──────────────────────────────────────────


class TestSharedRule:
    def test_the_dialog_goes_through_the_same_function(self, api_client, admin):
        checkout = card_payment()
        with patch("apps.payments.multicobros.verify_approval", wraps=verify_approval) as rule:
            resp = api_client.post(
                reverse("admin-payment-banorte-verify", args=[checkout.payment_id]),
                {"referencia": checkout.referencia, "amount": "200"},
                format="json",
            )
        assert resp.status_code == 200, resp.data
        rule.assert_called_once()
        log = AuditLog.objects.get(context="payments.banorte.verify")
        # The dialog's audit row is unchanged (no ``via``).
        assert set(log.changes) == {"banorte_verified", "referencia", "amount"}

    def test_an_authorization_code_is_checked_when_given(self, admin):
        checkout = card_payment(codigo_aut="0A1B2C")
        with pytest.raises(VerifyError) as err:
            verify_approval(
                checkout.payment_id,
                referencia=checkout.referencia,
                amount="200",
                codigo_aut="999999",
                actor=admin,
            )
        assert err.value.code == "auth_code_mismatch"
        result = verify_approval(
            checkout.payment_id,
            referencia=checkout.referencia,
            amount=Decimal("200.00"),
            codigo_aut="a1b2c",
            actor=admin,
        )
        assert result.newly_verified
        again = verify_approval(checkout.payment_id, referencia="", amount="", actor=admin)
        assert not again.newly_verified

    def test_the_same_refusals_as_the_dialog(self, admin):
        checkout = card_payment()
        for kwargs, code in (
            ({"referencia": "1", "amount": "200"}, "reference_mismatch"),
            ({"referencia": checkout.referencia, "amount": "sNaN"}, "amount_mismatch"),
        ):
            with pytest.raises(VerifyError) as err:
                verify_approval(checkout.payment_id, actor=admin, **kwargs)
            assert err.value.code == code and err.value.status == 400
        with pytest.raises(VerifyError) as err:
            verify_approval(999_999, referencia="1", amount="1", actor=admin)
        assert err.value.status == 404

    def test_the_lock_is_one_postgres_accepts(self):
        from apps.payments import views
        from apps.payments.multicobros import checkout_for_verify
        from apps.payments.test_postgres_locks import assert_postgres_can_lock

        assert views.checkout_for_verify is checkout_for_verify
        assert_postgres_can_lock(checkout_for_verify(1))
