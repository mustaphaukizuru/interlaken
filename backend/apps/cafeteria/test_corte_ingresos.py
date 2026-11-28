"""«Corte de caja» and «Ingresos de cafetería» (Caja Part 2, owner 2026-11-27).

Pins ``cafeteria/corte.py`` (expected totals per person and day, close, the
closed-day guard on voids and new top-ups, admin reopen) and
``cafeteria/ingresos.py`` (income by channel and day, each top-up counted once:
true POS recargas are the ``pos-topup-`` ledger rows only, never the app's own
loads). Every name is invented.
"""

import itertools
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import User
from apps.cafeteria import corte, ingresos
from apps.cafeteria import test_caja as caja_fixtures
from apps.cafeteria.models import (
    BalanceAdjustment,
    CafeteriaTransaction,
    DeskCashClose,
    TopUpRequest,
)
from apps.cafeteria.test_caja import BASE, client_for, post
from apps.core.listing import MEXICO_CITY
from apps.core.models import AuditLog
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

# Part 1's fixtures (fake Loyverse, a linked pupil, a «Caja»-only user).
loyverse = caja_fixtures.loyverse
pupil = caja_fixtures.pupil
desk = caja_fixtures.desk
_seq = itertools.count(1)

INGRESOS = "/api/v1/cafeteria/admin/ingresos"
D = Decimal


def at(day, hour=10, minute=0):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=MEXICO_CITY)


def desk_row(
    user,
    student,
    amount,
    method="cash",
    *,
    when=None,
    status="completed",
    voided=False,
    verified=False,
):
    """A desk top-up row as Part 1 leaves it (no Loyverse needed here)."""
    n = next(_seq)
    t = TopUpRequest.objects.create(
        student=student,
        amount=D(amount),
        method=TopUpRequest.Method.OFFICE,
        desk_method=method,
        received_by=user,
        status=status,
        reference="" if method == "cash" else f"REF{n}",
        receipt_folio=f"R-T{n:05d}",
        created_at=when or timezone.now(),
    )
    if voided:
        t.voided_at, t.voided_by, t.void_reason = timezone.now(), user, "Error de captura"
        t.save(update_fields=["voided_at", "voided_by", "void_reason"])
    if verified:
        t.desk_verified_at = timezone.now()
        t.save(update_fields=["desk_verified_at"])
    return t


@pytest.fixture
def admin():
    return UserFactory(role=User.Role.ADMIN, email="direccion@test.mx")


@pytest.fixture
def child():
    return StudentProfileFactory(parents=[ParentFactory()], loyverse_id="lv-9", student_id="09001")


# ── corte de caja ────────────────────────────────────────────────────────────


def test_summary_counts_by_method_includes_waiting_and_lists_voids_and_duplicates(desk, child):
    today = corte.today()
    desk_row(desk, child, "200", "cash", when=at(today, 9))
    desk_row(desk, child, "200", "cash", when=at(today, 9, 5))  # same child + amount: duplicate?
    desk_row(desk, child, "150", "card", when=at(today, 11))
    desk_row(desk, child, "80", "link", when=at(today, 12), status="pending")  # waits for Loyverse
    desk_row(desk, child, "50", "cash", when=at(today, 13), voided=True)
    desk_row(desk, child, "999", "cash", when=at(today - timedelta(days=1), 10))  # yesterday
    other = UserFactory(role=User.Role.STAFF, staff_areas=["caja"])
    desk_row(other, child, "300", "cash", when=at(today, 10))  # someone else's drawer

    s = corte.summary(desk, today)
    assert s["expected"] == {"cash": "400.00", "card": "150.00", "link": "80.00"}
    assert s["expected_total"] == "630.00"
    assert s["count"] == 4
    assert s["pending_load"] == {"count": 1, "amount": "80.00"}
    assert [v["amount"] for v in s["voids"]] == ["50.00"]
    assert len(s["duplicates"]) == 1 and s["duplicates"][0]["amount"] == "200.00"
    assert s["close"] is None


def test_close_snapshot_differences_and_no_second_close(desk, child):
    today = corte.today()
    desk_row(desk, child, "200", "cash", when=at(today, 9))
    desk_row(desk, child, "150", "card", when=at(today, 10))
    c = client_for(desk)
    r = c.post(
        f"{BASE}/corte/close/",
        {"day": today.isoformat(), "counted_cash": "180", "note": "Faltan 20"},
        format="json",
    )
    assert r.status_code == 200, r.content
    close = r.json()["close"]
    assert close["closed"] is True
    assert close["expected"]["cash"] == "200.00" and close["counted"]["cash"] == "180.00"
    assert close["difference"]["cash"] == "-20.00"
    assert close["difference"]["card"] is None  # card total not typed: no difference claimed
    assert AuditLog.objects.filter(context="cafeteria.caja.corte").exists()
    again = c.post(
        f"{BASE}/corte/close/", {"day": today.isoformat(), "counted_cash": "200"}, format="json"
    )
    assert again.status_code == 409 and again.json()["code"] == "already_closed"


def test_close_needs_counted_cash_and_refuses_the_future(desk):
    c = client_for(desk)
    r = c.post(f"{BASE}/corte/close/", {"day": corte.today().isoformat()}, format="json")
    assert r.status_code == 400 and r.json()["code"] == "counted_cash"
    future = (corte.today() + timedelta(days=1)).isoformat()
    r = c.post(f"{BASE}/corte/close/", {"day": future, "counted_cash": "0"}, format="json")
    assert r.status_code == 400 and r.json()["code"] == "future"


def test_closed_day_blocks_void_and_new_topups_until_an_admin_reopens(loyverse, pupil, desk, admin):
    c = client_for(desk)
    r = post(c, pupil, "200")
    assert r.status_code == 201, r.content
    topup_id = r.json()["topup"]["id"]
    assert c.post(f"{BASE}/corte/close/", {"counted_cash": "200"}, format="json").status_code == 200

    void = c.post(f"{BASE}/topups/{topup_id}/void/", {"reason": "Error"}, format="json")
    assert void.status_code == 409 and void.json()["code"] == "corte_closed"
    new = post(c, pupil, "100")
    assert new.status_code == 409 and new.json()["code"] == "corte_closed"

    close_id = DeskCashClose.objects.get(user=desk).pk
    assert (
        c.post(f"{BASE}/corte/{close_id}/reopen/", {"reason": "x"}, format="json").status_code
        == 403
    )
    a = client_for(admin)
    assert (
        a.post(f"{BASE}/corte/{close_id}/reopen/", {"reason": ""}, format="json").status_code == 400
    )
    r = a.post(f"{BASE}/corte/{close_id}/reopen/", {"reason": "Contó mal"}, format="json")
    assert r.status_code == 200 and r.json()["close"]["closed"] is False
    assert r.json()["close"]["reopen_reason"] == "Contó mal"
    void = c.post(f"{BASE}/topups/{topup_id}/void/", {"reason": "Error"}, format="json")
    assert void.status_code == 200, void.content


def test_each_person_sees_only_their_corte_admins_see_everyone(desk, admin, child):
    today = corte.today()
    other = UserFactory(role=User.Role.STAFF, staff_areas=["caja"])
    desk_row(other, child, "300", "cash", when=at(today, 9))
    desk_row(desk, child, "100", "cash", when=at(today, 9))

    mine = client_for(desk).get(f"{BASE}/corte/", {"user": other.pk})
    assert mine.status_code == 200 and mine.json()["user"]["id"] == desk.pk  # ?user= ignored
    assert client_for(desk).get(f"{BASE}/cortes/").status_code == 403

    a = client_for(admin)
    theirs = a.get(f"{BASE}/corte/", {"user": other.pk})
    assert theirs.json()["expected"]["cash"] == "300.00"
    people = a.get(f"{BASE}/cortes/").json()["people"]
    assert {p["user"]["id"] for p in people} == {desk.pk, other.pk}

    no_area = UserFactory(role=User.Role.STAFF, staff_areas=["visitas"])
    assert client_for(no_area).get(f"{BASE}/corte/").status_code == 403


def test_admin_closes_for_someone_else(desk, admin, child):
    today = corte.today()
    desk_row(desk, child, "100", "cash", when=at(today, 9))
    r = client_for(admin).post(
        f"{BASE}/corte/close/", {"user": desk.pk, "counted_cash": "100"}, format="json"
    )
    assert r.status_code == 200 and r.json()["user"]["id"] == desk.pk
    close = DeskCashClose.objects.get(user=desk)
    assert close.closed_by == admin and close.is_closed


# ── ingresos de cafetería ────────────────────────────────────────────────────


def _portal(student, amount, when, *, refunded=False):
    t = TopUpRequest.objects.create(
        student=student,
        amount=D(amount),
        method=TopUpRequest.Method.ONLINE,
        status=TopUpRequest.Status.COMPLETED,
        processed_at=when,
        applied_at=when,
        created_at=when,
    )
    Payment.objects.create(
        user=student.parents.first(),
        payment_type="cafeteria",
        amount=D(amount),
        gateway="banorte",
        related_topup=t,
        status="refunded" if refunded else "success",
        completed_at=when,
    )
    # The app's own ledger row for that load: never a POS recarga.
    CafeteriaTransaction.objects.create(
        student=student,
        transaction_type="topup",
        amount=D(amount),
        loyverse_receipt_id=f"topup-payment-{t.pk}",
        description="Recarga en línea",
        date=when,
    )
    return t


def _pos(student, amount, when):
    n = next(_seq)
    return CafeteriaTransaction.objects.create(
        student=student,
        transaction_type="topup",
        amount=D(amount),
        loyverse_receipt_id=f"pos-topup-{student.pk}-{int(when.timestamp()) + n}",
        description="Recarga en caja de cafetería (POS Loyverse)",
        date=when,
    )


def test_report_counts_each_channel_once_and_reconciles(desk, child):
    day = corte.today() - timedelta(days=2)
    _portal(child, "300", at(day, 8))
    _portal(child, "999", at(day, 9), refunded=True)  # refunded: not income
    desk_row(desk, child, "200", "cash", when=at(day, 10))
    desk_row(desk, child, "150", "card", when=at(day, 11))  # not verified yet
    desk_row(desk, child, "70", "link", when=at(day, 12), verified=True)
    desk_row(desk, child, "40", "cash", when=at(day, 12, 30), status="pending")  # in the drawer
    desk_row(desk, child, "500", "cash", when=at(day, 13), voided=True)  # voided: never
    # The desk app load's own ledger row (Part 1 writes «topup-desk-<id>»): not POS.
    CafeteriaTransaction.objects.create(
        student=child,
        transaction_type="topup",
        amount=D("200"),
        loyverse_receipt_id="topup-desk-1",
        description="Recarga en recepción",
        date=at(day, 10),
    )
    _pos(child, "100", at(day, 14))
    dup = _pos(child, "60", at(day, 15))
    BalanceAdjustment.objects.create(
        student=child, amount=D("-60"), reason="Recarga duplicada", source_transaction=dup
    )  # reversed: not income

    rep = ingresos.report(day, day)
    row = rep["rows"][0]
    assert row["portal"] == D("300.00")
    assert row["desk_cash"] == D("240.00")
    assert row["desk_card"] == D("150.00")
    assert row["desk_link"] == D("70.00")
    assert row["pos"] == D("100.00")
    assert row["total"] == sum(row[k] for k in ingresos.CHANNEL_KEYS) == D("860.00")
    assert row["count"] == 6
    assert row["pending_load"] == D("40.00")
    assert row["to_verify"] == D("150.00")


def test_report_day_boundaries_follow_mexico_city(desk, child):
    day = corte.today() - timedelta(days=3)
    late = at(day, 23, 30)  # 05:30 UTC of the next day
    desk_row(desk, child, "100", "cash", when=late)
    _pos(child, "50", at(day + timedelta(days=1), 0, 15))
    rep = ingresos.report(day, day + timedelta(days=1))
    assert rep["rows"][0]["desk_cash"] == D("100.00")
    assert rep["rows"][1]["pos"] == D("50.00") and rep["rows"][1]["desk_cash"] == D("0.00")
    assert rep["totals"]["total"] == D("150.00")


def test_report_api_month_permissions_and_audited_export(desk, child, admin):
    day = corte.today()
    desk_row(desk, child, "120", "cash", when=at(day, 9))
    cafeteria_staff = UserFactory(role=User.Role.STAFF, staff_areas=["cafeteria"])
    r = client_for(cafeteria_staff).get(f"{INGRESOS}/", {"month": day.strftime("%Y-%m")})
    assert r.status_code == 200, r.content
    body = r.json()
    assert [c["key"] for c in body["channels"]] == ingresos.CHANNEL_KEYS
    assert body["totals"]["desk_cash"] == "120.00"
    assert len(body["rows"]) >= 28

    assert client_for(desk).get(f"{INGRESOS}/").status_code == 403  # «Caja» alone: no report
    assert client_for(admin).get(f"{INGRESOS}/", {"month": "2026-13"}).status_code == 400

    x = client_for(admin).get(
        f"{INGRESOS}/export/", {"fmt": "xlsx", "month": day.strftime("%Y-%m")}
    )
    assert x.status_code == 200
    assert AuditLog.objects.filter(object_type="export:cafeteria_ingresos").exists()
    rng = client_for(admin).get(f"{INGRESOS}/", {"from": day.isoformat(), "to": day.isoformat()})
    assert rng.json()["totals"]["total"] == "120.00" and len(rng.json()["rows"]) == 1
