"""
payments/gateways/base.py — the small surface every gateway implements.

- ``start_checkout(payment, ...) -> CheckoutStart`` — everything the browser
  needs to take the parent's card on the provider's own page (card data never
  touches our servers). Either a ``redirect`` URL or a ``lightbox`` the frontend
  opens with the provider's script.
- ``PaymentEvent`` — a provider-agnostic outcome (``success | failed |
  refunded | pending``) that ``payments.settlement.apply_event`` turns into
  ledger movements. Gateways normalise their own vocabulary into it.

Banorte is the only gateway today; the seam stays so the settlement code never
branches on provider specifics.
"""

from dataclasses import asdict, dataclass, field


class LiveCheckoutNotConfigured(RuntimeError):
    """The gateway cannot open a real checkout (missing or expired configuration)."""


class CheckoutInputError(ValueError):
    """The request lacks data the gateway requires (shown to the parent as a 400)."""


@dataclass
class CheckoutStart:
    """How the browser should open the provider checkout."""

    kind: str  # 'redirect' | 'lightbox'
    url: str = ""  # redirect: where to send the browser
    params: str = ""  # lightbox: opaque (encrypted) parameters
    env: str = ""  # lightbox: provider environment name
    script_url: str = ""  # lightbox: provider checkout script
    jquery_url: str = ""  # lightbox: provider-hosted jQuery it depends on
    control_number: str = ""  # lightbox: our single-use reference

    def as_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v}


@dataclass
class PaymentEvent:
    """A normalised payment outcome.

    ``status`` is one of ``'success' | 'failed' | 'refunded' | 'pending'``;
    ``stage`` marks a *soft* failure (see ``Payment.SOFT_FAIL_STAGES``) that a
    later success may still override. ``reference`` is the provider's own
    operation number (Payworks ``referencia``), stored on ``Payment.gateway_ref``.
    """

    payment_id: object
    status: str
    transaction_id: str | None
    raw: dict = field(default_factory=dict)
    stage: str = ""
    reference: str = ""


class BaseGateway:
    #: machine name stored on ``Payment.gateway``
    name: str = ""
    #: False when a checkout is single-use (a new attempt needs a new Payment)
    reusable_checkout: bool = True

    def start_checkout(
        self, payment, *, request=None, billing=None
    ) -> CheckoutStart:  # pragma: no cover
        raise NotImplementedError
