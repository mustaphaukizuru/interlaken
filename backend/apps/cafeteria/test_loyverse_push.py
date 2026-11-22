"""The app writes paid card top-ups into Loyverse (CAFETERIA_TOPUP_LOYVERSE_PUSH).

Live test 2026-11-21 on a throwaway customer: ``POST /customers`` with the id
SETS ``total_points`` (absolute, decimals kept), and a body without the other
fields wipes them (``customer_code`` and ``note`` came back null). The fake
Loyverse below behaves exactly that way, so these tests pin the rules of
``cafeteria/loyverse_push.py``: real money only, write only when Loyverse and
the wallet agree, credit only on an exact read-back, never write twice, hand
anything uncertain to the staff and to the POS mirror. Every name is invented.
"""

from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.accounts.factories import AdminFactory
from apps.cafeteria import loyverse_push, schedule, services
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.cafeteria.services import (
    LoyverseError,
    apply_after_verification,
    customer_write_body,
    mirror_pos_topups,
    pos_queue_reasons,
)
from apps.cafeteria.test_topup_scheduled_apply import paid_topup
from apps.core.models import AuditLog
from apps.payments.models import BanorteCheckout
from apps.payments.multicobros import paid_topups_awaiting_verification
from apps.payments.serializers import PaymentSerializer
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db

GET = "apps.cafeteria.services.get_customer_by_id"
SET = "apps.cafeteria.services.set_customer_points"
RECEIPTS = "apps.cafeteria.services.get_receipts"
ALL = "apps.cafeteria.services.get_all_customers"
SEND = "apps.portal.services.send_email"
S = TopUpRequest.PushState


class FakeLoyverse:
    """One Loyverse customer that answers like the real API did on 2026-11-21."""

    def __init__(self, points=100):
        self.customer = {
            "id": "lv-1",
            "name": "ALUMNO INVENTADO",
            "customer_code": "09999",
            "note": "nota del colegio",
            "email": None,
            "total_points": float(points),
            "total_spent": 1234.5,
            "total_visits": 40,
            "first_visit": "2026-08-24T15:00:00Z",
            "created_at": "2026-08-01T12:00:00.000Z",
            "updated_at": "2026-11-20T12:00:00.000Z",
            "deleted_at": None,
        }
        self.writes = []
        self.reject = False  # the POST fails and changes nothing
        self.after_write = None  # callable(points) -> points: a sale lands right after
        self.read_fails = False

    @property
    def points(self):
        return Decimal(str(self.customer["total_points"]))

    def set(self, points):
        self.customer["total_points"] = float(points)

    def get(self, customer_id):
        if self.read_fails:
            raise LoyverseError("Loyverse is down")
        assert customer_id == self.customer["id"]
        return dict(self.customer)

    def write(self, customer, points):
        body = customer_write_body(customer, points)  # the real body builder
        self.writes.append(body)
        if self.reject:
            raise LoyverseError("400 Bad Request")
        computed = {
            k: v for k, v in self.customer.items() if k in services.CUSTOMER_READ_ONLY_FIELDS
        }
        # Loyverse REPLACES the record with the body: missing fields are wiped.
        self.customer = {"customer_code": None, "note": None, "email": None, **body, **computed}
        if self.after_write:
            self.set(self.after_write(Decimal(str(body["total_points"]))))
        return dict(self.customer)


@pytest.fixture
def loyverse():
    fake = FakeLoyverse()
    with (
        patch(GET, side_effect=fake.get),
        patch(SET, side_effect=fake.write),
        patch(RECEIPTS, return_value=[]),
        patch(SEND, return_value=True),
    ):
        yield fake


@pytest.fixture
def push(settings):
    """``verified`` mode with real payments (production's PAYMENTS_LIVE)."""
    settings.PAYMENTS_LIVE = True
    settings.CAFETERIA_TOPUP_LOYVERSE_PUSH = "verified"
    return settings


def verified(payment):
    BanorteCheckout.objects.filter(payment=payment).update(verified_at=timezone.now())
    payment.refresh_from_db()
    return payment


def wallet(student):
    return CafeteriaBalance.objects.get(student=student).balance


def ready(amount="200.00", balance=100):
    """A PAID card top-up, verified in MultiCobros, wallet == Loyverse."""
    student, topup, payment = paid_topup(amount, checkout="PRD", balance=balance)
    return student, topup, verified(payment)


# ── the write body ───────────────────────────────────────────────────────────
class TestWriteBody:
    def test_is_the_full_record_with_the_new_points_and_no_computed_fields(self):
        body = customer_write_body(FakeLoyverse(100).customer, Decimal("344.50"))
        assert body["total_points"] == 344.5
        assert body["customer_code"] == "09999" and body["note"] == "nota del colegio"
        assert body["id"] == "lv-1" and body["name"] == "ALUMNO INVENTADO"
        assert not set(body) & services.CUSTOMER_READ_ONLY_FIELDS

    def test_refuses_a_record_without_id_or_name(self):
        with pytest.raises(LoyverseError):
            customer_write_body({"id": "lv-1", "total_points": 1}, 5)
        with pytest.raises(LoyverseError):
            customer_write_body({"name": "X", "total_points": 1}, 5)


# ── when nothing may be written ──────────────────────────────────────────────
class TestNothingWritten:
    def test_off_by_default(self, settings, loyverse):
        settings.PAYMENTS_LIVE = True
        _, topup, payment = ready()
        assert loyverse_push.push_topup(payment)["state"] == "skipped"
        assert loyverse.writes == []
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID and topup.loyverse_push_state == ""

    def test_never_without_live_payments(self, push, loyverse):
        _, _, payment = ready()
        push.PAYMENTS_LIVE = False
        assert loyverse_push.push_topup(payment) == {
            "state": "skipped",
            "reason": "not_live",
            "balance": None,
        }
        assert loyverse.writes == []

    def test_verified_mode_waits_for_multicobros(self, push, loyverse):
        _, _, payment = paid_topup("200.00", checkout="PRD", balance=100)
        assert loyverse_push.push_topup(payment)["reason"] == "needs_verification"
        assert loyverse.writes == []

    def test_never_a_payworks_simulation(self, settings, loyverse):
        _, _, payment = paid_topup("200.00", checkout="AUT", balance=100)
        settings.PAYMENTS_LIVE = True
        settings.CAFETERIA_TOPUP_LOYVERSE_PUSH = "instant"
        assert loyverse_push.push_topup(payment)["reason"] in ("simulation", "not_approved")
        assert loyverse.writes == []

    def test_never_a_refunded_or_already_applied_top_up(self, push, loyverse):
        _, topup, payment = ready()
        TopUpRequest.objects.filter(pk=topup.pk).update(status=TopUpRequest.Status.COMPLETED)
        assert loyverse_push.push_topup(payment)["reason"] == "not_paid"
        assert loyverse.writes == []


# ── the write itself ─────────────────────────────────────────────────────────
class TestPush:
    def test_writes_reads_back_and_credits_the_wallet(self, push, loyverse):
        student, topup, payment = ready("200.00", balance=100)

        result = loyverse_push.push_topup(payment)

        assert result == {"state": "pushed", "reason": "", "balance": "300.00"}
        assert loyverse.points == Decimal("300") and len(loyverse.writes) == 1
        # The student's code (matrícula link) survived the write.
        assert loyverse.customer["customer_code"] == "09999"
        assert loyverse.customer["note"] == "nota del colegio"
        assert wallet(student) == Decimal("300.00")
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert topup.applied_via == TopUpRequest.AppliedVia.AUTO_POS
        assert topup.pos_loaded_at is not None  # nothing left to load by hand
        assert topup.loyverse_push_state == S.PUSHED and topup.loyverse_push_attempts == 1
        assert "$100.00 → $300.00" in topup.loyverse_push_note
        assert (
            CafeteriaTransaction.objects.filter(
                loyverse_receipt_id=f"topup-payment-{payment.pk}", amount=Decimal("200")
            ).count()
            == 1
        )
        log = AuditLog.objects.get(context="cafeteria.topup.loyverse_push")
        assert (
            log.changes["loyverse_before"] == "100.00" and log.changes["loyverse_after"] == "300.00"
        )

    def test_the_family_is_told_once_it_commits(
        self, push, loyverse, django_capture_on_commit_callbacks
    ):
        student, _, payment = ready()
        with django_capture_on_commit_callbacks(execute=True):
            loyverse_push.push_topup(payment)
        parent = student.parents.first()
        note = Notification.objects.get(user=parent, title="Recarga aplicada")
        assert "ya está disponible en la cafetería" in note.message

    def test_cents_are_kept(self, push, loyverse):
        student, _, payment = ready("244.50", balance=100)
        assert loyverse_push.push_topup(payment)["balance"] == "344.50"
        assert loyverse.points == Decimal("344.5") and wallet(student) == Decimal("344.50")

    def test_never_written_twice(self, push, loyverse):
        _, _, payment = ready()
        loyverse_push.push_topup(payment)
        assert loyverse_push.push_topup(payment)["state"] == "skipped"
        assert len(loyverse.writes) == 1 and loyverse.points == Decimal("300")


# ── waiting: nothing written, the cron tries again ───────────────────────────
class TestWaits:
    @pytest.mark.parametrize("loyverse_points", [120, 80])
    def test_when_loyverse_and_the_wallet_differ(self, push, loyverse, loyverse_points):
        # 120: a POS load or a payment staff already typed; 80: a sale the
        # receipts sync has not recorded yet. Either way, not now.
        student, topup, payment = ready(balance=100)
        loyverse.set(loyverse_points)
        result = loyverse_push.push_topup(payment)
        assert result["state"] == "waiting" and "se carga cuando coincidan" in result["reason"]
        assert loyverse.writes == [] and wallet(student) == Decimal("100")
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID
        assert topup.loyverse_push_state == S.WAITING and topup.loyverse_push_attempts == 1

    def test_when_the_wallet_has_no_opening_balance(self, push, loyverse):
        _, _, payment = paid_topup("200.00", checkout="PRD")  # no CafeteriaBalance
        verified(payment)
        assert loyverse_push.push_topup(payment)["state"] == "waiting"
        assert loyverse.writes == []

    def test_when_a_refund_still_has_to_leave_the_pos(self, push, loyverse):
        student, _, payment = ready()
        TopUpRequest.objects.create(
            student=student,
            amount=Decimal("50"),
            method=TopUpRequest.Method.ONLINE,
            status=TopUpRequest.Status.COMPLETED,
            pos_unload_needed_at=timezone.now(),
        )
        assert loyverse_push.push_topup(payment)["state"] == "waiting"
        assert loyverse.writes == []

    def test_when_loyverse_cannot_be_read(self, push, loyverse):
        _, _, payment = ready()
        loyverse.read_fails = True
        assert loyverse_push.push_topup(payment)["state"] == "waiting"
        assert loyverse.writes == []

    def test_hands_it_to_the_staff_after_many_tries(
        self, push, loyverse, django_capture_on_commit_callbacks
    ):
        admin = AdminFactory()
        _, topup, payment = ready()
        TopUpRequest.objects.filter(pk=topup.pk).update(
            loyverse_push_attempts=loyverse_push.MAX_ATTEMPTS - 1
        )
        loyverse.set(150)
        with django_capture_on_commit_callbacks(execute=True):
            assert loyverse_push.push_topup(payment)["state"] == "failed"
        topup.refresh_from_db()
        assert topup.loyverse_push_state == S.FAILED and topup.status == TopUpRequest.Status.PAID
        assert Notification.objects.filter(user=admin, title__startswith="Cargar a mano").exists()


# ── uncertain outcomes: credited only on an exact read-back ──────────────────
class TestUncertain:
    def test_a_rejected_write_is_failed_and_never_retried(
        self, push, loyverse, django_capture_on_commit_callbacks
    ):
        admin = AdminFactory()
        student, topup, payment = ready()
        loyverse.reject = True
        with django_capture_on_commit_callbacks(execute=True):
            assert loyverse_push.push_topup(payment)["state"] == "failed"
        assert wallet(student) == Decimal("100")
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID and topup.loyverse_push_state == S.FAILED
        assert "Error: 400 Bad Request" in topup.loyverse_push_note
        note = Notification.objects.get(user=admin, title__startswith="Cargar a mano")
        assert "Antes, revise en Loyverse que no esté ya cargada" in note.message
        loyverse.reject = False
        assert loyverse_push.push_topup(payment)["reason"] == "already_written"
        assert len(loyverse.writes) == 1

    def test_an_unconfirmed_write_is_settled_by_the_pos_mirror(self, push, loyverse):
        # The write lands, then a $30 sale lands before our re-read: Loyverse
        # shows $270, not $300. Not credited by the push; once the receipts
        # sync records the sale, the mirror finds the exact $200 gap and
        # applies this top-up. Money is never lost or doubled.
        student, topup, payment = ready(balance=100)
        loyverse.after_write = lambda points: points - 30
        assert loyverse_push.push_topup(payment)["state"] == "failed"
        assert wallet(student) == Decimal("100") and loyverse.points == Decimal("270")

        CafeteriaBalance.objects.filter(student=student).update(balance=Decimal("70"))
        r = mirror_pos_topups(customers=[loyverse.customer], fresh=True)

        assert r["applied_paid"] == 1 and r["credited"] == 0
        assert wallet(student) == Decimal("270")
        topup.refresh_from_db()
        assert topup.applied_via == TopUpRequest.AppliedVia.POS_SYNC


# ── a sale at the same moment ────────────────────────────────────────────────
def sale(number="R-9", spent=30, when=None):
    when = when or timezone.now()
    return {
        "receipt_number": number,
        "customer_id": "lv-1",
        "points_deducted": spent,
        "created_at": when.isoformat().replace("+00:00", "Z"),
        "total_discounts": [],
    }


class TestOverlap:
    def test_marks_check_tells_staff_and_holds_the_mirror(
        self, push, loyverse, django_capture_on_commit_callbacks
    ):
        admin = AdminFactory()
        student, topup, payment = ready(balance=100)
        with (
            patch(RECEIPTS, return_value=[sale()]),
            django_capture_on_commit_callbacks(execute=True),
        ):
            assert loyverse_push.push_topup(payment)["state"] == "pushed"
        topup.refresh_from_db()
        assert topup.loyverse_push_state == S.CHECK and "R-9" in topup.loyverse_push_note
        assert Notification.objects.filter(
            user=admin, title__startswith="Revisar en Loyverse"
        ).exists()
        assert student.id in pos_queue_reasons([student.id], include_paid=False)

        # The sale is recorded locally (wallet 270) while Loyverse kept 300:
        # the mirror must not read the $30 as a cash recarga.
        CafeteriaBalance.objects.filter(student=student).update(balance=Decimal("270"))
        r = mirror_pos_topups(customers=[loyverse.customer], fresh=True)
        assert r["credited"] == 0 and r["skipped_pending"] == 1
        assert wallet(student) == Decimal("270")

        # Staff fix Loyverse; the next pass closes the check.
        loyverse.set(270)
        assert loyverse_push.resolve_checks() == 1
        topup.refresh_from_db()
        assert topup.loyverse_push_state == S.PUSHED
        assert student.id not in pos_queue_reasons([student.id], include_paid=False)

    def test_a_sale_already_in_the_wallet_is_not_a_suspect(
        self, push, loyverse, django_capture_on_commit_callbacks
    ):
        student, topup, payment = ready(balance=100)
        CafeteriaTransaction.objects.create(
            student=student,
            transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal("30"),
            loyverse_receipt_id="R-9",
            description="Comida",
        )
        with (
            patch(RECEIPTS, return_value=[sale()]),
            django_capture_on_commit_callbacks(execute=True),
        ):
            loyverse_push.push_topup(payment)
        topup.refresh_from_db()
        assert topup.loyverse_push_state == S.PUSHED

    def test_an_old_sale_is_not_a_suspect(self, push, loyverse, django_capture_on_commit_callbacks):
        _, topup, payment = ready(balance=100)
        old = sale(when=timezone.now() - timedelta(minutes=10))
        with patch(RECEIPTS, return_value=[old]), django_capture_on_commit_callbacks(execute=True):
            loyverse_push.push_topup(payment)
        topup.refresh_from_db()
        assert topup.loyverse_push_state == S.PUSHED


# ── the two triggers and the cron ────────────────────────────────────────────
class TestVerifiedMode:
    def test_verifying_writes_it_at_once(self, push, loyverse):
        student, topup, payment = paid_topup("200.00", checkout="PRD", balance=100)
        verified(payment)
        assert apply_after_verification(payment) == {"apply_state": "applied", "balance": "300.00"}
        assert loyverse.points == Decimal("300") and wallet(student) == Decimal("300")

    def test_the_report_upload_leaves_it_to_the_cron(self, push, loyverse):
        student, _, payment = paid_topup("200.00", checkout="PRD", balance=100)
        verified(payment)
        # The staff are told the app loads it (never «cárguela»).
        assert apply_after_verification(payment, quick_read=True)["apply_state"] == "auto_waiting"
        assert loyverse.writes == []
        assert loyverse_push.push_due_topups()["pushed"] == 1
        assert wallet(student) == Decimal("300")


class TestInstantMode:
    @pytest.fixture
    def instant(self, push):
        push.CAFETERIA_TOPUP_LOYVERSE_PUSH = "instant"
        push.CAFETERIA_TOPUP_PUSH_UNVERIFIED_MAX = "500"
        return push

    def test_a_small_approval_reaches_the_cafeteria_on_payment(
        self, instant, loyverse, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            student, topup, payment = paid_topup("200.00", checkout="PRD", balance=100)
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert topup.applied_via == TopUpRequest.AppliedVia.AUTO_POS
        assert loyverse.points == Decimal("300") and wallet(student) == Decimal("300")
        # Still to verify in MultiCobros afterwards: the badge counts it.
        assert payment.needs_bank_verification()
        assert paid_topups_awaiting_verification().filter(pk=topup.pk).exists()
        # The parent's return page knows it is spendable already.
        assert PaymentSerializer(payment).data["topup"]["applied_via"] == "auto_pos"

    @pytest.mark.django_db(transaction=True)
    def test_the_family_gets_one_message_in_production_order(self, instant, loyverse):
        # Real commits: settlement's on_commit writes into Loyverse BEFORE the
        # payment notice is built, as in production. One message, not three.
        student, topup, _ = paid_topup("200.00", checkout="PRD", balance=100)
        parent = student.parents.first()
        titles = list(Notification.objects.filter(user=parent).values_list("title", flat=True))
        assert titles == ["Recarga de cafetería lista"]
        note = Notification.objects.get(user=parent)
        assert "ya está cargado en la cafetería: ya puede usarlo" in note.message
        assert "Saldo actual: $300.00" in note.message
        topup.refresh_from_db()
        assert topup.applied_via == TopUpRequest.AppliedVia.AUTO_POS

    def test_a_large_approval_waits_for_the_verification(
        self, instant, loyverse, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            _, topup, payment = paid_topup("800.00", checkout="PRD", balance=100)
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID and loyverse.writes == []
        assert loyverse_push.push_topup(payment)["reason"] == "over_unverified_max"
        verified(payment)
        assert apply_after_verification(payment)["apply_state"] == "applied"
        assert loyverse.points == Decimal("900")

    def test_verified_mode_does_not_write_on_payment(
        self, push, loyverse, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            _, topup, _ = paid_topup("200.00", checkout="PRD", balance=100)
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID and loyverse.writes == []


class TestCron:
    def test_retries_a_waiting_top_up_once_loyverse_agrees(self, push, loyverse):
        student, topup, _ = ready(balance=100)
        loyverse.set(130)
        assert loyverse_push.push_due_topups()["waiting"] == 1
        loyverse.set(100)
        assert loyverse_push.push_due_topups()["pushed"] == 1
        assert wallet(student) == Decimal("300") and loyverse.points == Decimal("300")

    def test_does_nothing_when_off(self, settings, loyverse):
        settings.PAYMENTS_LIVE = True
        ready()
        assert loyverse_push.push_due_topups() == {
            "enabled": False,
            "pushed": 0,
            "waiting": 0,
            "failed": 0,
            "skipped": 0,
            "resolved": 0,
        }
        assert loyverse.writes == []

    def test_the_five_minute_command_writes_before_mirroring(self, push, loyverse):
        student, _, _ = ready(balance=100)
        out = StringIO()
        with patch(ALL, side_effect=lambda: [dict(loyverse.customer)]):
            call_command("mirror_pos_topups", stdout=out)
        assert "Card top-ups written into Loyverse: 1" in out.getvalue()
        assert wallet(student) == Decimal("300")


class TestPolicy:
    def test_families_are_told_the_mode(self, settings):
        assert schedule.policy()["auto_load"] == "off"
        settings.CAFETERIA_TOPUP_LOYVERSE_PUSH = "instant"
        assert schedule.policy()["auto_load"] == "off"  # not live: nothing is written
        settings.PAYMENTS_LIVE = True
        settings.CAFETERIA_TOPUP_PUSH_UNVERIFIED_MAX = "300"
        p = schedule.policy()
        assert p["auto_load"] == "instant" and p["auto_load_max"] == "300.00"

    def test_a_bad_setting_means_off(self, settings):
        settings.PAYMENTS_LIVE = True
        settings.CAFETERIA_TOPUP_LOYVERSE_PUSH = "yes please"
        assert loyverse_push.push_mode() == "off" and not loyverse_push.is_enabled()


# ── what the staff are told (2026-11-21 follow-up: never «cárguela» when the
# app will load it, or the card gets the money twice) ─────────────────────────
class TestStaffAreToldNotToLoadIt:
    def test_verify_says_the_app_loads_it_when_it_must_wait(self, push, loyverse):
        _, _, payment = paid_topup("200.00", checkout="PRD", balance=100)
        verified(payment)
        loyverse.set(130)  # a sale in flight: the push waits for the cron
        assert apply_after_verification(payment)["apply_state"] == "auto_waiting"
        assert loyverse.writes == []

    def test_verify_asks_for_a_manual_load_only_after_the_app_gave_up(self, push, loyverse):
        _, _, payment = paid_topup("200.00", checkout="PRD", balance=100)
        verified(payment)
        loyverse.reject = True
        assert apply_after_verification(payment)["apply_state"] == "waiting_pos"

    def test_auto_load_off_keeps_the_old_answer(self, settings, loyverse):
        settings.PAYMENTS_LIVE = True
        _, _, payment = paid_topup("200.00", checkout="PRD", balance=100)
        verified(payment)
        assert apply_after_verification(payment)["apply_state"] == "waiting_pos"

    def test_the_upload_path_says_the_app_loads_it(self, push, loyverse):
        _, _, payment = paid_topup("200.00", checkout="PRD", balance=100)
        verified(payment)
        assert apply_after_verification(payment, quick_read=True)["apply_state"] == "auto_waiting"
        assert loyverse.writes == []

    def test_the_queue_row_flags_it(self, push, loyverse):
        from apps.cafeteria.serializers import TopUpLogSerializer as Row

        _, topup, payment = paid_topup("200.00", checkout="PRD", balance=100)
        assert Row(topup).data["loyverse_auto"] is False  # still to verify
        verified(payment)
        assert Row(TopUpRequest.objects.get(pk=topup.pk)).data["loyverse_auto"] is True
        push.CAFETERIA_TOPUP_LOYVERSE_PUSH = "off"
        assert Row(TopUpRequest.objects.get(pk=topup.pk)).data["loyverse_auto"] is False


class TestMorningReport:
    def report(self):
        out = StringIO()
        with patch(SEND, return_value=True) as send:
            call_command("topup_apply_report", stdout=out)
        return out.getvalue(), send

    def test_auto_load_on_says_verify_and_do_not_type(self, push, loyverse):
        from apps.accounts.factories import ParentFactory, StudentProfileFactory

        def kid(n):
            return StudentProfileFactory(parents=[ParentFactory()], loyverse_id=f"lv-r{n}")

        AdminFactory()
        paid_topup("200.00", student=kid(1), checkout="PRD", balance=100)
        _, _, payment = paid_topup("150.00", student=kid(2), checkout="PRD", balance=50)
        verified(payment)
        _, failed_topup, _ = paid_topup("80.00", student=kid(3), checkout="PRD", balance=20)
        TopUpRequest.objects.filter(pk=failed_topup.pk).update(loyverse_push_state=S.FAILED)
        TopUpRequest.objects.filter(status=TopUpRequest.Status.PAID).update(
            apply_due_at=timezone.now()
        )

        log, send = self.report()

        assert "SE CARGA SOLA" in log and "CARGAR A MANO" in log
        body = send.call_args.args[1]
        assert "por aplicar" in send.call_args.args[0]
        assert "Al verificarla, la app la carga sola en Loyverse" in body
        assert "CARGAR A MANO: la app no pudo cargarla" in body
        assert "No cargue a mano en el POS ninguna otra recarga" in body
        assert "Cargue cada monto al cliente de Loyverse" not in body

    def test_auto_load_off_keeps_the_schools_steps(self, settings, loyverse):
        settings.PAYMENTS_LIVE = True
        AdminFactory()
        paid_topup("200.00", checkout="PRD", balance=100)
        TopUpRequest.objects.filter(status=TopUpRequest.Status.PAID).update(
            apply_due_at=timezone.now()
        )
        log, send = self.report()
        body = send.call_args.args[1]
        assert "por cargar en el POS" in send.call_args.args[0]
        assert "Cargue cada monto al cliente de Loyverse" in body
        assert "SE CARGA SOLA" not in log and "la app la carga sola" not in body


class TestVerifyAfterTheFact:
    """instant mode: a top-up the app loaded on approval leaves «Por aplicar»,
    but stays in «Por verificar». The console lists it (needs_verify=1) with
    its own «Verificar en MultiCobros» button, and verifying it clears it."""

    def test_listed_until_verified(
        self, push, loyverse, admin_client, django_capture_on_commit_callbacks
    ):
        from django.urls import reverse

        push.CAFETERIA_TOPUP_LOYVERSE_PUSH = "instant"
        with django_capture_on_commit_callbacks(execute=True):
            _, topup, payment = paid_topup("200.00", checkout="PRD", balance=100)
        topup.refresh_from_db()
        assert topup.applied_via == TopUpRequest.AppliedVia.AUTO_POS

        listed = admin_client.get(reverse("admin-topups"), {"needs_verify": 1}).data
        assert [r["id"] for r in listed["results"]] == [topup.pk]
        assert listed["results"][0]["banorte"]["needs_verification"] is True
        assert not admin_client.get(reverse("admin-topups"), {"needs_apply": 1}).data["results"]

        verified(payment)
        assert admin_client.get(reverse("admin-topups"), {"needs_verify": 1}).data["results"] == []
        assert not paid_topups_awaiting_verification().exists()

    def test_nothing_listed_with_the_auto_load_off(self, settings, loyverse, admin_client):
        from django.urls import reverse

        settings.PAYMENTS_LIVE = True
        paid_topup("200.00", checkout="PRD", balance=100)  # PAID: «Por aplicar», not here
        assert admin_client.get(reverse("admin-topups"), {"needs_verify": 1}).data["results"] == []
