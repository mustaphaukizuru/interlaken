"""
payments/gateways/banorte.py — Banorte "Pago en Línea" hosted checkout.

Same contract as Global Payments: the parent is redirected to Banorte's hosted
page (no card data on our servers), and Banorte notifies us server-to-server.

Sandbox vs live
---------------
- ``PAYMENTS_LIVE=false`` (default): ``create_checkout`` **always** uses a sandbox
  URL — either the built-in Banorte sandbox host, an explicit ``*sandbox*`` URL
  from ``BANORTE_CHECKOUT_URL``, or the local ``/pago/simulado`` mock when unset.
  Live merchant URLs are ignored so a mis-set env cannot charge real cards.
- ``PAYMENTS_LIVE=true``: uses ``BANORTE_CHECKOUT_URL`` (or the local mock if
  still unset). Provision real Banorte merchant credentials before flipping the
  flag (see DEPLOYMENT.md). Webhook verification (HMAC on the raw body) is real
  in both modes.
"""
from urllib.parse import urlencode

from django.conf import settings

from .base import BaseGateway

# Default sandbox checkout endpoint; used when PAYMENTS_LIVE is false and a live
# URL was accidentally configured (or as the sandbox fallback).
_DEFAULT_CHECKOUT_URL = 'https://gateway.sandbox.banorte.com/pagos/checkout'


def _checkout_base() -> str:
    """Resolve the Banorte checkout base URL, honouring PAYMENTS_LIVE."""
    configured = (getattr(settings, 'BANORTE_CHECKOUT_URL', '') or '').strip()
    live = bool(getattr(settings, 'PAYMENTS_LIVE', False))
    local_mock = f'{settings.FRONTEND_URL}/pago/simulado'
    if live:
        return configured or local_mock
    # Sandbox mode: never hit a live merchant URL.
    if not configured:
        return local_mock
    if 'sandbox' in configured.lower() or 'simulado' in configured.lower():
        return configured
    return _DEFAULT_CHECKOUT_URL


class BanorteGateway(BaseGateway):
    name = 'banorte'
    webhook_secret_setting = 'BANORTE_WEBHOOK_SECRET'
    # Banorte/Pago en Línea vocabulary (incl. the ISO-8583 "00" approval code).
    SUCCESS_STATUSES = frozenset({'APPROVED', 'SUCCESS', 'PAID', 'CAPTURED', '00'})
    FAILURE_STATUSES = frozenset({'DECLINED', 'FAILED', 'REJECTED', 'CANCELLED', 'ERROR'})

    def create_checkout(self, payment, return_url: str | None = None) -> str:
        base = _checkout_base()
        env = (
            getattr(settings, 'BANORTE_ENV', 'sandbox')
            if getattr(settings, 'PAYMENTS_LIVE', False)
            else 'sandbox'
        )
        params = {
            'merchant_id': getattr(settings, 'BANORTE_MERCHANT_ID', ''),
            'order_id': payment.id,
            'reference': payment.id,
            'amount': f'{payment.amount:.2f}',
            'currency': payment.currency,
            'gateway': self.name,
            'env': env,
        }
        resolved = self._return_url(payment, return_url)
        if resolved:
            params['return_url'] = resolved
        return f'{base}?{urlencode(params)}'
