"""
payments/gateways/base.py — common gateway interface.

Each payment provider (Global Payments HPP, Banorte Pago en Línea) implements
this small surface so the rest of the app never touches provider specifics:

- ``create_checkout(payment) -> redirect_url`` — build the hosted-payment URL the
  parent is sent to (card data stays on the provider's page → minimal PCI scope).
- ``verify_webhook(request) -> WebhookEvent | None`` — authenticate an inbound
  server-to-server notification and normalise it. Returns ``None`` when the
  signature is missing/invalid so the view answers 401 (fails closed).

Signature scheme (shared, per Prompt 03): ``HMAC-SHA256(secret, raw_body)`` as a
hex digest sent in the ``X-Webhook-Signature`` header. Each gateway reads its own
secret from settings, so the same verification code serves both providers.
"""
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass, field

from django.conf import settings

logger = logging.getLogger(__name__)


@dataclass
class WebhookEvent:
    """A provider-agnostic view of a payment webhook.

    ``status`` is normalised to one of ``'success' | 'failed' | 'pending'`` so the
    processing code never branches on provider-specific status strings.
    """
    payment_id: object
    status: str
    transaction_id: str | None
    raw: dict = field(default_factory=dict)


class BaseGateway:
    """Base class for hosted-payment gateways."""

    #: machine name stored on ``Payment.gateway``
    name: str = ''
    #: settings attribute holding this gateway's webhook HMAC secret
    webhook_secret_setting: str = ''
    #: provider status strings that mean the money was captured
    SUCCESS_STATUSES: frozenset = frozenset()
    #: provider status strings that mean the payment failed/was declined
    FAILURE_STATUSES: frozenset = frozenset()

    # ── checkout ──────────────────────────────────────────────
    def create_checkout(self, payment) -> str:  # pragma: no cover - abstract
        """Return the hosted-payment redirect URL for ``payment``."""
        raise NotImplementedError

    # ── webhook ───────────────────────────────────────────────
    def verify_webhook(self, request):
        """Return a ``WebhookEvent`` when the signature is valid, else ``None``."""
        if not self._verify_signature(request):
            return None
        try:
            return self._parse_event(request)
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as e:
            logger.warning(f'{self.name}: unparseable webhook body: {e}')
            return None

    # ── helpers ───────────────────────────────────────────────
    def _secret(self) -> str:
        return getattr(settings, self.webhook_secret_setting, '') or ''

    def _verify_signature(self, request) -> bool:
        """Constant-time compare the request signature against our HMAC.

        Fails closed: with no configured secret or no signature header, returns
        ``False`` (the view then answers 401).
        """
        secret = self._secret()
        signature = (
            request.headers.get('X-Webhook-Signature')
            or request.headers.get('X-Signature', '')
        )
        if not secret or not signature:
            return False
        expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def _parse_event(self, request) -> WebhookEvent:
        """Normalise the JSON body into a ``WebhookEvent``.

        Uses the shared field conventions (``order_id``/``reference`` → our
        ``Payment`` pk, ``id``/``transaction_id`` → gateway tx id); subclasses set
        ``SUCCESS_STATUSES`` / ``FAILURE_STATUSES`` to map their own vocabulary.
        """
        payload = json.loads(request.body)
        transaction_id = payload.get('id') or payload.get('transaction_id')
        payment_id = payload.get('order_id') or payload.get('reference')
        raw_status = (payload.get('status') or '').upper()

        if raw_status in self.SUCCESS_STATUSES:
            status = 'success'
        elif raw_status in self.FAILURE_STATUSES:
            status = 'failed'
        else:
            status = 'pending'

        return WebhookEvent(
            payment_id=payment_id,
            status=status,
            transaction_id=transaction_id,
            raw=payload,
        )
