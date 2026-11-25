"""
Family cafetería controls: per-child spending-trend scoping (#11) and the
parent-settable low-balance threshold (#12).
"""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

pytestmark = pytest.mark.django_db


class TestLowBalanceThreshold:
    def test_parent_updates_own_child_threshold(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(parent)
        resp = api_client.patch(
            reverse('cafeteria-threshold', args=[student.id]),
            {'threshold': '75.00'}, format='json')
        assert resp.status_code == 200, resp.content
        assert CafeteriaBalance.objects.get(student=student).low_balance_threshold == Decimal('75.00')

    def test_parent_cannot_touch_another_childs_threshold(self, api_client):
        other = StudentProfileFactory()            # not this parent's child
        api_client.force_authenticate(ParentFactory())
        assert api_client.patch(
            reverse('cafeteria-threshold', args=[other.id]),
            {'threshold': '10'}, format='json').status_code == 403

    def test_negative_threshold_rejected(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(parent)
        assert api_client.patch(
            reverse('cafeteria-threshold', args=[student.id]),
            {'threshold': '-5'}, format='json').status_code == 400


    def test_threshold_is_capped_at_the_top_up_maximum(self, api_client, settings):
        # QA 2026-11-24: $99,999 was accepted. The cap is the largest single
        # top-up (CAFETERIA_TOPUP_MAX, $1,000).
        settings.CAFETERIA_TOPUP_MAX = '1000'
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(parent)
        url = reverse('cafeteria-threshold', args=[student.id])
        resp = api_client.patch(url, {'threshold': '99999'}, format='json')
        assert resp.status_code == 400
        assert resp.data['threshold'] == ['El monto máximo de la alerta es $1,000.']
        assert api_client.patch(url, {'threshold': '1000.00'}, format='json').status_code == 200
        assert CafeteriaBalance.objects.get(student=student).low_balance_threshold == Decimal('1000.00')

    def test_a_stored_higher_threshold_survives_a_budget_edit(self, api_client):
        # The cap only applies when the alert itself is changed.
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        CafeteriaBalance.objects.create(student=student, low_balance_threshold=Decimal('5000'))
        api_client.force_authenticate(parent)
        resp = api_client.patch(reverse('cafeteria-budget', args=[student.id]),
                                {'daily_spend_limit': '50', 'weekly_spend_limit': '200'}, format='json')
        assert resp.status_code == 200, resp.data
        assert CafeteriaBalance.objects.get(student=student).low_balance_threshold == Decimal('5000.00')


class TestPerChildTrend:
    def test_trend_scopes_to_one_child(self, api_client):
        parent = ParentFactory()
        a = StudentProfileFactory(parents=[parent])
        b = StudentProfileFactory(parents=[parent])
        CafeteriaTransaction.objects.create(
            student=a, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal('30'), loyverse_receipt_id='r-a')
        CafeteriaTransaction.objects.create(
            student=b, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal('20'), loyverse_receipt_id='r-b')
        api_client.force_authenticate(parent)
        url = reverse('cafeteria-spending-trend')

        assert api_client.get(url).json()['total'] == 50.0            # both kids
        assert api_client.get(url, {'student': a.id}).json()['total'] == 30.0  # one kid
