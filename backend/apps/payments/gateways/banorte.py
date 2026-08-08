"""
payments/gateways/banorte.py — Banorte "Pago en Línea" hosted checkout.

Same contract as Global Payments: the parent is redirected to Banorte's hosted
page (no card data on our servers), and Banorte notifies us server-to-server.

Checkout modes
--------------
1. **Local mock** (``PAYMENTS_LIVE=false``, no checkout URL): ``/pago/simulado``.
2. **Query-string sandbox** (sandbox URL configured, no session API).
3. **Session API** (``BANORTE_SESSION_URL`` + ``BANORTE_MERCHANT_ID`` + optional
   ``BANORTE_API_KEY``): POST structured order payload; use provider redirect.

Sandbox vs live
---------------
- ``PAYMENTS_LIVE=false``: never redirects to a live merchant host.
- ``PAYMENTS_LIVE=true``: requires real ``BANORTE_CHECKOUT_URL`` (or session API
  success) **and** ``BANORTE_MERCHANT_ID``. Missing config fails closed.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from urllib.parse import urlencode

import requests
from django.conf import settings

from .base import BaseGateway, CheckoutSession, LiveCheckoutNotConfigured

logger = logging.getLogger(__name__)

# Default sandbox checkout endpoint; used when PAYMENTS_LIVE is false and a live
# URL was accidentally configured (or as the sandbox fallback).
_DEFAULT_CHECKOUT_URL = 'https://gateway.sandbox.banorte.com/pagos/checkout'


def _checkout_base() -> str:
    """Resolve the Banorte checkout base URL, honouring PAYMENTS_LIVE."""
    configured = (getattr(settings, 'BANORTE_CHECKOUT_URL', '') or '').strip()
    live = bool(getattr(settings, 'PAYMENTS_LIVE', False))
    local_mock = f'{settings.FRONTEND_URL.rstrip("/")}/pago/simulado'
    if live:
        if not configured or 'simulado' in configured.lower():
            raise LiveCheckoutNotConfigured(
                'PAYMENTS_LIVE=true requiere BANORTE_CHECKOUT_URL '
                '(checkout real del comercio). No se usará /pago/simulado.')
        return configured
    # Sandbox mode: never hit a live merchant URL.
    if not configured:
        return local_mock
    if 'sandbox' in configured.lower() or 'simulado' in configured.lower():
        return configured
    return _DEFAULT_CHECKOUT_URL


def _merchant_ready() -> bool:
    return bool((getattr(settings, 'BANORTE_MERCHANT_ID', '') or '').strip())


class BanorteGateway(BaseGateway):
    name = 'banorte'
    webhook_secret_setting = 'BANORTE_WEBHOOK_SECRET'
    # Banorte/Pago en Línea vocabulary (incl. the ISO-8583 "00" approval code).
    SUCCESS_STATUSES = frozenset({'APPROVED', 'SUCCESS', 'PAID', 'CAPTURED', '00'})
    FAILURE_STATUSES = frozenset({'DECLINED', 'FAILED', 'REJECTED', 'CANCELLED', 'ERROR'})
    REFUND_STATUSES = frozenset({'REFUNDED', 'REFUND', 'RETURNED', 'CHARGEBACK', '12'})

    def build_session_payload(self, payment, return_url: str | None = None) -> dict:
        """Banorte-shaped checkout session / order request body."""
        env = (
            getattr(settings, 'BANORTE_ENV', 'sandbox')
            if getattr(settings, 'PAYMENTS_LIVE', False)
            else 'sandbox'
        )
        resolved = self._return_url(payment, return_url)
        merchant_id = getattr(settings, 'BANORTE_MERCHANT_ID', '') or ''
        backend = (getattr(settings, 'BACKEND_URL', '') or '').rstrip('/')
        status_url = (
            f'{backend}/api/v1/payments/webhook/banorte/' if backend else ''
        )
        return {
            'merchant_id': merchant_id,
            'order_id': str(payment.id),
            'reference': str(payment.id),
            'amount': f'{payment.amount:.2f}',
            'currency': payment.currency,
            'env': env,
            'return_url': resolved,
            'status_url': status_url,
            'gateway': self.name,
        }

    def session_headers(self) -> dict:
        merchant_id = (getattr(settings, 'BANORTE_MERCHANT_ID', '') or '').strip()
        api_key = (getattr(settings, 'BANORTE_API_KEY', '') or '').strip()
        sig = ''
        if merchant_id and api_key:
            sig = hmac.new(
                api_key.encode(),
                merchant_id.encode(),
                hashlib.sha256,
            ).hexdigest()
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Banorte-Merchant-Id': merchant_id,
            'Authorization': f'Bearer {api_key}' if api_key else '',
            'X-Banorte-Signature': sig,
        }

    def create_checkout(self, payment, return_url: str | None = None) -> str:
        live = bool(getattr(settings, 'PAYMENTS_LIVE', False))
        if live and not _merchant_ready():
            raise LiveCheckoutNotConfigured(
                'PAYMENTS_LIVE=true requiere BANORTE_MERCHANT_ID.')

        session_url = (getattr(settings, 'BANORTE_SESSION_URL', '') or '').strip()
        if session_url and _merchant_ready():
            session = self._create_checkout_session(payment, return_url, session_url)
            self._persist_session(payment, session)
            return session.redirect_url

        base = _checkout_base()
        env = (
            getattr(settings, 'BANORTE_ENV', 'sandbox')
            if live
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
        api_key = (getattr(settings, 'BANORTE_API_KEY', '') or '').strip()
        if api_key:
            material = f"{payment.id}|{params['amount']}|{payment.currency}".encode()
            params['signature'] = hmac.new(api_key.encode(), material, hashlib.sha256).hexdigest()
        return f'{base}?{urlencode(params)}'

    def _create_checkout_session(
        self,
        payment,
        return_url: str | None,
        session_url: str,
    ) -> CheckoutSession:
        payload = self.build_session_payload(payment, return_url)
        headers = {k: v for k, v in self.session_headers().items() if v}
        try:
            resp = requests.post(session_url, json=payload, headers=headers, timeout=20)
        except requests.RequestException as exc:
            logger.exception('banorte session create failed: %s', exc)
            raise LiveCheckoutNotConfigured(
                f'No se pudo crear la sesión Banorte: {exc}'
            ) from exc

        if resp.status_code >= 400:
            logger.warning(
                'banorte session create HTTP %s: %s',
                resp.status_code,
                resp.text[:300],
            )
            raise LiveCheckoutNotConfigured(
                f'Banorte session API respondió {resp.status_code}.'
            )

        try:
            body = resp.json()
        except ValueError as exc:
            raise LiveCheckoutNotConfigured(
                'Banorte session API devolvió JSON inválido.'
            ) from exc

        redirect = (
            body.get('redirect_url')
            or body.get('checkout_url')
            or body.get('url')
            or ''
        )
        if not redirect:
            raise LiveCheckoutNotConfigured(
                'Banorte session API no devolvió redirect_url/checkout_url.'
            )
        session_id = str(
            body.get('id') or body.get('session_id') or body.get('reference') or ''
        )
        return CheckoutSession(redirect_url=redirect, session_id=session_id, raw=body)
