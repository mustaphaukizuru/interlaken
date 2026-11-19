"""
core/backups.py: the off-site copy of the nightly database dump.

The school holds minors' data, so the dump is the most sensitive thing this
system produces. Until 2026-11-18 ``offsite_backup`` uploaded the PLAINTEXT
dump through ``default_storage``: the moment anyone set
``AWS_STORAGE_BUCKET_NAME`` for the CMS media library, every nightly dump
would have landed unencrypted in the media bucket (which the site serves, and
which may be public) at a guessable key. Now it is impossible by construction:

* ``deploy/backup-db.sh`` encrypts each dump to ``deploy/backup-public-key.asc``
  (public key only; the private key never touches the server's code or the
  repository) and sends nothing else off the box.
* ``check_ciphertext`` refuses anything that is not an OpenPGP message
  encrypted to that key: a gzip dump, an armored text, a message for another
  key, an error page.
* the copy goes to a DEDICATED private bucket configured with ``BACKUP_S3_*``
  (``backup_storage``). There is no fallback to ``default_storage``, the media
  bucket or its ``AWS_*`` credentials: without ``BACKUP_S3_*`` there is simply
  no off-site copy, and the console says «sin copia externa».

Off-site outcomes live in the ``backup`` OpsStatus marker next to the local
ones (``record_backup``)::

    offsite            where the last good copy went ("bucket/key", "BACKUP_REMOTE")
    offsite_at         when (ISO)
    offsite_error      why the last attempt failed (None after a good one)
    offsite_error_at   when it failed
    offsite_remote     True when backup-db.sh also copies to BACKUP_REMOTE
    offsite_attempt_at when the last attempt ran, good or bad
"""

from __future__ import annotations

import re

from django.conf import settings

# backup-db.sh names dumps db-<YYYY-MM-DD>-<HHMM>.sql.gz; the ciphertext adds .gpg.
NAME_RE = re.compile(r"^db-\d{4}-\d{2}-\d{2}(-\d{4})?\.sql\.gz\.gpg$")
GZIP_MAGIC = b"\x1f\x8b"
# A real dump is well over this (backup-db.sh refuses < 10 KB before encrypting).
MIN_BYTES = 10_000

# The encryption subkey of deploy/backup-public-key.asc (primary key
# AAA0DA4256F7EC7A752477B06574D2D47EC9E0A2). A dump encrypted to any other key
# is refused: the school could not decrypt it. Rotating the key means
# replacing the .asc file, this set and backup-db.sh's fingerprint together;
# test_backup_offsite pins all three to each other.
BACKUP_KEY_IDS = frozenset({"4D65849974CEA960"})
BACKUP_KEY_FINGERPRINT = "AAA0DA4256F7EC7A752477B06574D2D47EC9E0A2"

# OpenPGP packet tags (RFC 4880 / 9580).
_TAG_PKESK = 1  # public-key encrypted session key
_DATA_TAGS = {9, 18, 20}  # symmetrically encrypted data (SED, SEIPD, AEAD)


class BackupRefused(Exception):
    """The input is not something that may leave the server (plaintext, wrong key...)."""


class BackupConfigError(Exception):
    """The off-site storage is missing, incomplete or unsafe."""


# ── what may be uploaded ──────────────────────────────────
def _packets(data: bytes, limit: int = 8):
    """Yield ``(tag, body)`` for the first OpenPGP packets of ``data``; stop on anything odd."""
    pos = 0
    for _ in range(limit):
        if pos >= len(data):
            return
        b0 = data[pos]
        if not b0 & 0x80:
            return
        if b0 & 0x40:  # new-format header
            tag = b0 & 0x3F
            if pos + 1 >= len(data):
                return
            l0 = data[pos + 1]
            if l0 < 192:
                hlen, plen = 2, l0
            elif l0 < 224:
                if pos + 2 >= len(data):
                    return
                hlen, plen = 3, ((l0 - 192) << 8) + data[pos + 2] + 192
            elif l0 == 255:
                hlen, plen = 6, int.from_bytes(data[pos + 2 : pos + 6], "big")
            else:
                # Partial body length: only the encrypted data packet uses it,
                # and it is always last. Report it without a body.
                yield tag, b""
                return
        else:  # old-format header
            tag = (b0 >> 2) & 0x0F
            length_type = b0 & 0x03
            if length_type == 3:  # indeterminate: runs to the end of the file
                yield tag, b""
                return
            n = 1 << length_type
            hlen, plen = 1 + n, int.from_bytes(data[pos + 1 : pos + 1 + n], "big")
        yield tag, data[pos + hlen : pos + hlen + plen]
        pos += hlen + plen


def pkesk_key_ids(data: bytes) -> list[str] | None:
    """Key IDs a binary OpenPGP message is encrypted to, or None when it is not one.

    A message encrypted with ``gpg --encrypt`` is one or more public-key
    session-key packets followed by the encrypted data packet; anything else
    (gzip, SQL, an armored text, a signature) returns None.
    """
    ids: list[str] = []
    for tag, body in _packets(data):
        if tag == _TAG_PKESK:
            if len(body) < 10 or body[0] != 3:
                return None
            ids.append(body[1:9].hex().upper())
            continue
        return ids if ids and tag in _DATA_TAGS else None
    return None


def check_ciphertext(data: bytes) -> None:
    """Raise ``BackupRefused`` unless ``data`` is a dump encrypted to the backup key."""
    if data[:2] == GZIP_MAGIC:
        raise BackupRefused("es un volcado gzip SIN cifrar; nunca sale del servidor sin cifrar")
    if len(data) < MIN_BYTES:
        raise BackupRefused(
            f"el archivo mide {len(data)} bytes: no es un respaldo (¿página de error?)"
        )
    ids = pkesk_key_ids(data)
    if ids is None:
        raise BackupRefused("no es un mensaje GPG cifrado con llave pública")
    if not BACKUP_KEY_IDS.intersection(ids):
        raise BackupRefused(f"está cifrado para otra llave ({', '.join(ids)}), no la del colegio")


def check_name(name: str) -> str:
    name = (name or "").strip()
    if not NAME_RE.match(name):
        raise BackupRefused(f"nombre no válido {name!r}: debe ser db-AAAA-MM-DD-HHMM.sql.gz.gpg")
    return name


# ── where it goes ─────────────────────────────────────────
def storage_configured() -> bool:
    """True when a dedicated backup bucket is named (it may still be incomplete)."""
    return bool(getattr(settings, "BACKUP_S3_BUCKET", ""))


def offsite_configured(marker: dict | None = None) -> bool:
    """Is any off-site copy expected? The dedicated bucket, or BACKUP_REMOTE on the host.

    BACKUP_REMOTE lives in the host's .env, which the app cannot read, so
    backup-db.sh reports it on every run (``offsite_remote`` in the marker).
    """
    if storage_configured():
        return True
    if marker is None:
        from apps.core.models import OpsStatus

        marker = OpsStatus.get("backup") or {}
    return bool(marker.get("offsite_remote"))


def backup_storage():
    """The dedicated backup storage. Raises ``BackupConfigError`` when it is not safe to use.

    Never ``default_storage``: credentials, bucket, prefix and every option
    come from ``BACKUP_S3_*`` only (see ``backup_storage.BackupS3Storage``).
    """
    bucket = getattr(settings, "BACKUP_S3_BUCKET", "")
    if not bucket:
        raise BackupConfigError("no hay almacenamiento externo configurado (BACKUP_S3_BUCKET)")
    missing = [
        name
        for name in ("BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY")
        if not getattr(settings, name, "")
    ]
    if missing:
        # Empty keys would make boto3 fall back to AWS_ACCESS_KEY_ID from the
        # environment: the MEDIA bucket's credentials. Refuse instead.
        raise BackupConfigError(f"falta {', '.join(missing)} en deploy/.env")
    media_bucket = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "")
    if media_bucket and bucket == media_bucket:
        raise BackupConfigError(
            "BACKUP_S3_BUCKET es el mismo bucket de los archivos del sitio "
            "(AWS_STORAGE_BUCKET_NAME): use un bucket privado solo para respaldos"
        )
    from .backup_storage import BackupS3Storage

    return BackupS3Storage()


def describe_location(key: str) -> str:
    """``bucket/prefix/key`` for the marker and the console (never a URL)."""
    prefix = (getattr(settings, "BACKUP_S3_PREFIX", "") or "").strip("/")
    path = f"{prefix}/{key}" if prefix else key
    return f"{settings.BACKUP_S3_BUCKET}/{path}"
