"""
payments/gateways/global_payments.py — Global Payments Hosted Payment Page (HPP).

Card data is entered on Global Payments' hosted page, never on our servers (PCI
scope minimisation). Until live credentials/SDK are provisioned, ``create_checkout``
builds a deterministic sandbox HPP URL carrying the order reference; the real
integration swaps this for an HPP-session call using ``GLOBAL_PAYMENTS_APP_ID`` /
``GLOBAL_PAYMENTS_APP_KEY`` (see DEPLOYMENT.md).
"""
from urllib.parse import urlencode

from django.conf import settings

from .base import BaseGateway

# Default sandbox hosted page; overridable via GLOBAL_PAYMENTS_HPP_URL.
_DEFAULT_HPP_URL = 'https://hpp.sandbox.globalpay.com/checkout'


class GlobalPaymentsGateway(BaseGateway):
    name = 'global_payments'
    webhook_secret_setting = 'GLOBAL_PAYMENTS_WEBHOOK_SECRET'
    SUCCESS_STATUSES = frozenset({'CAPTURED', 'SUCCESS', 'PAID', 'APPROVED'})
    FAILURE_STATUSES = frozenset({'DECLINED', 'FAILED', 'ERROR', 'CANCELLED'})

    def create_checkout(self, payment, return_url: str | None = None) -> str:
        base = getattr(settings, 'GLOBAL_PAYMENTS_HPP_URL', '') or _DEFAULT_HPP_URL
        params = {
            'order_id': payment.id,
            'amount': f'{payment.amount:.2f}',
            'currency': payment.currency,
            'app_id': getattr(settings, 'GLOBAL_PAYMENTS_APP_ID', ''),
            'env': getattr(settings, 'GLOBAL_PAYMENTS_ENV', 'sandbox'),
        }
        resolved = self._return_url(payment, return_url)
        if resolved:
            params['return_url'] = resolved
        return f'{base}?{urlencode(params)}'
