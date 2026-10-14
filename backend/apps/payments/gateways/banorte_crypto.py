"""
payments/gateways/banorte_crypto.py — Banorte "Ventana de Comercio Electrónico
Cifrada" (VCE) envelope, per the integration manual v1.7, Anexo B.

The checkout parameters travel to Banorte's lightbox as ONE opaque string::

    Subcadena1:::Subcadena2

- **Subcadena2** = Base64(AES/CTR/NoPadding(json_params)), AES-128 key =
  PBKDF2-HMAC-SHA1(passphrase, salt, 1000 iterations, 16 bytes), IV = the 16
  raw bytes behind ``viHex``.
- **Subcadena1** = Base64(RSA/ECB/OAEP(SHA-256, MGF1-SHA-1)("viHex::saltHex::passphrase"))
  with the public key of the merchant certificate Banorte issues every March.

Banorte answers with ``data`` encrypted under the SAME key and IV, so the
merchant keeps (vi, salt, passphrase) server-side to decrypt it. The test
suite pins all of this to the worked example printed in the manual.

Two properties of this scheme are Banorte's, not ours, and shape how the rest
of the integration treats it:

1. **Keystream reuse.** Request and response share key+IV in CTR mode, and the
   browser sees both ciphertexts. Wherever the response plaintext is guessable,
   the XOR of the two ciphertexts reveals the request plaintext at the same
   byte offsets. ``build_params_json`` therefore puts the Payworks execution
   credentials LAST, behind JSON whitespace, at an offset no response can reach.
2. **No integrity.** CTR without a MAC is malleable, and the result comes back
   through the parent's browser. A decrypted "approved" is a strong signal, not
   proof; staff confirm the reference in MultiCobros before loading the POS.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

# Character sets from the manual's .NET ``Keys.CreaRandom`` sample, verbatim
# (Banorte's own set skips 'Y' and 'j'; we keep it identical on purpose).
PASSPHRASE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz*&-%/!?*+=()"
VI_SALT_ALPHABET = "0123456789abcdefghiklmnopqrstuvwxyz"
PBKDF2_ITERATIONS = 1000
AES_KEY_BYTES = 16

SEPARATOR = ":::"
KEY_SEPARATOR = "::"

# Payworks execution credentials: kept out of the first bytes of the JSON
# (see module docstring, point 1). merchantId is not secret (it comes back in
# the response as idAfiliacion) but rides along with the others.
CREDENTIAL_KEYS = ("merchantId", "name", "password")
# A decrypted response tops out well under 1 KiB (13 short fields plus a
# 200-char ``texto``); 2 KiB leaves a wide margin even for multi-byte text.
DEFAULT_CREDENTIAL_OFFSET = 2048


class BanorteCryptoError(Exception):
    """The envelope could not be built, or a response could not be decrypted."""


@dataclass(frozen=True)
class KeyMaterial:
    """The per-transaction AES secret: needed again to decrypt the response."""

    vi_hex: str
    salt_hex: str
    passphrase: str

    def serialize(self) -> str:
        return KEY_SEPARATOR.join((self.vi_hex, self.salt_hex, self.passphrase))

    @classmethod
    def deserialize(cls, value: str) -> KeyMaterial:
        # The passphrase alphabet has no ':' so a plain split is unambiguous.
        parts = (value or "").split(KEY_SEPARATOR)
        if len(parts) != 3 or not all(parts):
            raise BanorteCryptoError("Material de cifrado inválido.")
        return cls(*parts)


def _random(alphabet: str, length: int) -> str:
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_key_material() -> KeyMaterial:
    """Fresh (vi, salt, passphrase) from a CSPRNG (the manual's sample uses
    ``System.Random``; the format is identical, the randomness is not)."""
    vi = _random(VI_SALT_ALPHABET, 16)
    salt = _random(VI_SALT_ALPHABET, 16)
    return KeyMaterial(
        vi_hex=vi.encode("ascii").hex().upper(),
        salt_hex=salt.encode("ascii").hex().upper(),
        passphrase=_random(PASSPHRASE_ALPHABET, 16),
    )


def _aes_key(material: KeyMaterial) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha1",
        material.passphrase.encode("utf-8"),
        bytes.fromhex(material.salt_hex),
        PBKDF2_ITERATIONS,
        AES_KEY_BYTES,
    )


def _aes_ctr(material: KeyMaterial, data: bytes) -> bytes:
    # CTR is symmetric: the same transform encrypts and decrypts. The IV is the
    # full 128-bit initial counter, as BouncyCastle's SIC mode uses it.
    ctx = Cipher(
        algorithms.AES(_aes_key(material)), modes.CTR(bytes.fromhex(material.vi_hex))
    ).encryptor()
    return ctx.update(data) + ctx.finalize()


def aes_encrypt(material: KeyMaterial, plaintext: str) -> str:
    return base64.b64encode(_aes_ctr(material, plaintext.encode("utf-8"))).decode("ascii")


def aes_decrypt(material: KeyMaterial, ciphertext_b64: str) -> str:
    try:
        raw = base64.b64decode(ciphertext_b64, validate=True)
    except (ValueError, TypeError) as exc:
        raise BanorteCryptoError("Respuesta cifrada con Base64 inválido.") from exc
    try:
        return _aes_ctr(material, raw).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise BanorteCryptoError("La respuesta no descifra a texto válido.") from exc


# ── merchant certificate ─────────────────────────────────────


@dataclass(frozen=True)
class BanorteCertificate:
    public_key: RSAPublicKey
    not_after: datetime
    subject: str
    fingerprint: str  # SHA-256 of the DER, hex

    def days_left(self, now: datetime | None = None) -> int:
        now = now or datetime.now(timezone.utc)
        return (self.not_after - now).days

    def is_expired(self, now: datetime | None = None) -> bool:
        return (now or datetime.now(timezone.utc)) >= self.not_after


def load_certificate(raw: bytes | str) -> BanorteCertificate:
    """Parse the ``.cer`` Banorte ships: PEM (with or without the leading
    ``#CN=…`` comment line), a bare Base64 body, or DER."""
    data = raw.encode("utf-8") if isinstance(raw, str) else raw
    try:
        if b"BEGIN CERTIFICATE" in data:
            lines = [ln for ln in data.splitlines() if not ln.lstrip().startswith(b"#")]
            cert = x509.load_pem_x509_certificate(b"\n".join(lines))
        else:
            stripped = re.sub(rb"\s+", b"", data)
            try:
                der = base64.b64decode(stripped, validate=True)
            except ValueError:
                der = data
            cert = x509.load_der_x509_certificate(der)
    except ValueError as exc:
        raise BanorteCryptoError("El certificado de Banorte no se pudo leer.") from exc
    key = cert.public_key()
    if not isinstance(key, RSAPublicKey):
        raise BanorteCryptoError("El certificado de Banorte no contiene una llave RSA.")
    der = cert.public_bytes(serialization.Encoding.DER)
    return BanorteCertificate(
        public_key=key,
        not_after=cert.not_valid_after_utc,
        subject=cert.subject.rfc4514_string(),
        fingerprint=hashlib.sha256(der).hexdigest(),
    )


def rsa_encrypt(public_key: RSAPublicKey, text: str) -> str:
    """RSA/ECB/OAEPWITHSHA256ANDMGF1WITHSHA1PADDING, Base64."""
    encrypted = public_key.encrypt(
        text.encode("utf-8"),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA1()), algorithm=hashes.SHA256(), label=None
        ),
    )
    return base64.b64encode(encrypted).decode("ascii")


# ── request parameters ───────────────────────────────────────

# Anything outside this set is either on the manual's forbidden list
# (< > | ¡ ! ¿ ? * + ' / \ { } [ ] ¨ Ñ ; : " # $ % & ( ) = and accented vowels)
# or not worth the risk. Accents are folded (á → a, ñ → n) before filtering.
_UNSAFE = re.compile(r"[^A-Za-z0-9 .\-_@]")


def clean_text(value, max_len: int) -> str:
    """Fold accents, drop characters Banorte rejects, collapse spaces, truncate."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode("ascii")
    text = _UNSAFE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len].rstrip()


def build_params_json(params: dict, *, credential_offset: int = DEFAULT_CREDENTIAL_OFFSET) -> str:
    """Serialise the VCE parameters with the credentials placed after
    ``credential_offset`` bytes of JSON.

    Empty values are dropped (the manual forbids sending blank variables). The
    filler is plain JSON whitespace between two members, which every conforming
    parser ignores; ``credential_offset=0`` disables it.
    """
    clean = {k: v for k, v in params.items() if v not in (None, "")}
    head = {k: v for k, v in clean.items() if k not in CREDENTIAL_KEYS}
    tail = {k: clean[k] for k in CREDENTIAL_KEYS if k in clean}
    if not tail:
        return json.dumps(head, ensure_ascii=True, separators=(",", ":"))

    head_json = json.dumps(head, ensure_ascii=True, separators=(",", ":"))[:-1]  # drop '}'
    tail_json = json.dumps(tail, ensure_ascii=True, separators=(",", ":"))[1:]  # drop '{'
    joiner = "," if head else ""
    prefix = head_json + joiner
    filler = " " * max(0, credential_offset - len(prefix))
    return prefix + filler + tail_json


def build_envelope(
    params: dict,
    certificate: BanorteCertificate,
    *,
    credential_offset: int = DEFAULT_CREDENTIAL_OFFSET,
    material: KeyMaterial | None = None,
) -> tuple[str, KeyMaterial]:
    """Return ``(Subcadena1:::Subcadena2, key_material)`` for ``params``."""
    material = material or generate_key_material()
    plaintext = build_params_json(params, credential_offset=credential_offset)
    subcadena2 = aes_encrypt(material, plaintext)
    subcadena1 = rsa_encrypt(certificate.public_key, material.serialize())
    return f"{subcadena1}{SEPARATOR}{subcadena2}", material


def decrypt_result(material: KeyMaterial, data_b64: str) -> dict:
    """Decrypt the ``data`` member of a VCE response into the Payworks result."""
    text = aes_decrypt(material, data_b64)
    try:
        result = json.loads(text)
    except json.JSONDecodeError as exc:
        raise BanorteCryptoError("La respuesta descifrada no es JSON válido.") from exc
    if not isinstance(result, dict):
        raise BanorteCryptoError("La respuesta descifrada no es un objeto JSON.")
    return result
