"""
payments/gateways/global_payments.py — Global Payments Hosted Payment Page (HPP).

Card data is entered on Global Payments' hosted page, never on our servers (PCI
scope minimisation).

Sandbox vs live
---------------
- ``PAYMENTS_LIVE=false`` (default): ``create_checkout`` **always** uses a sandbox
  URL — either the built-in sandbox HPP host, an explicit ``*sandbox*`` URL from
  ``GLOBAL_PAYMENTS_HPP_URL``, or the local ``/pago/simulado`` mock when unset.
  Live merchant HPP URLs are ignored so a mis-set env cannot charge real cards.
- ``PAYMENTS_LIVE=true``: uses ``GLOBAL_PAYMENTS_HPP_URL`` (or the local mock if
  still unset). Wire a real HPP-session call with ``GLOBAL_PAYMENTS_APP_ID`` /
  ``GLOBAL_PAYMENTS_APP_KEY`` before flipping the flag (see DEPLOYMENT.md).
"""
from urllib.parse import urlencode

from django.conf import settings

from .base import BaseGateway

# Default sandbox hosted page; used when PAYMENTS_LIVE is false and a live URL
# was accidentally configured (or as the sandbox fallback).
_DEFAULT_HPP_URL = 'https://hpp.sandbox.globalpay.com/checkout'


def _checkout_base() -> str:
    """Resolve the HPP base URL, honouring PAYMENTS_LIVE sandbox forcing."""
    configured = (getattr(settings, 'GLOBAL_PAYMENTS_HPP_URL', '') or '').strip()
    live = bool(getattr(settings, 'PAYMENTS_LIVE', False))
    local_mock = f'{settings.FRONTEND_URL}/pago/simulado'
    if live:
        return configured or local_mock
    # Sandbox mode: never hit a live merchant URL.
    if not configured:
        return local_mock
    if 'sandbox' in configured.lower() or 'simulado' in configured.lower():
        return configured
    return _DEFAULT_HPP_URL


class GlobalPaymentsGateway(BaseGateway):
    name = 'global_payments'
    webhook_secret_setting = 'GLOBAL_PAYMENTS_WEBHOOK_SECRET'
    SUCCESS_STATUSES = frozenset({'CAPTURED', 'SUCCESS', 'PAID', 'APPROVED'})
    FAILURE_STATUSES = frozenset({'DECLINED', 'FAILED', 'ERROR', 'CANCELLED'})

    def create_checkout(self, payment, return_url: str | None = None) -> str:
        base = _checkout_base()
        env = (
            getattr(settings, 'GLOBAL_PAYMENTS_ENV', 'sandbox')
            if getattr(settings, 'PAYMENTS_LIVE', False)
            else 'sandbox'
        )
        params = {
            'order_id': payment.id,
            'amount': f'{payment.amount:.2f}',
            'currency': payment.currency,
            'gateway': self.name,
            'app_id': getattr(settings, 'GLOBAL_PAYMENTS_APP_ID', ''),
            'env': env,
        }
        resolved = self._return_url(payment, return_url)
        if resolved:
            params['return_url'] = resolved
        return f'{base}?{urlencode(params)}'
