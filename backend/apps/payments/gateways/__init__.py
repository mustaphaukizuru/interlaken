"""
payments/gateways — hosted-payment gateway layer.

Banorte (Ventana de Comercio Electrónico Cifrada) is the only gateway since
2026-10-13; ``get_gateway()`` returns it. The registry stays small on purpose so
the settlement code keeps a provider-agnostic seam.
"""

from .banorte import BanorteGateway
from .base import (
    BaseGateway,
    CheckoutInputError,
    CheckoutStart,
    LiveCheckoutNotConfigured,
    PaymentEvent,
)

_GATEWAYS = {
    BanorteGateway.name: BanorteGateway,
}

GATEWAY_CHOICES = tuple(_GATEWAYS.keys())


def get_gateway(name: str | None = None) -> BaseGateway:
    """Return the gateway called ``name`` (default and only option: Banorte)."""
    cls = _GATEWAYS.get(str(name or BanorteGateway.name).lower())
    if cls is None:
        raise KeyError(name)
    return cls()


__all__ = [
    "BaseGateway",
    "BanorteGateway",
    "CheckoutInputError",
    "CheckoutStart",
    "LiveCheckoutNotConfigured",
    "PaymentEvent",
    "get_gateway",
    "GATEWAY_CHOICES",
]
