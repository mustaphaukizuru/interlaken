"""Parent dashboard «Saldo bajo» honours paid top-ups on their way (launch leftover F1).

The family cafetería card and the low-balance email already stay quiet when
paid card top-ups waiting for the POS load cover the alert level
(``pending_covers_low_balance``). The dashboard's ``low`` flag now follows the
same rule, from the top-ups it already reads (no query per child).
"""

from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, TopUpRequest
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db


def _child(parent, *, balance, threshold="50.00", paid=()):
    student = StudentProfileFactory(parents=[parent])
    CafeteriaBalance.objects.create(
        student=student, balance=Decimal(balance), low_balance_threshold=Decimal(threshold)
    )
    for amount in paid:
        topup = TopUpRequest.objects.create(
            student=student,
            amount=Decimal(amount),
            method=TopUpRequest.Method.ONLINE,
            status=TopUpRequest.Status.PAID,
        )
        Payment.objects.create(
            user=parent,
            payment_type=Payment.Type.CAFETERIA,
            amount=Decimal(amount),
            related_topup=topup,
            status=Payment.Status.SUCCESS,
        )
    return student


def _low(api_client, parent):
    api_client.force_authenticate(parent)
    resp = api_client.get(reverse("dashboard"))
    assert resp.status_code == 200
    return {b["student"]: (b["low"], b["pending_topups"]) for b in resp.data["cafeteria_balances"]}


def test_paid_top_up_that_covers_the_level_hides_saldo_bajo(api_client):
    parent = ParentFactory()
    kid = _child(parent, balance="10.00", paid=["100.00"])
    assert _low(api_client, parent)[kid.pk] == (False, "100.00")


def test_a_top_up_that_does_not_reach_the_level_keeps_it(api_client):
    parent = ParentFactory()
    kid = _child(parent, balance="10.00", paid=["20.00"])  # 30 < 50
    assert _low(api_client, parent)[kid.pk] == (True, "20.00")


def test_two_top_ups_add_up_and_exactly_the_level_counts_as_covered(api_client):
    parent = ParentFactory()
    kid = _child(parent, balance="10.00", paid=["20.00", "20.00"])  # 50 >= 50
    assert _low(api_client, parent)[kid.pk] == (False, "40.00")


def test_without_pending_top_ups_the_balance_speaks_alone(api_client):
    parent = ParentFactory()
    low = _child(parent, balance="10.00")
    fine = _child(parent, balance="80.00")
    assert _low(api_client, parent) == {low.pk: (True, "0.00"), fine.pk: (False, "0.00")}


def test_each_child_on_its_own_rule(api_client):
    parent = ParentFactory()
    covered = _child(parent, balance="5.00", paid=["100.00"])
    uncovered = _child(parent, balance="5.00")
    flags = _low(api_client, parent)
    assert flags[covered.pk][0] is False and flags[uncovered.pk][0] is True


def test_a_refunded_top_up_does_not_count(api_client):
    parent = ParentFactory()
    kid = _child(parent, balance="10.00", paid=["100.00"])
    Payment.objects.filter(related_topup__student=kid).update(status=Payment.Status.REFUNDED)
    assert _low(api_client, parent)[kid.pk][0] is True


@pytest.mark.parametrize("n_children", [1, 4])
def test_no_query_per_child(api_client, n_children):
    """The same number of queries for one child or four, each with a paid top-up."""
    parent = ParentFactory()
    for _ in range(n_children):
        _child(parent, balance="10.00", paid=["100.00"])
    api_client.force_authenticate(parent)
    api_client.get(reverse("dashboard"))  # warm caches (settings, etc.)
    with CaptureQueriesContext(connection) as ctx:
        api_client.get(reverse("dashboard"))
    # students + balances + payments + announcements + unread + top-ups + folios.
    assert len(ctx) == 7
