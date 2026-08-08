"""HPP session payload / headers / optional session API for Global Payments & Banorte."""
from unittest.mock import MagicMock, patch

import pytest

from apps.payments.gateways.banorte import BanorteGateway
from apps.payments.gateways.base import LiveCheckoutNotConfigured
from apps.payments.gateways.global_payments import GlobalPaymentsGateway

pytestmark = pytest.mark.django_db


def _payment(pk=42, amount=150):
    p = MagicMock()
    p.id = pk
    p.pk = pk
    p.amount = amount
    p.currency = 'MXN'
    p.gateway_ref = ''
    p.gateway_raw = {}
    return p


class TestGlobalPaymentsSessionShape:
    def test_payload_has_order_amount_and_return(self, settings):
        settings.GLOBAL_PAYMENTS_APP_ID = 'app-test'
        settings.GLOBAL_PAYMENTS_APP_KEY = 'key-test'
        settings.PAYMENT_RETURN_URL = 'http://localhost:3000/retorno'
        settings.BACKEND_URL = 'http://localhost:8000'
        settings.PAYMENTS_LIVE = False

        payload = GlobalPaymentsGateway().build_session_payload(_payment())
        assert payload['reference'] == '42'
        assert payload['order']['reference'] == '42'
        assert payload['amount'] == '15000'  # minor units
        assert payload['currency'] == 'MXN'
        assert payload['channel'] == 'HPP'
        assert 'payment_id=42' in payload['notifications']['return_url']
        assert payload['notifications']['status_url'].endswith(
            '/api/v1/payments/webhook/global-payments/'
        )

    def test_session_headers_include_auth_and_version(self, settings):
        settings.GLOBAL_PAYMENTS_APP_ID = 'app-test'
        settings.GLOBAL_PAYMENTS_APP_KEY = 'key-test'
        settings.GLOBAL_PAYMENTS_API_VERSION = '2021-03-22'

        headers = GlobalPaymentsGateway().session_headers()
        assert headers['X-GP-Version'] == '2021-03-22'
        assert headers['X-GP-App-Id'] == 'app-test'
        assert headers['Authorization'] == 'app-test:key-test'
        assert headers['X-GP-Signature']

    def test_live_requires_app_credentials(self, settings):
        settings.PAYMENTS_LIVE = True
        settings.GLOBAL_PAYMENTS_HPP_URL = 'https://hpp.globalpay.com/live'
        settings.GLOBAL_PAYMENTS_APP_ID = ''
        settings.GLOBAL_PAYMENTS_APP_KEY = ''
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        with pytest.raises(LiveCheckoutNotConfigured):
            GlobalPaymentsGateway().create_checkout(_payment())

    def test_session_api_uses_provider_redirect(self, settings):
        settings.PAYMENTS_LIVE = False
        settings.GLOBAL_PAYMENTS_APP_ID = 'app-test'
        settings.GLOBAL_PAYMENTS_APP_KEY = 'key-test'
        settings.GLOBAL_PAYMENTS_SESSION_URL = 'https://apis.sandbox.globalpay.com/ucp/hpp'
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = 'http://localhost:3000/retorno'
        settings.BACKEND_URL = 'http://localhost:8000'

        payment = _payment()
        fake = MagicMock()
        fake.status_code = 200
        fake.json.return_value = {
            'id': 'sess-abc',
            'redirect_url': 'https://hpp.sandbox.globalpay.com/pay/sess-abc',
        }

        with patch('apps.payments.gateways.global_payments.requests.post', return_value=fake) as post:
            url = GlobalPaymentsGateway().create_checkout(payment)

        assert url == 'https://hpp.sandbox.globalpay.com/pay/sess-abc'
        assert post.called
        kwargs = post.call_args.kwargs
        assert kwargs['json']['reference'] == '42'
        assert kwargs['headers']['X-GP-App-Id'] == 'app-test'
        payment.save.assert_called()
        assert payment.gateway_ref == 'sess-abc'

    def test_session_api_fail_closed_on_http_error(self, settings):
        settings.GLOBAL_PAYMENTS_APP_ID = 'app-test'
        settings.GLOBAL_PAYMENTS_APP_KEY = 'key-test'
        settings.GLOBAL_PAYMENTS_SESSION_URL = 'https://apis.sandbox.globalpay.com/ucp/hpp'
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        fake = MagicMock()
        fake.status_code = 401
        fake.text = 'unauthorized'

        with patch('apps.payments.gateways.global_payments.requests.post', return_value=fake):
            with pytest.raises(LiveCheckoutNotConfigured):
                GlobalPaymentsGateway().create_checkout(_payment())

    def test_sandbox_without_session_url_keeps_mock(self, settings):
        settings.PAYMENTS_LIVE = False
        settings.GLOBAL_PAYMENTS_HPP_URL = ''
        settings.GLOBAL_PAYMENTS_SESSION_URL = ''
        settings.GLOBAL_PAYMENTS_APP_ID = ''
        settings.GLOBAL_PAYMENTS_APP_KEY = ''
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        url = GlobalPaymentsGateway().create_checkout(_payment())
        assert url.startswith('http://localhost:3000/pago/simulado')


class TestBanorteSessionShape:
    def test_payload_and_headers(self, settings):
        settings.BANORTE_MERCHANT_ID = 'merch-1'
        settings.BANORTE_API_KEY = 'secret'
        settings.PAYMENT_RETURN_URL = 'http://localhost:3000/retorno'
        settings.BACKEND_URL = 'http://localhost:8000'
        settings.PAYMENTS_LIVE = False

        gw = BanorteGateway()
        payload = gw.build_session_payload(_payment())
        assert payload['merchant_id'] == 'merch-1'
        assert payload['order_id'] == '42'
        assert payload['amount'] == '150.00'
        headers = gw.session_headers()
        assert headers['X-Banorte-Merchant-Id'] == 'merch-1'
        assert headers['Authorization'] == 'Bearer secret'

    def test_live_requires_merchant_id(self, settings):
        settings.PAYMENTS_LIVE = True
        settings.BANORTE_CHECKOUT_URL = 'https://gateway.banorte.com/pagos/live'
        settings.BANORTE_MERCHANT_ID = ''
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''

        with pytest.raises(LiveCheckoutNotConfigured):
            BanorteGateway().create_checkout(_payment())

    def test_session_api_redirect(self, settings):
        settings.PAYMENTS_LIVE = False
        settings.BANORTE_MERCHANT_ID = 'merch-1'
        settings.BANORTE_API_KEY = 'secret'
        settings.BANORTE_SESSION_URL = 'https://gateway.sandbox.banorte.com/api/session'
        settings.FRONTEND_URL = 'http://localhost:3000'
        settings.PAYMENT_RETURN_URL = ''
        settings.BACKEND_URL = ''

        fake = MagicMock()
        fake.status_code = 200
        fake.json.return_value = {
            'session_id': 'b-99',
            'checkout_url': 'https://gateway.sandbox.banorte.com/pay/b-99',
        }

        with patch('apps.payments.gateways.banorte.requests.post', return_value=fake):
            url = BanorteGateway().create_checkout(_payment())

        assert url.endswith('/pay/b-99')
