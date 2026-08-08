"""
payments/gateways/global_payments.py — Global Payments Hosted Payment Page (HPP).

Card data is entered on Global Payments' hosted page, never on our servers (PCI
scope minimisation).

Checkout modes
--------------
1. **Local mock** (``PAYMENTS_LIVE=false``, no HPP URL): redirect to
   ``/pago/simulado`` so parents can exercise initiate → settle → return without
   merchant credentials.
2. **Query-string sandbox HPP** (sandbox URL configured, no session API): assemble
   a deterministic redirect carrying order fields (legacy / docs placeholder).
3. **Session API** (``GLOBAL_PAYMENTS_SESSION_URL`` + ``APP_ID`` + ``APP_KEY``):
   POST the GP-API-shaped order payload with auth headers; use the provider's
   ``redirect_url`` / ``hpp_url``. This is the path live merchants will use —
   swap only the HTTP response mapping when real API docs arrive.

Sandbox vs live
---------------
- ``PAYMENTS_LIVE=false`` (default): never redirects to a live merchant host.
- ``PAYMENTS_LIVE=true``: requires real ``GLOBAL_PAYMENTS_HPP_URL`` (or a successful
  session API response) **and** ``APP_ID`` + ``APP_KEY``. Missing config raises
  ``LiveCheckoutNotConfigured`` so initiate returns 502 — never a dead mock.
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

# Default sandbox hosted page; used when PAYMENTS_LIVE is false and a live URL
# was accidentally configured (or as the sandbox fallback).
_DEFAULT_HPP_URL = 'https://hpp.sandbox.globalpay.com/checkout'

# Documented GP-API version header; override via GLOBAL_PAYMENTS_API_VERSION.
_DEFAULT_API_VERSION = '2021-03-22'


def _checkout_base() -> str:
    """Resolve the HPP base URL, honouring PAYMENTS_LIVE sandbox forcing."""
    configured = (getattr(settings, 'GLOBAL_PAYMENTS_HPP_URL', '') or '').strip()
    live = bool(getattr(settings, 'PAYMENTS_LIVE', False))
    local_mock = f'{settings.FRONTEND_URL.rstrip("/")}/pago/simulado'
    if live:
        if not configured or 'simulado' in configured.lower():
            raise LiveCheckoutNotConfigured(
                'PAYMENTS_LIVE=true requiere GLOBAL_PAYMENTS_HPP_URL '
                '(HPP real del comercio). No se usará /pago/simulado.')
        return configured
    # Sandbox mode: never hit a live merchant URL.
    if not configured:
        return local_mock
    if 'sandbox' in configured.lower() or 'simulado' in configured.lower():
        return configured
    return _DEFAULT_HPP_URL


def _credentials_ready() -> bool:
    app_id = (getattr(settings, 'GLOBAL_PAYMENTS_APP_ID', '') or '').strip()
    app_key = (getattr(settings, 'GLOBAL_PAYMENTS_APP_KEY', '') or '').strip()
    return bool(app_id and app_key)


class GlobalPaymentsGateway(BaseGateway):
    name = 'global_payments'
    webhook_secret_setting = 'GLOBAL_PAYMENTS_WEBHOOK_SECRET'
    SUCCESS_STATUSES = frozenset({'CAPTURED', 'SUCCESS', 'PAID', 'APPROVED'})
    FAILURE_STATUSES = frozenset({'DECLINED', 'FAILED', 'ERROR', 'CANCELLED'})

    def build_session_payload(self, payment, return_url: str | None = None) -> dict:
        """GP-API-shaped HPP session / transaction request body.

        Field names follow common Global Payments HPP / Transactions conventions
        (``order``, ``amount``, ``currency``, ``captureMode``, return URLs). When
        merchant docs differ, adjust mapping here only — views stay unchanged.
        """
        env = (
            getattr(settings, 'GLOBAL_PAYMENTS_ENV', 'sandbox')
            if getattr(settings, 'PAYMENTS_LIVE', False)
            else 'sandbox'
        )
        resolved = self._return_url(payment, return_url)
        # Amount in minor units (centavos) is the usual GP-API convention.
        amount_minor = int(round(float(payment.amount) * 100))
        payload = {
            'account_name': getattr(settings, 'GLOBAL_PAYMENTS_APP_ID', '') or '',
            'channel': 'HPP',
            'capture_mode': 'AUTO',
            'type': 'SALE',
            'amount': str(amount_minor),
            'currency': payment.currency,
            'reference': str(payment.id),
            'order': {
                'reference': str(payment.id),
                'amount': str(amount_minor),
                'currency': payment.currency,
            },
            'payment': {
                'amount': f'{payment.amount:.2f}',
                'currency': payment.currency,
            },
            'notifications': {
                'return_url': resolved,
                'status_url': getattr(settings, 'BACKEND_URL', '') and (
                    f"{settings.BACKEND_URL.rstrip('/')}/api/v1/payments/webhook/global-payments/"
                ),
            },
            'merchant': {
                'app_id': getattr(settings, 'GLOBAL_PAYMENTS_APP_ID', '') or '',
                'env': env,
            },
            'gateway': self.name,
        }
        return payload

    def session_headers(self) -> dict:
        """Auth + version headers for a GP-API session create call.

        Uses ``Authorization: <app_id>:<app_key>`` as a placeholder shape; many
        GP integrations use Basic or a hashed nonce instead. Replace the value
        construction when merchant docs arrive — keep the key names stable.
        """
        app_id = (getattr(settings, 'GLOBAL_PAYMENTS_APP_ID', '') or '').strip()
        app_key = (getattr(settings, 'GLOBAL_PAYMENTS_APP_KEY', '') or '').strip()
        version = (
            getattr(settings, 'GLOBAL_PAYMENTS_API_VERSION', '') or _DEFAULT_API_VERSION
        ).strip()
        # Deterministic request signature over app_id|app_key for adapters that
        # expect an HMAC secret material without inventing live credentials.
        sig = ''
        if app_id and app_key:
            sig = hmac.new(
                app_key.encode(),
                app_id.encode(),
                hashlib.sha256,
            ).hexdigest()
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-GP-Version': version,
            'X-GP-App-Id': app_id,
            'Authorization': f'{app_id}:{app_key}' if app_id and app_key else '',
            'X-GP-Signature': sig,
        }

    def create_checkout(self, payment, return_url: str | None = None) -> str:
        live = bool(getattr(settings, 'PAYMENTS_LIVE', False))
        if live and not _credentials_ready():
            raise LiveCheckoutNotConfigured(
                'PAYMENTS_LIVE=true requiere GLOBAL_PAYMENTS_APP_ID y '
                'GLOBAL_PAYMENTS_APP_KEY.')

        session_url = (getattr(settings, 'GLOBAL_PAYMENTS_SESSION_URL', '') or '').strip()
        if session_url and _credentials_ready():
            session = self._create_hpp_session(payment, return_url, session_url)
            self._persist_session(payment, session)
            return session.redirect_url

        # Sandbox / mock path: assemble redirect (local mock or sandbox HPP host).
        base = _checkout_base()
        env = (
            getattr(settings, 'GLOBAL_PAYMENTS_ENV', 'sandbox')
            if live
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
        # When APP_KEY is present, attach a request signature so the mock/sandbox
        # path carries the same structural fields as a live session.
        app_key = (getattr(settings, 'GLOBAL_PAYMENTS_APP_KEY', '') or '').strip()
        if app_key:
            material = f"{payment.id}|{params['amount']}|{payment.currency}".encode()
            params['signature'] = hmac.new(app_key.encode(), material, hashlib.sha256).hexdigest()
        return f'{base}?{urlencode(params)}'

    def _create_hpp_session(
        self,
        payment,
        return_url: str | None,
        session_url: str,
    ) -> CheckoutSession:
        """POST the session payload; map provider JSON to a CheckoutSession.

        Expected response keys (flexible): ``redirect_url`` / ``hpp_url`` /
        ``url``, and optional ``id`` / ``session_id``. Adjust parsing when real
        merchant docs land — fail closed on missing redirect.
        """
        payload = self.build_session_payload(payment, return_url)
        headers = {k: v for k, v in self.session_headers().items() if v}
        try:
            resp = requests.post(session_url, json=payload, headers=headers, timeout=20)
        except requests.RequestException as exc:
            logger.exception('global_payments session create failed: %s', exc)
            raise LiveCheckoutNotConfigured(
                f'No se pudo crear la sesión HPP de Global Payments: {exc}'
            ) from exc

        if resp.status_code >= 400:
            logger.warning(
                'global_payments session create HTTP %s: %s',
                resp.status_code,
                resp.text[:300],
            )
            raise LiveCheckoutNotConfigured(
                f'Global Payments session API respondió {resp.status_code}.'
            )

        try:
            body = resp.json()
        except ValueError as exc:
            raise LiveCheckoutNotConfigured(
                'Global Payments session API devolvió JSON inválido.'
            ) from exc

        redirect = (
            body.get('redirect_url')
            or body.get('hpp_url')
            or body.get('url')
            or (body.get('action') or {}).get('url')
            or ''
        )
        if not redirect:
            raise LiveCheckoutNotConfigured(
                'Global Payments session API no devolvió redirect_url/hpp_url.'
            )
        session_id = str(
            body.get('id') or body.get('session_id') or body.get('reference') or ''
        )
        return CheckoutSession(redirect_url=redirect, session_id=session_id, raw=body)
