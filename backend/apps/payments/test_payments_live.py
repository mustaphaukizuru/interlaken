"""PAYMENTS_LIVE=false must force sandbox checkout URLs (never live merchant hosts)."""
from unittest.mock import MagicMock

import pytest

from apps.payments.gateways.banorte import _DEFAULT_CHECKOUT_URL, BanorteGateway
from apps.payments.gateways.global_payments import _DEFAULT_HPP_URL, GlobalPaymentsGateway

pytestmark = pytest.mark.django_db


def _payment(pk=42):
    p = MagicMock()
    p.id = pk
    p.amount = 150
    p.currency = 'MXN'
    return p


class TestPaymentsLiveSandboxForce:
    def test_global_payments_ignores_live_hpp_when_not_live(self, settings):
        settings.PAYMENTS_LIVE = False
        settings.GLOBAL_PAYMENTS_HPP_URL = 'https://hpp.globalpay.com/live-checkout'
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        url = GlobalPaymentsGateway().create_checkout(_payment())
        assert url.startswith(_DEFAULT_HPP_URL)
        assert 'env=sandbox' in url
        assert 'live-checkout' not in url

    def test_banorte_ignores_live_checkout_when_not_live(self, settings):
        settings.PAYMENTS_LIVE = False
        settings.BANORTE_CHECKOUT_URL = 'https://gateway.banorte.com/pagos/live'
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        url = BanorteGateway().create_checkout(_payment())
        assert url.startswith(_DEFAULT_CHECKOUT_URL)
        assert 'env=sandbox' in url
        assert '/live' not in url

    def test_empty_hpp_keeps_local_mock_in_sandbox(self, settings):
        settings.PAYMENTS_LIVE = False
        settings.GLOBAL_PAYMENTS_HPP_URL = ''
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        url = GlobalPaymentsGateway().create_checkout(_payment())
        assert url.startswith('http://localhost:3000/pago/simulado')

    def test_live_flag_uses_configured_hpp(self, settings):
        settings.PAYMENTS_LIVE = True
        settings.GLOBAL_PAYMENTS_HPP_URL = 'https://hpp.globalpay.com/live-checkout'
        settings.GLOBAL_PAYMENTS_ENV = 'production'
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        url = GlobalPaymentsGateway().create_checkout(_payment())
        assert url.startswith('https://hpp.globalpay.com/live-checkout')
        assert 'env=production' in url

    def test_live_without_hpp_url_fails_closed(self, settings):
        from apps.payments.gateways.base import LiveCheckoutNotConfigured

        settings.PAYMENTS_LIVE = True
        settings.GLOBAL_PAYMENTS_HPP_URL = ''
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        with pytest.raises(LiveCheckoutNotConfigured):
            GlobalPaymentsGateway().create_checkout(_payment())

    def test_live_banorte_without_checkout_url_fails_closed(self, settings):
        from apps.payments.gateways.base import LiveCheckoutNotConfigured

        settings.PAYMENTS_LIVE = True
        settings.BANORTE_CHECKOUT_URL = ''
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        with pytest.raises(LiveCheckoutNotConfigured):
            BanorteGateway().create_checkout(_payment())

    def test_live_rejects_simulado_url(self, settings):
        from apps.payments.gateways.base import LiveCheckoutNotConfigured

        settings.PAYMENTS_LIVE = True
        settings.GLOBAL_PAYMENTS_HPP_URL = 'http://localhost:3000/pago/simulado'
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        with pytest.raises(LiveCheckoutNotConfigured):
            GlobalPaymentsGateway().create_checkout(_payment())
