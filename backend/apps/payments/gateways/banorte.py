"""
payments/gateways/banorte.py — Banorte "Pago en Línea" hosted checkout.

Same contract as Global Payments: the parent is redirected to Banorte's hosted
page (no card data on our servers), and Banorte notifies us server-to-server. The
sandbox URL below is a placeholder until Banorte merchant credentials are wired
(see DEPLOYMENT.md); the webhook verification is real (HMAC on the raw body).
"""
from urllib.parse import urlencode

from django.conf import settings

from .base import BaseGateway

# Default sandbox checkout endpoint; overridable via BANORTE_CHECKOUT_URL.
_DEFAULT_CHECKOUT_URL = 'https://gateway.sandbox.banorte.com/pagos/checkout'


class BanorteGateway(BaseGateway):
    name = 'banorte'
    webhook_secret_setting = 'BANORTE_WEBHOOK_SECRET'
    # Banorte/Pago en Línea vocabulary (incl. the ISO-8583 "00" approval code).
    SUCCESS_STATUSES = frozenset({'APPROVED', 'SUCCESS', 'PAID', 'CAPTURED', '00'})
    FAILURE_STATUSES = frozenset({'DECLINED', 'FAILED', 'REJECTED', 'CANCELLED', 'ERROR'})

    def create_checkout(self, payment, return_url: str | None = None) -> str:
        # No live checkout URL configured → sandbox: use the local mock page.
        base = (getattr(settings, 'BANORTE_CHECKOUT_URL', '')
                or f'{settings.FRONTEND_URL}/pago/simulado')
        params = {
            'merchant_id': getattr(settings, 'BANORTE_MERCHANT_ID', ''),
            'order_id': payment.id,
            'reference': payment.id,
            'amount': f'{payment.amount:.2f}',
            'currency': payment.currency,
            'gateway': self.name,
            'env': getattr(settings, 'BANORTE_ENV', 'sandbox'),
        }
        resolved = self._return_url(payment, return_url)
        if resolved:
            params['return_url'] = resolved
        return f'{base}?{urlencode(params)}'
