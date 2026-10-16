"""
payments/gateways/banorte.py — Banorte "Ventana de Comercio Electrónico Cifrada"
(VCE, integration manual v1.8; encryption unchanged since v1.7).

Flow
----
1. ``start_checkout`` builds the Payworks parameters, encrypts them
   (``banorte_crypto``), stores the AES key material on a ``BanorteCheckout`` and
   returns a ``lightbox`` start: the browser loads Banorte's ``checkoutV2.js``
   from multicobros.banorte.com and calls ``Payment.startPayment({Params})``.
   The card, 3D Secure and the charge all happen inside Banorte's iframe.
2. Banorte reports the outcome to the browser only (there is no server-to-server
   notification). The frontend posts the raw callback to
   ``POST /api/v1/payments/banorte/result/``; ``interpret_result`` decrypts the
   ``data`` member with the stored key and decides on the DECRYPTED Payworks
   result alone. The cleartext members (bnteCode, decision, …) are kept for
   support but never trusted.

Modes
-----
``PAYMENTS_LIVE=true`` always sends ``mode=PRD`` (real money) and refuses to open
a checkout without complete configuration. Otherwise ``BANORTE_MODE`` picks a
Payworks simulation (AUT approves, DEC declines, RND random); PRD is downgraded
to AUT so a staging box can never charge a card. With no credentials at all and
``PAYMENTS_LIVE=false`` (local dev) the checkout falls back to the
``/pago/simulado`` mock page.
"""

from __future__ import annotations

import logging
import os
import secrets
import string
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode

from django.conf import settings

from .banorte_crypto import (
    DEFAULT_CREDENTIAL_OFFSET,
    BanorteCertificate,
    BanorteCryptoError,
    KeyMaterial,
    build_envelope,
    clean_text,
    decrypt_result,
    load_certificate,
)
from .base import BaseGateway, CheckoutStart, LiveCheckoutNotConfigured, PaymentEvent

logger = logging.getLogger(__name__)

SIMULATION_MODES = frozenset({"AUT", "DEC", "RND"})
DEFAULT_SCRIPT_BASE = "https://multicobros.banorte.com/orquestador"
# Where the frontend lands after the lightbox (and the mock page) finishes.
RETURN_PATH = "/portal/cafeteria/recarga/retorno"

# Payworks ``resultadoPayw`` → normalised outcome.
_FINAL_FAILURES = frozenset({"D", "R", "N", "E"})


@dataclass(frozen=True)
class BanorteConfig:
    merchant_id: str
    user: str
    password: str
    terminal_id: str
    merchant_name: str
    merchant_city: str
    mode: str
    script_base: str
    lightbox_env: str
    credential_offset: int
    cert_raw: str
    cert_path: str

    @classmethod
    def from_settings(cls) -> BanorteConfig:
        def s(name, default=""):
            return str(getattr(settings, name, default) or default).strip()

        return cls(
            merchant_id=s("BANORTE_MERCHANT_ID"),
            user=s("BANORTE_USER"),
            password=str(getattr(settings, "BANORTE_PASSWORD", "") or ""),
            terminal_id=s("BANORTE_TERMINAL_ID"),
            merchant_name=clean_text(s("BANORTE_MERCHANT_NAME", "Colegio Interlaken"), 25),
            merchant_city=clean_text(s("BANORTE_MERCHANT_CITY"), 40),
            mode=s("BANORTE_MODE", "AUT").upper(),
            script_base=s("BANORTE_SCRIPT_BASE", DEFAULT_SCRIPT_BASE).rstrip("/"),
            lightbox_env=s("BANORTE_LIGHTBOX_ENV", "pro"),
            credential_offset=int(
                getattr(settings, "BANORTE_CREDENTIAL_OFFSET", DEFAULT_CREDENTIAL_OFFSET)
            ),
            cert_raw=str(getattr(settings, "BANORTE_CERT", "") or ""),
            cert_path=s("BANORTE_CERT_PATH"),
        )

    def missing(self) -> list[str]:
        """Settings a real (or simulated) Banorte checkout cannot run without."""
        required = {
            "BANORTE_MERCHANT_ID": self.merchant_id,
            "BANORTE_USER": self.user,
            "BANORTE_PASSWORD": self.password,
            "BANORTE_TERMINAL_ID": self.terminal_id,
            "BANORTE_MERCHANT_CITY": self.merchant_city,
            "BANORTE_CERT o BANORTE_CERT_PATH": self.cert_raw or self.cert_path,
        }
        return [name for name, value in required.items() if not value]

    def effective_mode(self) -> str:
        if getattr(settings, "PAYMENTS_LIVE", False):
            return "PRD"
        if self.mode in SIMULATION_MODES:
            return self.mode
        if self.mode == "PRD":
            logger.warning("BANORTE_MODE=PRD ignored: PAYMENTS_LIVE is false, using AUT.")
        return "AUT"

    def certificate(self) -> BanorteCertificate:
        raw = self.cert_raw
        if not raw and self.cert_path:
            try:
                raw = Path(self.cert_path).read_bytes()
            except OSError as exc:
                raise LiveCheckoutNotConfigured(
                    f"No se pudo leer BANORTE_CERT_PATH ({self.cert_path})."
                ) from exc
        return _parse_certificate(raw if isinstance(raw, bytes) else raw.encode("utf-8"))


@lru_cache(maxsize=4)
def _parse_certificate(raw: bytes) -> BanorteCertificate:
    try:
        return load_certificate(raw)
    except BanorteCryptoError as exc:
        raise LiveCheckoutNotConfigured(str(exc)) from exc


def is_payment_tester(user) -> bool:
    """True for the accounts listed in ``PAYMENTS_TEST_EMAILS``."""
    testers = {e.strip().lower() for e in getattr(settings, "PAYMENTS_TEST_EMAILS", []) if e}
    email = (getattr(user, "email", "") or "").strip().lower()
    return bool(email) and email in testers


def online_payments_status(user) -> dict:
    """Whether ``user`` may pay online right now, and in which stage.

    Returns ``{online, test_mode, certification}``. Three stages, from two
    settings (``PAYMENTS_LIVE`` = real charges, ``PAYMENTS_OPEN_TO_ALL`` = every
    family):

    - **Simulation** (``PAYMENTS_LIVE=false``): Banorte approves every card
      without charging it, so a deployed server offers card payment only to
      ``PAYMENTS_TEST_EMAILS`` (opening it would hand out free wallet credit).
      Local development (``DEBUG`` or ``SQLITE_LOCAL``, the sandbox endpoint's
      rule) offers it to everyone.
    - **Certification** (``PAYMENTS_LIVE=true``, not open): real charges, still
      only for ``PAYMENTS_TEST_EMAILS``. Banorte certifies an integration with
      real (PRD) payments before production, and must not see families pay
      before its certification letter.
    - **Open** (both true): every family, real charges.
    """
    live = bool(getattr(settings, "PAYMENTS_LIVE", False))
    if live and getattr(settings, "PAYMENTS_OPEN_TO_ALL", False):
        return {"online": True, "test_mode": False, "certification": False}
    if not live and (getattr(settings, "DEBUG", False) or os.getenv("SQLITE_LOCAL")):
        return {"online": True, "test_mode": True, "certification": False}
    return {
        "online": is_payment_tester(user),
        "test_mode": not live,
        "certification": live,
    }


def new_control_number(payment) -> str:
    """Single-use Payworks ``controlNumber``: ``IK`` + payment id + 10 random
    uppercase alphanumerics (≤ 30 chars, none of Banorte's forbidden characters)."""
    alphabet = string.ascii_uppercase + string.digits
    return f'IK{payment.pk}{"".join(secrets.choice(alphabet) for _ in range(10))}'[:30]


class BanorteGateway(BaseGateway):
    name = "banorte"
    # A controlNumber may be sent to Payworks once; every attempt is a new Payment.
    reusable_checkout = False

    def start_checkout(self, payment, *, request=None, billing=None) -> CheckoutStart:
        from ..models import BanorteCheckout

        config = BanorteConfig.from_settings()
        live = bool(getattr(settings, "PAYMENTS_LIVE", False))
        missing = config.missing()
        if missing:
            if live:
                raise LiveCheckoutNotConfigured(
                    "PAYMENTS_LIVE=true requiere: " + ", ".join(missing)
                )
            return self._mock_checkout(payment)

        certificate = config.certificate()
        if certificate.is_expired():
            # Banorte rotates the key every March; an expired certificate means
            # the lightbox would answer AUT-10 for every parent.
            raise LiveCheckoutNotConfigured(
                f"El certificado de Banorte venció el {certificate.not_after:%Y-%m-%d}. "
                "Solicite el vigente a Banorte y actualice BANORTE_CERT."
            )

        mode = config.effective_mode()
        control_number = new_control_number(payment)
        params = self.build_params(payment, config, mode=mode, control_number=control_number)
        envelope, material = build_envelope(
            params, certificate, credential_offset=config.credential_offset
        )

        BanorteCheckout.objects.create(
            payment=payment,
            control_number=control_number,
            mode=mode,
            key_material=material.serialize(),
            cert_fingerprint=certificate.fingerprint,
        )
        logger.info(
            "banorte checkout opened payment=%s control=%s mode=%s",
            payment.pk,
            control_number,
            mode,
        )
        return CheckoutStart(
            kind="lightbox",
            params=envelope,
            env=config.lightbox_env,
            script_url=f"{config.script_base}/lightbox/checkoutV2.js",
            jquery_url=f"{config.script_base}/resources/js/jquery-3.3.1.js",
            control_number=control_number,
        )

    @staticmethod
    def build_params(payment, config: BanorteConfig, *, mode: str, control_number: str) -> dict:
        """The Payworks variables (manual v1.8 p. 8). Empty values are dropped by
        the serialiser; free text is folded to Banorte's allowed characters."""
        topup = getattr(payment, "related_topup", None)
        matricula = ""
        if topup is not None:
            matricula = getattr(topup.student, "student_id", "") or ""
        return {
            "merchantId": config.merchant_id,
            "name": config.user,
            "password": config.password,
            "mode": mode,
            "controlNumber": control_number,
            "terminalId": config.terminal_id,
            "amount": f"{payment.amount:.2f}",
            "merchantName": config.merchant_name,
            "merchantCity": config.merchant_city,
            "lang": "ES",
            # Searchable in MultiCobros as Referencia 1/2/3.
            "customerRef1": f"PAGO{payment.pk}",
            "customerRef2": clean_text(matricula, 16).replace(" ", ""),
            "customerRef3": "CAFETERIA",
        }

    @staticmethod
    def _mock_checkout(payment) -> CheckoutStart:
        """Local development without Banorte credentials: the /pago/simulado page."""
        frontend = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
        query = urlencode(
            {
                "order_id": payment.pk,
                "amount": f"{payment.amount:.2f}",
                "currency": payment.currency,
                "return_url": f"{RETURN_PATH}?payment_id={payment.pk}",
            }
        )
        return CheckoutStart(kind="redirect", url=f"{frontend}/pago/simulado?{query}")


# ── result ───────────────────────────────────────────────────

# Cleartext members of the lightbox callback worth keeping for support. They
# are informative only: anything that decides money comes from ``data``.
_OUTER_KEYS = (
    "status3D",
    "eci",
    "decision",
    "reasonCode",
    "bnteCode",
    "bnteText",
    "id",
    "message",
    "numeroControl",
)

_RESULT_FIELDS = {
    # decrypted key → (BanorteCheckout field, max length)
    "referencia": ("referencia", 20),
    "codigoAut": ("codigo_aut", 10),
    "resultadoAut": ("resultado_aut", 10),
    "codigoPayw": ("codigo_payw", 12),
    "texto": ("texto", 255),
    "bancoEmisor": ("banco_emisor", 40),
    "marcaTarjeta": ("marca_tarjeta", 40),
    "tipoTarjeta": ("tipo_tarjeta", 40),
    "fechaRspCte": ("fecha_rsp_cte", 30),
}


# Payworks answers that mean the merchant set-up is wrong (R: rejected, e.g.
# PAYW-3008 "terminal no existe"; E: Banorte internal error). Nothing reached
# the card issuer; the admins are emailed (``ops_alerts.alert_config_error``).
_CONFIG_ERROR_CODES = frozenset({"R", "E"})
# 3D Secure status Banorte reports when the cardholder cancels the 3DS challenge.
STATUS_3D_CANCELLED = "423"


@dataclass
class ResultOutcome:
    event: PaymentEvent
    fields: dict  # BanorteCheckout updates
    anomaly: str = ""  # why a result was NOT trusted (logged + stored)
    config_error: str = ""  # merchant set-up problem the admins must hear about


def _short(value, limit) -> str:
    return str(value if value is not None else "")[:limit]


def interpret_result(checkout, browser_event: str, response: dict) -> ResultOutcome:
    """Turn a lightbox callback into a ``PaymentEvent``.

    Never raises for bad input: anything that does not decrypt and match is
    returned as ``pending`` with an ``anomaly`` so the payment stays open for a
    staff check instead of being credited or failed on untrusted data.
    """
    payment_id = checkout.payment_id
    response = response if isinstance(response, dict) else {}
    outer = {k: response[k] for k in _OUTER_KEYS if k in response}
    fields = {
        "event": _short(browser_event, 20),
        "status_3d": _short(response.get("status3D", ""), 10),
        "eci": _short(response.get("eci", ""), 5),
    }

    def pending(anomaly="", raw=None):
        if anomaly:
            fields["last_error"] = anomaly[:255]
        return ResultOutcome(
            PaymentEvent(payment_id, "pending", None, raw or {"banorte": outer}), fields, anomaly
        )

    data = response.get("data")
    if not data:
        status_3d = fields["status_3d"]
        cancelled_3d = status_3d == STATUS_3D_CANCELLED and browser_event != "success"
        if browser_event == "cancel" or cancelled_3d:
            # Cancelled in the window, or in the 3D Secure challenge (status3D
            # 423): nothing was charged. Soft, so a late approval still credits.
            return ResultOutcome(
                PaymentEvent(payment_id, "failed", None, {"banorte": outer}, stage="cancel"), fields
            )
        if browser_event == "error" and str(response.get("id")) == "4":
            # checkoutV2.js "_auth": Banorte rejected our envelope (AUT-10 —
            # wrong credentials, wrong or expired certificate). Nothing was charged.
            fields["last_error"] = "Banorte rechazó la autenticación del comercio (AUT-10)."
            return ResultOutcome(
                PaymentEvent(
                    payment_id, "failed", None, {"banorte": outer}, stage="create_checkout"
                ),
                fields,
                fields["last_error"],
                config_error="AUT-10: Banorte rechazó la autenticación del comercio "
                "(credenciales, certificado o terminal).",
            )
        if browser_event == "error":
            fields["last_error"] = _short(
                response.get("message") or "Error en la ventana de pago.", 255
            )
        if browser_event == "success":
            # "Success" without the encrypted result (seen with status3D 451):
            # nothing to trust, so it stays pending for a MultiCobros check.
            shown = status_3d or "vacío"
            return pending(
                f"Banorte reportó éxito sin resultado cifrado (status3D {shown}); "
                "revise la operación en MultiCobros."
            )
        return pending()

    if not checkout.key_material:
        return pending("La operación ya estaba cerrada; se ignoró un resultado tardío.")
    try:
        material = KeyMaterial.deserialize(checkout.key_material)
        result = decrypt_result(material, str(data))
    except BanorteCryptoError as exc:
        return pending(f"Resultado no confiable: {exc}")

    raw = {"banorte": outer, "payworks": result}
    if str(result.get("numeroControl", "")) != checkout.control_number:
        return pending("Resultado no confiable: el número de control no coincide.", raw)
    merchant_id = (getattr(settings, "BANORTE_MERCHANT_ID", "") or "").strip()
    if merchant_id and str(result.get("idAfiliacion", "")).strip() != merchant_id:
        return pending("Resultado no confiable: la afiliación no coincide.", raw)

    code = str(result.get("resultadoPayw", "")).strip().upper()[:1]
    fields["resultado_payw"] = code
    for source, (target, limit) in _RESULT_FIELDS.items():
        if result.get(source) not in (None, ""):
            fields[target] = _short(result[source], limit)
    reference = fields.get("referencia", "")

    if code == "A":
        if not reference.isdigit():
            return pending("Aprobación sin referencia Payworks válida.", raw)
        if not checkout.is_live and getattr(settings, "PAYMENTS_LIVE", False):
            # A simulated (AUT/RND) approval must never become real wallet money.
            return pending(
                f"Aprobación simulada (modo {checkout.mode}) con PAYMENTS_LIVE=true.", raw
            )
        return ResultOutcome(
            PaymentEvent(payment_id, "success", checkout.control_number, raw, reference=reference),
            fields,
        )
    if code == "T":
        return ResultOutcome(
            PaymentEvent(
                payment_id,
                "failed",
                checkout.control_number,
                raw,
                stage="bank_timeout",
                reference=reference,
            ),
            fields,
        )
    if code in _FINAL_FAILURES:
        config_error = ""
        if code in _CONFIG_ERROR_CODES:
            detail = " ".join(
                part for part in (fields.get("codigo_payw", ""), fields.get("texto", "")) if part
            )
            config_error = f"Payworks {code}: {detail or 'sin detalle'}"
        return ResultOutcome(
            PaymentEvent(payment_id, "failed", checkout.control_number, raw, reference=reference),
            fields,
            config_error=config_error,
        )
    return pending(f'Resultado Payworks desconocido: {code or "vacío"}.', raw)
