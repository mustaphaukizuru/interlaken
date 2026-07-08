"""
PaymentInitiateView must never leave an unreachable PENDING payment when the
gateway checkout call fails: the payment is marked FAILED (error captured) and an
explicit 502 is returned. Also covers the report-only orphan-finder command.
"""
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.urls import reverse

from apps.accounts.factories import ParentFactory
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

GW = 'apps.payments.gateways.global_payments.GlobalPaymentsGateway.create_checkout'


def _initiate(api_client):
    api_client.force_authenticate(user=ParentFactory())
    return api_client.post(
        reverse('payment-initiate'),
        {'amount': '150.00', 'payment_type': 'other', 'gateway': 'global_payments'},
        format='json',
    )


def test_gateway_exception_marks_failed_no_orphan(api_client):
    with patch(GW, side_effect=RuntimeError('gateway down')):
        resp = _initiate(api_client)

    assert resp.status_code == 502, resp.data
    assert resp.data['detail']                       # explicit, frontend-showable
    # No PENDING orphan left behind.
    assert not Payment.objects.filter(status=Payment.Status.PENDING).exists()
    payment = Payment.objects.get(pk=resp.data['payment_id'])
    assert payment.status == Payment.Status.FAILED
    assert 'gateway down' in payment.gateway_raw.get('error', '')
    assert payment.gateway_raw.get('stage') == 'create_checkout'


def test_gateway_empty_url_marks_failed(api_client):
    with patch(GW, return_value=''):
        resp = _initiate(api_client)

    assert resp.status_code == 502, resp.data
    assert not Payment.objects.filter(status=Payment.Status.PENDING).exists()
    assert Payment.objects.get(pk=resp.data['payment_id']).status == Payment.Status.FAILED


def test_happy_path_still_returns_redirect(api_client):
    resp = _initiate(api_client)
    assert resp.status_code == 201, resp.data
    assert resp.data['redirect_url']
    assert Payment.objects.get(pk=resp.data['payment_id']).status == Payment.Status.PENDING


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
