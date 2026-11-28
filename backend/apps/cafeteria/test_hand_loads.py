"""Never the same money twice when a top-up ends up loaded into Loyverse by hand.

Pins ``cafeteria/hand_loads.py`` (owner, Caja Part 2 follow-up, 2026-11-28):
the POS mirror explains a gap with the one waiting hand-load top-up of exactly
that amount; «Aplicar» refuses a top-up already found and stops when an
anonymous POS recarga may be the same money; «Es esta misma» links them
without moving money. Ingresos counts every peso once. Names are invented.
"""

from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria import ingresos
from apps.cafeteria.hand_loads import HandLoadError, link_mirrored_topup
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.cafeteria.services import TopUpApplyError, apply_paid_topup, mirror_pos_topups
from apps.cafeteria.test_topup_scheduled_apply import GUARD, paid_topup, seeded
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

S = TopUpRequest.PushState
LOYVERSE_300 = [{"id": "lv-1", "total_points": 300}]


@pytest.fixture
def student():
    parent = ParentFactory()
    s = StudentProfileFactory(parents=[parent], loyverse_id="lv-1")
    seeded(s, 100)
    return s


@pytest.fixture
def admin_client():
    c = APIClient()
    c.force_authenticate(AdminFactory())
    return c


def desk_topup(student, amount="200.00", *, push=S.FAILED, method="cash", folio=None):
    """A front-desk top-up whose Loyverse write failed: staff were told to load it by hand."""
    t = TopUpRequest.objects.create(
        student=student,
        amount=Decimal(amount),
        method=TopUpRequest.Method.OFFICE,
        desk_method=method,
        status=TopUpRequest.Status.PENDING,
        loyverse_push_state=push,
    )
    t.receipt_folio = folio or f"R-{t.pk:06d}"
    t.save(update_fields=["receipt_folio"])
    return t


def office_topup(student, amount="200.00"):
    """An old «Caja Escolar» request: always loaded by hand, then «Aplicar»."""
    return TopUpRequest.objects.create(
        student=student,
        amount=Decimal(amount),
        method=TopUpRequest.Method.OFFICE,
        status=TopUpRequest.Status.PENDING,
    )


def anonymous_pos_recarga(student, amount="200.00"):
    """What the mirror wrote before this guard: an unnamed POS cash recarga."""
    cb = CafeteriaBalance.objects.get(student=student)
    cb.balance += Decimal(amount)
    cb.save(update_fields=["balance"])
    now = timezone.now()
    return CafeteriaTransaction.objects.create(
        student=student,
        transaction_type=CafeteriaTransaction.TxType.TOPUP,
        amount=Decimal(amount),
        description="Recarga en caja de cafetería (POS Loyverse)",
        loyverse_receipt_id=f"pos-topup-{student.pk}-{int(now.timestamp())}",
        balance_after=cb.balance,
        date=now,
    )


def wallet(student):
    return CafeteriaBalance.objects.get(student=student).balance


def today_report():
    day = timezone.localdate()
    return ingresos.report(day, day)["totals"]


# ── guard 1: the mirror explains the gap with that top-up ─────────────────────
class TestMirrorFindsHandLoads:
    def test_failed_desk_topup_is_found_not_a_cash_recarga(
        self, student, django_capture_on_commit_callbacks
    ):
        topup = desk_topup(student)
        with (
            patch("apps.cafeteria.caja.notify_receipt") as receipt,
            django_capture_on_commit_callbacks(execute=True),
        ):
            r = mirror_pos_topups(customers=LOYVERSE_300)
        assert r["found_hand"] == 1 and r["credited"] == 0
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert topup.applied_via == TopUpRequest.AppliedVia.POS_SYNC
        assert topup.loyverse_push_state == S.PUSHED
        assert wallet(student) == Decimal("300")
        tx = CafeteriaTransaction.objects.get(student=student)
        assert tx.loyverse_receipt_id == f"topup-desk-{topup.pk}"
        assert not CafeteriaTransaction.objects.filter(
            loyverse_receipt_id__startswith="pos-topup-"
        ).exists()
        assert receipt.call_count == 1  # the family's receipt, once
        assert AuditLog.objects.filter(context="cafeteria.topup.found_in_loyverse").count() == 1

        again = mirror_pos_topups(customers=LOYVERSE_300)
        assert again["found_hand"] == 0 and again["in_sync"] == 1
        assert CafeteriaTransaction.objects.filter(student=student).count() == 1

        totals = today_report()
        assert totals["desk_cash"] == Decimal("200") and totals["pos"] == Decimal("0")
        assert totals["total"] == Decimal("200")

    def test_old_office_request_is_found_too(self, student):
        topup = office_topup(student)
        r = mirror_pos_topups(customers=LOYVERSE_300)
        assert r["found_hand"] == 1
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert (
            CafeteriaTransaction.objects.get(student=student).loyverse_receipt_id
            == f"topup-request-{topup.pk}"
        )

    def test_failed_card_topup_keeps_the_existing_match(self, student):
        _, topup, payment = paid_topup(student=student, parent=student.parents.first())
        TopUpRequest.objects.filter(pk=topup.pk).update(loyverse_push_state=S.FAILED)
        r = mirror_pos_topups(customers=LOYVERSE_300)
        assert r["applied_paid"] == 1 and r["credited"] == 0 and r["found_hand"] == 0
        assert (
            CafeteriaTransaction.objects.get(student=student).loyverse_receipt_id
            == f"topup-payment-{payment.pk}"
        )

    def test_two_candidates_of_that_amount_are_never_guessed(self, student):
        a, b = desk_topup(student), desk_topup(student)
        r = mirror_pos_topups(customers=LOYVERSE_300)
        assert r["found_hand"] == 0 and r["credited"] == 1  # today's behaviour
        for t in (a, b):
            t.refresh_from_db()
            assert t.status == TopUpRequest.Status.PENDING

    def test_another_amount_stays_an_anonymous_recarga(self, student):
        desk_topup(student, "150.00")
        r = mirror_pos_topups(customers=LOYVERSE_300)
        assert r["found_hand"] == 0 and r["credited"] == 1

    def test_a_topup_the_app_will_still_write_is_not_a_hand_load(self, student, settings):
        settings.CAFETERIA_TOPUP_LOYVERSE_PUSH = "instant"
        desk_topup(student, push=S.WAITING)
        r = mirror_pos_topups(customers=LOYVERSE_300)
        assert r["found_hand"] == 0 and r["credited"] == 1

    def test_with_the_push_off_a_pending_desk_topup_is_a_hand_load(self, student, settings):
        settings.CAFETERIA_TOPUP_LOYVERSE_PUSH = "off"
        desk_topup(student, push=S.NONE)
        r = mirror_pos_topups(customers=LOYVERSE_300)
        assert r["found_hand"] == 1 and r["credited"] == 0

    def test_a_voided_topup_is_never_matched(self, student):
        t = desk_topup(student)
        TopUpRequest.objects.filter(pk=t.pk).update(voided_at=timezone.now())
        r = mirror_pos_topups(customers=LOYVERSE_300)
        assert r["found_hand"] == 0 and r["credited"] == 1


# ── guard 2: «Aplicar» never counts it twice ─────────────────────────────────
class TestApplyGuards:
    def test_apply_refused_after_the_mirror_found_it(self, student, admin_client):
        topup = office_topup(student)
        mirror_pos_topups(customers=LOYVERSE_300)
        r = admin_client.post(f"/api/v1/cafeteria/admin/topup/{topup.pk}/apply/")
        assert r.status_code == 400
        assert "ya se encontró en Loyverse" in r.json()["detail"]
        bulk = admin_client.post(
            "/api/v1/cafeteria/admin/topups/bulk/",
            {"action": "apply", "ids": [topup.pk]},
            format="json",
        ).json()
        assert bulk["ok"] == 0 and "encontró en Loyverse" in bulk["skipped"][0]["reason"]
        assert wallet(student) == Decimal("300")

    def test_apply_stops_on_an_anonymous_duplicate_until_confirmed(self, student, admin_client):
        topup = office_topup(student)
        dup = anonymous_pos_recarga(student)
        url = f"/api/v1/cafeteria/admin/topup/{topup.pk}/apply/"
        r = admin_client.post(url)
        assert r.status_code == 409
        body = r.json()
        assert body["code"] == "pos_already_mirrored" and body["pos_transaction"] == dup.pk
        assert "si es esta misma, no la aplique" in body["detail"]
        assert wallet(student) == Decimal("300")  # nothing applied

        bulk = admin_client.post(
            "/api/v1/cafeteria/admin/topups/bulk/",
            {"action": "apply", "ids": [topup.pk]},
            format="json",
        ).json()
        assert bulk["ok"] == 0 and "Loyverse ya registró" in bulk["skipped"][0]["reason"]

        ok = admin_client.post(url, {"confirm_pos_duplicate": True}, format="json")
        assert ok.status_code == 200  # a different recarga
        assert wallet(student) == Decimal("500")

    def test_paid_card_apply_stops_on_a_duplicate(self, student):
        _, topup, _ = paid_topup(student=student, parent=student.parents.first())
        anonymous_pos_recarga(student)
        with pytest.raises(TopUpApplyError) as err:
            apply_paid_topup(topup)
        assert err.value.code == "pos_already_mirrored"
        with patch(GUARD, return_value=Decimal("500")):
            _, balance = apply_paid_topup(topup, confirm_pos_duplicate=True)
        assert balance == Decimal("500")

    def test_paid_card_bulk_apply_skips_a_duplicate(self, student, admin_client):
        _, topup, _ = paid_topup(student=student, parent=student.parents.first())
        anonymous_pos_recarga(student)
        bulk = admin_client.post(
            "/api/v1/cafeteria/admin/topups/bulk/",
            {"action": "apply_paid", "ids": [topup.pk]},
            format="json",
        ).json()
        assert bulk["ok"] == 0 and "Loyverse ya registró" in bulk["skipped"][0]["reason"]

    def test_the_deposits_list_flags_both_cases(self, student, admin_client):
        found = office_topup(student)
        mirror_pos_topups(customers=LOYVERSE_300)
        other = ParentFactory()
        s2 = StudentProfileFactory(parents=[other], loyverse_id="lv-2")
        seeded(s2, 0)
        waiting = office_topup(s2, "50.00")
        dup = anonymous_pos_recarga(s2, "50.00")
        rows = {
            r["id"]: r
            for r in admin_client.get("/api/v1/cafeteria/admin/topups/").json()["results"]
        }
        assert rows[found.pk]["found_in_loyverse"] is True
        assert rows[found.pk]["pos_mirror"] is None
        assert rows[waiting.pk]["pos_mirror"]["pos_transaction"] == dup.pk
        assert rows[waiting.pk]["found_in_loyverse"] is False


# ── guard 3: «Es esta misma» links them, no money moves ──────────────────────
class TestLink:
    def test_link_relabels_the_recarga_and_closes_the_topup(
        self, student, admin_client, django_capture_on_commit_callbacks
    ):
        topup = desk_topup(student)
        dup = anonymous_pos_recarga(student)
        assert today_report()["total"] == Decimal("400")  # counted twice before
        with (
            patch("apps.cafeteria.caja.notify_receipt") as receipt,
            django_capture_on_commit_callbacks(execute=True),
        ):
            r = admin_client.post(
                f"/api/v1/cafeteria/admin/topup/{topup.pk}/link-pos/",
                {"transaction": dup.pk},
                format="json",
            )
        assert r.status_code == 200, r.content
        dup.refresh_from_db()
        topup.refresh_from_db()
        assert dup.loyverse_receipt_id == f"topup-desk-{topup.pk}"
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert topup.applied_via == TopUpRequest.AppliedVia.POS_SYNC
        assert wallet(student) == Decimal("300")  # unchanged
        assert receipt.call_count == 1
        totals = today_report()
        assert totals["total"] == Decimal("200") and totals["pos"] == Decimal("0")
        assert AuditLog.objects.filter(context="cafeteria.topup.linked_to_loyverse").exists()

        again = admin_client.post(
            f"/api/v1/cafeteria/admin/topup/{topup.pk}/link-pos/",
            {"transaction": dup.pk},
            format="json",
        )
        assert again.status_code == 409

    def test_link_refuses_another_amount_or_student(self, student):
        topup = desk_topup(student)
        other = anonymous_pos_recarga(student, "150.00")
        with pytest.raises(HandLoadError) as err:
            link_mirrored_topup(topup.pk, other.pk, actor=None)
        assert err.value.code == "mismatch"

    def test_link_of_an_unverified_card_approval_is_refused(self, student):
        _, topup, _ = paid_topup(student=student, parent=student.parents.first(), checkout="PRD")
        dup = anonymous_pos_recarga(student)
        with pytest.raises(HandLoadError) as err:
            link_mirrored_topup(topup.pk, dup.pk, actor=None)
        assert err.value.code == "needs_verification"

    def test_link_of_a_paid_card_topup(self, student):
        _, topup, payment = paid_topup(student=student, parent=student.parents.first())
        dup = anonymous_pos_recarga(student)
        link_mirrored_topup(topup.pk, dup.pk, actor=None)
        dup.refresh_from_db()
        topup.refresh_from_db()
        assert dup.loyverse_receipt_id == f"topup-payment-{payment.pk}"
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert wallet(student) == Decimal("300")
