"""
core/fields.py — transparent at-rest encryption for sensitive model fields (B4).

`EncryptedTextField` encrypts on write and decrypts on read using Fernet
(AES-128-CBC + HMAC). The key comes from `settings.FIELD_ENCRYPTION_KEY` (a urlsafe
base64 32-byte Fernet key); if unset it is derived from `SECRET_KEY` for dev/test
convenience. In production set a DEDICATED `FIELD_ENCRYPTION_KEY` so rotating
`SECRET_KEY` does not make encrypted data unreadable.
"""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models


def _fernet() -> Fernet:
    key = getattr(settings, 'FIELD_ENCRYPTION_KEY', '') or ''
    if key:
        return Fernet(key.encode() if isinstance(key, str) else key)
    derived = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
    return Fernet(derived)


class EncryptedTextField(models.TextField):
    """A TextField whose value is stored encrypted at rest."""

    def get_prep_value(self, value):
        if value is None or value == '':
            return value
        return _fernet().encrypt(str(value).encode()).decode()

    def from_db_value(self, value, expression, connection):
        if value is None or value == '':
            return value
        try:
            return _fernet().decrypt(value.encode()).decode()
        except (InvalidToken, ValueError):
            # Value predates encryption (or a different key) — return as-is so a
            # migration can re-save it encrypted without crashing on read.
            return value
