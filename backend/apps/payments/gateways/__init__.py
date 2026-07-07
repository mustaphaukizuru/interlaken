"""
payments/gateways — pluggable hosted-payment gateway layer.

``get_gateway(name)`` resolves a gateway by machine name (falling back to
``settings.DEFAULT_PAYMENT_GATEWAY``); ``iter_gateways()`` yields every known
gateway (used by the generic webhook endpoint to find the one whose signature
verifies).
"""
from django.conf import settings

from .banorte import BanorteGateway
from .base import BaseGateway, WebhookEvent
from .global_payments import GlobalPaymentsGateway

_GATEWAYS = {
    GlobalPaymentsGateway.name: GlobalPaymentsGateway,
    BanorteGateway.name: BanorteGateway,
}

GATEWAY_CHOICES = tuple(_GATEWAYS.keys())


def get_gateway(name: str | None = None) -> BaseGateway:
    """Return a gateway instance for ``name`` (default: ``DEFAULT_PAYMENT_GATEWAY``)."""
    if not name:
        name = getattr(settings, 'DEFAULT_PAYMENT_GATEWAY', GlobalPaymentsGateway.name)
    cls = _GATEWAYS.get(str(name).lower(), GlobalPaymentsGateway)
    return cls()


def iter_gateways():
    """Yield one instance of every registered gateway."""
    for cls in _GATEWAYS.values():
        yield cls()


__all__ = [
    'BaseGateway',
    'WebhookEvent',
    'GlobalPaymentsGateway',
    'BanorteGateway',
    'get_gateway',
    'iter_gateways',
    'GATEWAY_CHOICES',
]
