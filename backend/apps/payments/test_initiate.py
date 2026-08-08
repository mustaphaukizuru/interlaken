"""
PaymentInitiateView is fail-closed for unlinked money types.

Checkout orphan hardening for live paths lives on cafeteria top-up and
invoice-pay; bare initiate must not create chargeable orphan rows.
"""
from io import StringIO

import pytest
from django.core.management import call_command
from django.urls import reverse

from apps.accounts.factories import ParentFactory
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("payment_type", ["tuition", "cafeteria", "enrollment", "other"])
def test_initiate_rejects_all_unlinked_types(api_client, payment_type):
    api_client.force_authenticate(user=ParentFactory())
    resp = api_client.post(
        reverse('payment-initiate'),
        {'amount': '150.00', 'payment_type': payment_type, 'gateway': 'global_payments'},
        format='json',
    )
    assert resp.status_code == 400, resp.data
    assert 'payment_type' in resp.data
    assert not Payment.objects.exists()


def test_find_orphan_payments_reports_and_does_not_mutate(api_client):
    # An old-style orphan: PENDING with no gateway tx id.
    orphan = Payment.objects.create(
        user=ParentFactory(), payment_type=Payment.Type.OTHER, amount='99.00',
        gateway=Payment.Gateway.GLOBAL_PAYMENTS, status=Payment.Status.PENDING,
    )
    out = StringIO()
    call_command('find_orphan_payments', stdout=out)
    output = out.getvalue()

    assert f'id={orphan.id}' in output
    assert 'REPORT ONLY' in output
    orphan.refresh_from_db()
    assert orphan.status == Payment.Status.PENDING  # untouched
