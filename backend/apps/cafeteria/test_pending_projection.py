"""Where the balance is heading: paid card top-ups on the dashboard and the card.

The owner's display (2026-11-19): one real balance (what the cashier has in
Loyverse) and, next to it, the figure after the paid top-ups the school has
not loaded yet, «$150.00 → $350.00 a partir de mañana 7:30». The cafetería
balance already lists them (``pending_topups``); the parent dashboard
(``pending_topup_items``) and the digital card (``pending_topups``) now carry
the same rows, read-only, with no query per child. Only PAID online top-ups
of the caller's own students count: refunded or applied ones never do.
Invented names and amounts only.
"""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import (
    AdminFactory,
    ParentFactory,
    StudentProfileFactory,
    StudentUserFactory,
)
from apps.cafeteria.models import CafeteriaBalance, TopUpRequest
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db


def child(parent, balance="150.00", **kw):
    student = StudentProfileFactory(parents=[parent], **kw)
    CafeteriaBalance.objects.create(
        student=student, balance=Decimal(balance), last_synced=timezone.now()
    )
    return student


def staff_account(user):
    return StudentProfileFactory(user=user, tipo="personal", grade="", group="", puesto="docente")


def paid(
    student,
    amount="200.00",
    *,
    user=None,
    status=TopUpRequest.Status.PAID,
    payment_status=Payment.Status.SUCCESS,
    due_in_hours=20,
):
    """A paid card top-up waiting for the POS load (or in another state)."""
    now = timezone.now()
    topup = TopUpRequest.objects.create(
        student=student,
        amount=Decimal(amount),
        method=TopUpRequest.Method.ONLINE,
        status=status,
        processed_at=now,
        apply_due_at=now + timedelta(hours=due_in_hours),
    )
    payment = Payment.objects.create(
        user=user or student.parents.first() or student.user,
        payment_type=Payment.Type.CAFETERIA,
        amount=Decimal(amount),
        related_topup=topup,
        status=payment_status,
    )
    return topup, payment


def dashboard_rows(api_client, user):
    api_client.force_authenticate(user)
    resp = api_client.get(reverse("dashboard"))
    assert resp.status_code == 200
    return {b["student"]: b for b in resp.data["cafeteria_balances"]}


def cards(api_client, user, **params):
    api_client.force_authenticate(user)
    resp = api_client.get(reverse("cafeteria-cards"), params)
    assert resp.status_code == 200
    return {c["student"]["id"]: c for c in resp.data}


class TestDashboard:
    def test_each_paid_top_up_comes_with_its_promised_load(self, api_client):
        parent = ParentFactory()
        kid = child(parent)
        topup, payment = paid(kid, "200.00")
        row = dashboard_rows(api_client, parent)[kid.pk]
        assert row["balance"] == "150.00"  # the real balance does not move
        assert row["pending_topups"] == "200.00"  # the old total stays as it was
        [item] = row["pending_topup_items"]
        assert item["amount"] == "200.00"
        assert item["apply_due_at"] == topup.apply_due_at.isoformat()
        assert item["folio"] == payment.pk

    def test_nothing_pending_is_an_empty_list(self, api_client):
        parent = ParentFactory()
        kid = child(parent)
        assert dashboard_rows(api_client, parent)[kid.pk]["pending_topup_items"] == []

    def test_refunded_and_applied_top_ups_are_left_out(self, api_client):
        parent = ParentFactory()
        kid = child(parent)
        paid(kid, "50.00", payment_status=Payment.Status.REFUNDED)
        paid(kid, "70.00", status=TopUpRequest.Status.COMPLETED)
        kept, _ = paid(kid, "30.00")
        items = dashboard_rows(api_client, parent)[kid.pk]["pending_topup_items"]
        assert [(i["id"], i["amount"]) for i in items] == [(kept.pk, "30.00")]

    def test_only_the_family_s_own_children(self, api_client):
        parent = ParentFactory()
        mine = child(parent)
        other_family = child(ParentFactory())
        paid(other_family, "500.00")
        rows = dashboard_rows(api_client, parent)
        assert set(rows) == {mine.pk}
        assert rows[mine.pk]["pending_topup_items"] == []

    @pytest.mark.parametrize("n_children", [1, 4])
    def test_no_query_per_child(self, api_client, n_children):
        parent = ParentFactory()
        for _ in range(n_children):
            kid = child(parent)
            paid(kid, "100.00")
            paid(kid, "20.00")
        api_client.force_authenticate(parent)
        api_client.get(reverse("dashboard"))  # warm caches (settings, etc.)
        with CaptureQueriesContext(connection) as ctx:
            resp = api_client.get(reverse("dashboard"))
        assert all(len(b["pending_topup_items"]) == 2 for b in resp.data["cafeteria_balances"])
        # students + balances + payments + announcements + unread + top-ups + folios:
        # the items reuse the top-ups already read for «Saldo bajo».
        assert len(ctx) == 7


class TestCard:
    def test_the_card_lists_the_child_s_paid_top_ups(self, api_client):
        parent = ParentFactory()
        waiting = child(parent, loyverse_id="lv-a")
        calm = child(parent, loyverse_id="lv-b")
        topup, payment = paid(waiting, "200.00")
        got = cards(api_client, parent)
        assert got[waiting.pk]["balance"] == "150.00"
        [item] = got[waiting.pk]["pending_topups"]
        assert (item["amount"], item["folio"]) == ("200.00", payment.pk)
        assert item["apply_due_at"] == topup.apply_due_at.isoformat()
        assert got[calm.pk]["pending_topups"] == []

    def test_refunded_and_applied_are_left_out(self, api_client):
        parent = ParentFactory()
        kid = child(parent, loyverse_id="lv-c")
        paid(kid, "50.00", payment_status=Payment.Status.REFUNDED)
        paid(kid, "70.00", status=TopUpRequest.Status.COMPLETED)
        assert cards(api_client, parent)[kid.pk]["pending_topups"] == []

    def test_another_family_s_top_up_never_shows(self, api_client):
        parent = ParentFactory()
        mine = child(parent, loyverse_id="lv-d")
        other = child(ParentFactory(), loyverse_id="lv-e")
        paid(other, "500.00")
        got = cards(api_client, parent)
        assert set(got) == {mine.pk} and got[mine.pk]["pending_topups"] == []

    def test_mine_shows_only_the_staff_member_s_own_account(self, api_client):
        admin = AdminFactory()
        own = staff_account(admin)
        CafeteriaBalance.objects.create(student=own, balance=Decimal("80.00"))
        topup, _ = paid(own, "120.00", user=admin)
        pupil = child(ParentFactory(), loyverse_id="lv-f")
        paid(pupil, "300.00")
        got = cards(api_client, admin, mine=1)
        assert set(got) == {own.pk}
        assert [i["id"] for i in got[own.pk]["pending_topups"]] == [topup.pk]

    def test_mine_on_the_balance_too(self, api_client):
        """«Mi cafetería» reads the balance endpoint: same scoping, same rows."""
        staff_user = StudentUserFactory()
        own = staff_account(staff_user)
        CafeteriaBalance.objects.create(student=own, balance=Decimal("80.00"))
        topup, _ = paid(own, "120.00", user=staff_user)
        paid(child(ParentFactory()), "300.00")
        api_client.force_authenticate(staff_user)
        data = api_client.get(reverse("cafeteria-balance"), {"mine": 1}).data
        assert [b["student"]["id"] for b in data] == [own.pk]
        assert [i["id"] for i in data[0]["pending_topups"]] == [topup.pk]

    def test_constant_queries_whatever_the_number_of_children(self, api_client):
        def queries(n):
            parent = ParentFactory()
            for i in range(n):
                kid = child(parent, loyverse_id=f"lv-q{n}-{i}")
                paid(kid, "100.00")
            api_client.force_authenticate(parent)
            api_client.get(reverse("cafeteria-cards"))  # warm caches
            with CaptureQueriesContext(connection) as ctx:
                resp = api_client.get(reverse("cafeteria-cards"))
            assert all(len(c["pending_topups"]) == 1 for c in resp.data)
            return len(ctx.captured_queries)

        assert queries(1) == queries(3)
