"""
"Consumo registrado" (owner, 2026-11-08).

The family credential ("Gasto histórico") and the admin console ("Gasto total")
showed Loyverse's customer ``total_spent``, which only counts cash and card.
The school's wallet is Loyverse points, so most pupils showed $0.00 (one with
274 visits and 31 wallet purchases worth $907). The figure now comes from the
ledger: every PURCHASE row of the student (``amount`` is positive, the wallet
moved by -amount), with the local date of the first one.
"""

from datetime import datetime
from datetime import timezone as dt_timezone
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, LoyverseProfile
from apps.cafeteria.serializers import NO_CONSUMPTION, build_consumption_map

pytestmark = pytest.mark.django_db

UTC = dt_timezone.utc
# What _pupil() records: 40.00 + 55.50 + 12.00, first bought on 2 Sept 2024 (local).
CONSUMED = {"total": "107.50", "since": "2024-09-02"}


def _tx(student, kind, amount, when, **kw):
    return CafeteriaTransaction.objects.create(
        student=student,
        transaction_type=kind,
        amount=Decimal(amount),
        date=when,
        loyverse_receipt_id=f"{kind}-{student.pk}-{when:%Y%m%d%H%M}",
        **kw,
    )


def _pupil(parent=None, **profile):
    """The production case: Loyverse says $0.00 spent, the ledger holds the purchases."""
    student = StudentProfileFactory(parents=[parent] if parent else [])
    LoyverseProfile.objects.create(
        student=student,
        loyverse_id=student.loyverse_id,
        kind=LoyverseProfile.Kind.STUDENT,
        name=student.user.full_name,
        total_visits=274,
        total_spent=Decimal(profile.get("total_spent", "0")),
        total_points=Decimal("120"),
    )
    # 03:00 UTC on 3 Sept is 21:00 on 2 Sept in Mexico City: the local date counts.
    # applied=False: history older than the opening balance, still a purchase.
    _tx(student, "purchase", "40.00", datetime(2024, 9, 3, 3, 0, tzinfo=UTC), applied=False)
    _tx(student, "purchase", "55.50", datetime(2026, 10, 1, 18, 0, tzinfo=UTC))
    _tx(student, "purchase", "12.00", datetime(2026, 11, 5, 18, 0, tzinfo=UTC))
    # Not consumption: money in. Refunds are not netted (same as the spend
    # trend, categories and budgets).
    _tx(student, "topup", "500.00", datetime(2026, 9, 1, 15, 0, tzinfo=UTC))
    _tx(student, "refund", "12.00", datetime(2026, 11, 5, 19, 0, tzinfo=UTC))
    return student


class TestBuildConsumptionMap:
    def test_every_purchase_with_the_local_date_of_the_first(self):
        a, b = _pupil(), _pupil()
        _tx(b, "purchase", "1.00", datetime(2026, 11, 6, 18, 0, tzinfo=UTC))
        nothing_yet = StudentProfileFactory()
        got = build_consumption_map([a, b, nothing_yet])
        assert got[a.pk] == CONSUMED
        assert got[b.pk] == {"total": "108.50", "since": "2024-09-02"}
        assert nothing_yet.pk not in got
        assert got.get(nothing_yet.pk, NO_CONSUMPTION) == {"total": "0.00", "since": None}


class TestFamilyCard:
    def test_card_carries_the_ledger_consumption(self, api_client):
        parent = ParentFactory()
        _pupil(parent)
        api_client.force_authenticate(parent)
        card = api_client.get(reverse("cafeteria-cards")).data[0]
        assert card["consumption"] == CONSUMED
        assert card["loyverse"]["total_spent"] == "0.00"  # what "Gasto histórico" showed

    def test_no_purchase_yet(self, api_client):
        parent = ParentFactory()
        StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(parent)
        card = api_client.get(reverse("cafeteria-cards")).data[0]
        assert card["consumption"] == {"total": "0.00", "since": None}

    def test_one_query_whatever_the_number_of_children(self, api_client):
        def queries(children):
            parent = ParentFactory()
            for _ in range(children):
                _pupil(parent)
            api_client.force_authenticate(parent)
            with CaptureQueriesContext(connection) as ctx:
                resp = api_client.get(reverse("cafeteria-cards"))
            assert [c["consumption"] for c in resp.data] == [CONSUMED] * children
            return len(ctx.captured_queries)

        assert queries(1) == queries(3)


class TestAdminStudent:
    def test_console_shows_the_same_figure(self, api_client):
        student = _pupil()
        CafeteriaBalance.objects.create(student=student, balance=Decimal("120"))
        api_client.force_authenticate(AdminFactory())
        data = api_client.get(
            reverse("admin-student-detail", args=[student.pk]), {"ledger": 0}
        ).data
        assert data["consumption"] == CONSUMED
        assert data["loyverse"]["total_spent"] == "0.00"


class TestCustomersDirectory:
    """``spent`` sorts by the ledger figure; non-student cards have none."""

    def _store(self):
        big = _pupil(total_spent="0")
        small = StudentProfileFactory()
        LoyverseProfile.objects.create(
            student=small,
            loyverse_id=small.loyverse_id,
            kind=LoyverseProfile.Kind.STUDENT,
            name="Pupil small",
            total_spent=Decimal("144"),
        )
        _tx(small, "purchase", "5.00", datetime(2026, 11, 2, 18, 0, tzinfo=UTC))
        idle = StudentProfileFactory()
        LoyverseProfile.objects.create(
            student=idle, loyverse_id=idle.loyverse_id, kind=LoyverseProfile.Kind.STUDENT
        )
        LoyverseProfile.objects.create(
            loyverse_id="staff-1",
            kind=LoyverseProfile.Kind.STAFF,
            name="Cocina",
            total_spent=Decimal("9000"),
        )
        return big, small, idle

    def test_list_sorts_by_consumption(self, api_client):
        big, small, idle = self._store()
        api_client.force_authenticate(AdminFactory())
        rows = api_client.get(reverse("admin-customers"), {"ordering": "-spent"}).json()["results"]
        assert {r["loyverse_id"]: r["consumption"] for r in rows} == {
            big.loyverse_id: "107.50",
            small.loyverse_id: "5.00",
            idle.loyverse_id: "0.00",
            "staff-1": None,
        }
        assert [r["loyverse_id"] for r in rows[:2]] == [big.loyverse_id, small.loyverse_id]
        asc = api_client.get(reverse("admin-customers"), {"ordering": "spent", "kind": "student"})
        assert [r["loyverse_id"] for r in asc.json()["results"]] == [
            idle.loyverse_id,
            small.loyverse_id,
            big.loyverse_id,
        ]

    def test_export_names_each_figure_for_what_it_is(self, api_client):
        big, _, _ = self._store()
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(reverse("admin-customers-export"), {"fmt": "csv"})
        lines = b"".join(resp.streaming_content).decode("utf-8-sig").splitlines()
        header = lines[0].split(",")
        assert "Gasto total" not in header
        consumed = header.index("Consumo registrado")
        cash = header.index("Efectivo/tarjeta en caja")
        rows = {line.split(",")[0]: line.split(",") for line in lines[1:]}
        assert rows[big.user.full_name][consumed] == "107.50"
        assert rows[big.user.full_name][cash] == "0.00"
        assert rows["Pupil small"][consumed] == "5.00"
        assert rows["Pupil small"][cash] == "144.00"
        assert rows["Cocina"][consumed] == ""  # no ledger for a staff card
        assert rows["Cocina"][cash] == "9000.00"
