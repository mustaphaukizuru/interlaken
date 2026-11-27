"""«Caja»: money taken at the front desk (owner 2026-11-27).

Pins ``cafeteria/caja.py``: the desk finds the account by the credential's
code or the matrícula (never by name), records the method, and the app writes
Loyverse FIRST and credits the wallet only when Loyverse shows the new
balance (the fake Loyverse of ``test_loyverse_push`` answers like the real
API). Voids go back the same way; nothing is deleted. Every name is invented.
"""

from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import User
from apps.cafeteria import caja
from apps.cafeteria.models import (
    BalanceAdjustment,
    CafeteriaBalance,
    CafeteriaTransaction,
    LoyverseProfile,
    TopUpRequest,
)
from apps.cafeteria.test_loyverse_push import ALL, GET, RECEIPTS, SET, FakeLoyverse
from apps.cafeteria.test_topup_scheduled_apply import seeded
from apps.core.models import AuditLog
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db

BASE = "/api/v1/cafeteria/admin/caja"
CASH, CARD, LINK = "cash", "card", "link"


@pytest.fixture
def loyverse(settings):
    settings.CAFETERIA_TOPUP_LOYVERSE_PUSH = "instant"
    settings.PAYMENTS_LIVE = False  # the desk never depends on the card gateway
    fake = FakeLoyverse(points=100)
    with (
        patch(GET, side_effect=fake.get),
        patch(SET, side_effect=fake.write),
        patch(RECEIPTS, return_value=[]),
        patch(ALL, return_value=[]),
        patch("apps.portal.services.send_email", return_value=True),
    ):
        yield fake


@pytest.fixture
def pupil():
    parent = ParentFactory()
    student = StudentProfileFactory(parents=[parent], loyverse_id="lv-1", student_id="04512")
    LoyverseProfile.objects.create(
        student=student, loyverse_id="lv-1", customer_code="ci09999", name="ALUMNO"
    )
    seeded(student, 100)
    return student


@pytest.fixture
def desk():
    """A console user holding only the «Caja» area (Veronica's job)."""
    return UserFactory(role=User.Role.STAFF, staff_areas=["caja"], email="caja@test.mx")


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def post(c, student, amount="200", method=CASH, **extra):
    body = {
        "student": student.pk,
        "amount": amount,
        "desk_method": method,
        "idempotency_key": extra.pop("key", f"k-{amount}-{method}-{extra.get('reference', '')}"),
        **extra,
    }
    return c.post(f"{BASE}/topups/", body, format="json")


def wallet(student):
    return CafeteriaBalance.objects.get(student=student).balance


class TestLookup:
    def test_finds_by_scanned_code_typed_matricula_and_staff_code(self, pupil, desk):
        staff = StudentProfileFactory(
            tipo="personal",
            puesto="docente",
            student_id="rlince",
            grade="",
            group="",
            loyverse_id="lv-9",
        )
        c = client_for(desk)
        # The barcode carries the Loyverse code; the desk may type the matrícula.
        for code in ("ci09999", "CI09999", "04512", "ci04512"):
            rows = c.get(f"{BASE}/lookup/", {"code": code}).json()["results"]
            assert [r["id"] for r in rows] == [pupil.pk], code
        assert c.get(f"{BASE}/lookup/", {"code": "rlince"}).json()["results"][0]["id"] == staff.pk

    def test_never_searches_by_name_and_skips_inactive(self, pupil, desk):
        c = client_for(desk)
        assert c.get(f"{BASE}/lookup/", {"code": pupil.user.last_name}).json()["results"] == []
        pupil.is_active = False
        pupil.save(update_fields=["is_active"])
        assert c.get(f"{BASE}/lookup/", {"code": "ci09999"}).json()["results"] == []


class TestCreate:
    def test_cash_goes_to_loyverse_first_then_the_wallet_with_a_receipt(
        self, loyverse, pupil, desk, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            r = post(client_for(desk), pupil, "200")
        assert r.status_code == 201, r.content
        body = r.json()
        assert body["outcome"]["state"] == "pushed"
        assert loyverse.points == Decimal("300") and wallet(pupil) == Decimal("300")
        topup = TopUpRequest.objects.get()
        assert topup.receipt_folio == f"R-{topup.pk:06d}"
        assert (topup.status, topup.desk_method, topup.received_by) == ("completed", CASH, desk)
        assert topup.loyverse_push_state == TopUpRequest.PushState.PUSHED
        tx = CafeteriaTransaction.objects.get(loyverse_receipt_id=f"topup-desk-{topup.pk}")
        assert tx.description == f"Recarga en recepción, efectivo · Folio {topup.receipt_folio}"
        assert Notification.objects.filter(title="Recibimos su recarga").exists()
        assert AuditLog.objects.filter(context="cafeteria.caja").exists()
        assert not topup.desk_needs_verification  # cash is never verified

    def test_card_and_link_need_a_reference_and_then_wait_for_multicobros(
        self, loyverse, pupil, desk
    ):
        c = client_for(desk)
        r = post(c, pupil, "100", CARD)
        assert r.status_code == 400 and r.json()["code"] == "reference"
        r = post(c, pupil, "100", LINK, reference="LIGA-77")
        assert r.status_code == 201 and r.json()["topup"]["needs_verification"]
        topup = TopUpRequest.objects.get()
        r = c.post(f"{BASE}/topups/{topup.pk}/verify/", {}, format="json")
        assert r.status_code == 200 and r.json()["topup"]["needs_verification"] is False

    def test_the_maximum_is_the_portal_maximum(self, loyverse, pupil, desk, settings):
        settings.CAFETERIA_TOPUP_MAX = "1000"
        r = post(client_for(desk), pupil, "1200")
        assert r.status_code == 400 and r.json()["code"] == "amount_max"
        assert loyverse.writes == [] and not TopUpRequest.objects.exists()

    def test_unlinked_account_is_refused(self, loyverse, desk):
        student = StudentProfileFactory(loyverse_id="")
        r = post(client_for(desk), student, "100")
        assert r.status_code == 400 and r.json()["code"] == "not_linked"

    def test_same_amount_twice_asks_first_then_records_on_confirm(self, loyverse, pupil, desk):
        c = client_for(desk)
        assert post(c, pupil, "200", key="a").status_code == 201
        r = post(c, pupil, "200", key="b")
        assert r.status_code == 409 and r.json()["code"] == "possible_duplicate"
        assert r.json()["folio"]
        assert post(c, pupil, "200", key="b", confirm_duplicate=True).status_code == 201
        assert wallet(pupil) == Decimal("500") and loyverse.points == Decimal("500")

    def test_a_double_click_never_records_two(self, loyverse, pupil, desk):
        c = client_for(desk)
        first = post(c, pupil, "150", key="same")
        again = post(c, pupil, "150", key="same")
        assert first.status_code == 201 and again.status_code == 200
        assert TopUpRequest.objects.count() == 1 and wallet(pupil) == Decimal("250")


class TestLoyverseFirst:
    def test_wallet_untouched_when_the_write_is_rejected(self, loyverse, pupil, desk):
        loyverse.reject = True
        r = post(client_for(desk), pupil, "200")
        assert r.json()["outcome"]["state"] == "failed"
        assert wallet(pupil) == Decimal("100")
        topup = TopUpRequest.objects.get()
        assert topup.status == "pending" and topup.loyverse_push_state == "failed"

    def test_wallet_untouched_when_the_reread_differs(self, loyverse, pupil, desk):
        loyverse.after_write = lambda points: points - 40  # a sale landed right after
        r = post(client_for(desk), pupil, "200")
        assert r.json()["outcome"]["state"] == "failed" and wallet(pupil) == Decimal("100")

    def test_waits_when_loyverse_and_wallet_disagree_and_the_cron_retries(
        self, loyverse, pupil, desk
    ):
        loyverse.set(90)  # a sale in flight
        r = post(client_for(desk), pupil, "200")
        assert r.json()["outcome"]["state"] == "waiting"
        assert loyverse.writes == [] and wallet(pupil) == Decimal("100")
        loyverse.set(100)
        assert caja.push_due_desk_topups()["pushed"] == 1
        assert wallet(pupil) == Decimal("300") and loyverse.points == Decimal("300")

    def test_push_off_leaves_it_for_depositos(self, loyverse, pupil, desk, settings):
        settings.CAFETERIA_TOPUP_LOYVERSE_PUSH = "off"
        r = post(client_for(desk), pupil, "200")
        assert r.json()["outcome"]["state"] == "skipped"
        assert loyverse.writes == [] and TopUpRequest.objects.get().status == "pending"


class TestVoid:
    def _recorded(self, desk, pupil, amount="200"):
        post(client_for(desk), pupil, amount)
        return TopUpRequest.objects.get()

    def test_void_takes_it_back_from_loyverse_and_the_wallet(
        self, loyverse, pupil, desk, django_capture_on_commit_callbacks
    ):
        topup = self._recorded(desk, pupil)
        c = client_for(desk)
        assert (
            c.post(f"{BASE}/topups/{topup.pk}/void/", {}, format="json").json()["code"] == "reason"
        )
        with django_capture_on_commit_callbacks(execute=True):
            r = c.post(
                f"{BASE}/topups/{topup.pk}/void/", {"reason": "Monto equivocado"}, format="json"
            )
        assert r.status_code == 200, r.content
        assert loyverse.points == Decimal("100") and wallet(pupil) == Decimal("100")
        topup.refresh_from_db()
        assert topup.voided_at and topup.voided_by == desk and topup.status == "completed"
        adj = BalanceAdjustment.objects.get()
        assert adj.amount == Decimal("-200")
        assert Notification.objects.filter(title="Recarga anulada").exists()
        again = c.post(f"{BASE}/topups/{topup.pk}/void/", {"reason": "otra vez"}, format="json")
        assert again.status_code == 409 and again.json()["code"] == "already_voided"

    def test_money_already_spent_is_refused(self, loyverse, pupil, desk):
        topup = self._recorded(desk, pupil, "200")
        CafeteriaBalance.objects.filter(student=pupil).update(balance=Decimal("50"))
        loyverse.set(50)
        r = client_for(desk).post(f"{BASE}/topups/{topup.pk}/void/", {"reason": "x"}, format="json")
        assert r.status_code == 409 and r.json()["code"] == "already_spent"
        assert loyverse.points == Decimal("50")

    def test_a_top_up_never_loaded_is_just_cancelled(self, loyverse, pupil, desk):
        loyverse.set(90)
        post(client_for(desk), pupil, "200")
        topup = TopUpRequest.objects.get()
        r = client_for(desk).post(
            f"{BASE}/topups/{topup.pk}/void/", {"reason": "error"}, format="json"
        )
        assert r.json()["result"]["state"] == "cancelled"
        assert loyverse.writes == [] and wallet(pupil) == Decimal("100")
        assert caja.push_due_desk_topups()["pushed"] == 0  # never loaded later


class TestPermissions:
    def test_only_caja_area_and_admins(self, loyverse, pupil):
        other = UserFactory(role=User.Role.STAFF, staff_areas=["cafeteria"], email="otra@test.mx")
        parent = ParentFactory()
        assert client_for(other).get(f"{BASE}/lookup/", {"code": "ci09999"}).status_code == 403
        assert client_for(parent).get(f"{BASE}/topups/").status_code == 403
        assert (
            client_for(AdminFactory()).get(f"{BASE}/lookup/", {"code": "ci09999"}).status_code
            == 200
        )

    def test_each_person_sees_their_own_day_admins_see_all(self, loyverse, pupil, desk):
        other = UserFactory(role=User.Role.STAFF, staff_areas=["caja"], email="otra@test.mx")
        post(client_for(desk), pupil, "100", key="x1")
        post(client_for(other), pupil, "120", key="x2")
        assert len(client_for(desk).get(f"{BASE}/topups/").json()["results"]) == 1
        assert len(client_for(AdminFactory()).get(f"{BASE}/topups/").json()["results"]) == 2
        mine = TopUpRequest.objects.get(received_by=other)
        assert client_for(desk).get(f"{BASE}/topups/{mine.pk}/").status_code == 404

    def test_receipt_details(self, loyverse, pupil, desk):
        post(client_for(desk), pupil, "100")
        topup = TopUpRequest.objects.get()
        body = client_for(desk).get(f"{BASE}/topups/{topup.pk}/").json()
        labels = [label for label, _ in body["details"]]
        assert (
            labels[:4] == ["Folio", "Alumno", "Monto", "Forma de pago"] and "Saldo actual" in labels
        )
        assert timezone.localdate().strftime("%d/%m/%Y") in dict(body["details"])["Fecha"]
