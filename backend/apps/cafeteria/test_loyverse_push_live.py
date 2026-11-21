"""OPT-IN live check of ``loyverse_push`` against the real Loyverse API.

Skipped unless BOTH are set (never in CI):

    LOYVERSE_LIVE_TEST=1 LOYVERSE_LIVE_TOKEN=<personal access token> pytest \\
        apps/cafeteria/test_loyverse_push_live.py

It creates a THROWAWAY Loyverse customer (``ZZ PRUEBA APP ... (borrar)``, no
email, linked to no real student), links it to a student in the throwaway
test database, runs the real push code, checks the result in Loyverse, and
deletes the customer at the end whatever happens. No real student, wallet or
family is touched. Run it after any Loyverse API change to re-prove the
2026-11-21 findings: points are writable, absolute, and the full record
survives the write.
"""

import os
import uuid
from decimal import Decimal

import pytest
import requests
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria import loyverse_push, services
from apps.cafeteria.models import CafeteriaBalance, TopUpRequest
from apps.cafeteria.test_topup_scheduled_apply import paid_topup
from apps.payments.models import BanorteCheckout

pytestmark = [
    pytest.mark.django_db,
    pytest.mark.skipif(
        not (os.getenv("LOYVERSE_LIVE_TEST") == "1" and os.getenv("LOYVERSE_LIVE_TOKEN")),
        reason="live Loyverse check: set LOYVERSE_LIVE_TEST=1 and LOYVERSE_LIVE_TOKEN",
    ),
]


@pytest.fixture
def throwaway(settings):
    """A fresh Loyverse customer with 100 points; deleted afterwards."""
    settings.LOYVERSE_API_TOKEN = os.environ["LOYVERSE_LIVE_TOKEN"]
    tag = uuid.uuid4().hex[:6].upper()
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {settings.LOYVERSE_API_TOKEN}"})
    created = session.post(
        f"{settings.LOYVERSE_BASE_URL}/customers",
        timeout=15,
        json={
            "name": f"ZZ PRUEBA APP {tag} (borrar)",
            "customer_code": f"ZZAPP{tag}",
            "note": "Prueba automática de la app. Se borra al terminar.",
        },
    )
    created.raise_for_status()
    customer_id = created.json()["id"]
    try:
        services.set_customer_points(services.get_customer_by_id(customer_id), 100)
        yield customer_id, f"ZZAPP{tag}"
    finally:
        session.delete(f"{settings.LOYVERSE_BASE_URL}/customers/{customer_id}", timeout=15)


def test_the_real_api_takes_the_top_up_and_keeps_the_record(settings, throwaway):
    customer_id, code = throwaway
    settings.PAYMENTS_LIVE = True
    settings.CAFETERIA_TOPUP_LOYVERSE_PUSH = "verified"
    parent = ParentFactory()
    student = StudentProfileFactory(parents=[parent], loyverse_id=customer_id)
    CafeteriaBalance.objects.create(
        student=student, balance=Decimal("100"), last_synced=timezone.now()
    )
    _, topup, payment = paid_topup("244.50", student=student, parent=parent, checkout="PRD")
    BanorteCheckout.objects.filter(payment=payment).update(verified_at=timezone.now())

    result = loyverse_push.push_topup(payment)

    assert result["state"] == "pushed", result
    live = services.get_customer_by_id(customer_id)
    assert Decimal(str(live["total_points"])) == Decimal("344.5")
    assert live["customer_code"] == code and live["note"].startswith("Prueba automática")
    topup.refresh_from_db()
    assert topup.applied_via == TopUpRequest.AppliedVia.AUTO_POS
    assert CafeteriaBalance.objects.get(student=student).balance == Decimal("344.50")


def test_the_real_api_is_not_written_when_loyverse_and_the_wallet_differ(settings, throwaway):
    customer_id, _ = throwaway
    settings.PAYMENTS_LIVE = True
    settings.CAFETERIA_TOPUP_LOYVERSE_PUSH = "verified"
    parent = ParentFactory()
    student = StudentProfileFactory(parents=[parent], loyverse_id=customer_id)
    CafeteriaBalance.objects.create(
        student=student, balance=Decimal("90"), last_synced=timezone.now()
    )
    _, _, payment = paid_topup("50.00", student=student, parent=parent, checkout="PRD")
    BanorteCheckout.objects.filter(payment=payment).update(verified_at=timezone.now())

    assert loyverse_push.push_topup(payment)["state"] == "waiting"
    live = services.get_customer_by_id(customer_id)
    assert Decimal(str(live["total_points"])) == Decimal("100")
