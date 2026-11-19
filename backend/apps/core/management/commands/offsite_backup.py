"""
offsite_backup: the encrypted, private off-site copy of the nightly dump.

A backup that only exists on the machine it protects is not a backup. But the
dump holds every family's and every child's data, so the copy that leaves the
box is GPG ciphertext, and it goes to a bucket that exists only for it (see
``apps.core.backups`` for the whole design). deploy/backup-db.sh encrypts the
dump, optionally copies it to BACKUP_REMOTE itself, then streams the
ciphertext in here (the container cannot see /var/backups):

    docker compose exec -T app python manage.py offsite_backup \\
        --name db-2026-11-18-0230.sql.gz.gpg --remote none < db-2026-11-18-0230.sql.gz.gpg

When the dump could not be encrypted, nothing leaves the box and the script
only reports why:

    docker compose exec -T app python manage.py offsite_backup --failed "<motivo>" --remote none

``--remote`` is the host-side BACKUP_REMOTE copy: ``none`` (not configured),
``ok`` or ``failed``. The command records one outcome per night in the
``backup`` OpsStatus marker (``offsite``, ``offsite_at``, ``offsite_error``)
and exits non-zero when a configured destination did not get tonight's copy;
check_backup_fresh turns that into an email the next morning.

Refused, and recorded as a failure: a plaintext gzip, anything that is not an
OpenPGP message encrypted to deploy/backup-public-key.asc, a name other than
db-<date>.sql.gz.gpg, an incomplete BACKUP_S3_* configuration, and a backup
bucket that is the media bucket. There is no fallback to default_storage.
"""

import sys

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.core.backups import (
    NAME_RE,
    BackupConfigError,
    BackupRefused,
    backup_storage,
    check_ciphertext,
    check_name,
    describe_location,
    storage_configured,
)
from apps.core.models import OpsStatus

REMOTE_FAILED = "la copia a BACKUP_REMOTE falló (ver /var/log/interlaken/backup.log)"


class BackupUploadError(Exception):
    """The provider accepted the upload but the copy cannot be confirmed."""


def _short(exc: Exception) -> str:
    return f"{exc.__class__.__name__}: {exc}"[:240]


class Command(BaseCommand):
    help = "Upload an ENCRYPTED database dump (read from stdin) to the dedicated backup bucket."

    def add_arguments(self, parser):
        parser.add_argument("--name", default="", help="db-<date>.sql.gz.gpg")
        parser.add_argument(
            "--remote",
            choices=("none", "ok", "failed"),
            default="none",
            help="Outcome of backup-db.sh's own BACKUP_REMOTE copy.",
        )
        parser.add_argument(
            "--failed",
            default="",
            metavar="REASON",
            help="Record an off-site failure without uploading (e.g. the dump could not be encrypted).",
        )
        parser.add_argument(
            "--keep",
            type=int,
            default=None,
            help="Encrypted dumps to keep in the bucket (default BACKUP_S3_KEEP).",
        )

    def handle(self, *args, **o):
        remote = o["remote"]
        marker = OpsStatus.get("backup") or {}
        marker["offsite_remote"] = remote != "none"

        if o["failed"].strip():
            errors = [o["failed"].strip()[:300]]
            if remote == "failed":
                errors.append(REMOTE_FAILED)
            self._finish(marker, [], errors)
            return

        if not storage_configured() and remote == "none":
            OpsStatus.set("backup", marker)
            self.stdout.write(
                "offsite backup skipped: sin copia externa (set BACKUP_S3_* in deploy/.env; "
                "docs/DEPLOY_HOSTINGER_VPS.md, Off-site copy)"
            )
            return

        copied, errors = [], []
        if remote == "ok":
            copied.append("BACKUP_REMOTE")
        elif remote == "failed":
            errors.append(REMOTE_FAILED)
        if storage_configured():
            keep = o["keep"] if o["keep"] is not None else settings.BACKUP_S3_KEEP
            try:
                copied.append(self._upload(o["name"], max(1, keep)))
            except (BackupRefused, BackupConfigError, BackupUploadError) as exc:
                errors.append(str(exc))
            except Exception as exc:  # noqa: BLE001 (network, credentials, the provider)
                errors.append(f"no se pudo subir al almacenamiento externo ({_short(exc)})")
        self._finish(marker, copied, errors)

    def _upload(self, name: str, keep: int) -> str:
        name = check_name(name)
        data = sys.stdin.buffer.read()
        check_ciphertext(data)
        storage = backup_storage()

        key = storage.save(name, ContentFile(data, name=name))
        if key != name:
            raise BackupUploadError(f"el almacenamiento guardó {key!r} en lugar de {name!r}")
        try:
            remote_size = storage.size(key)
        except FileNotFoundError as exc:
            raise BackupUploadError("la copia no aparece en el bucket después de subirla") from exc
        if remote_size != len(data):
            raise BackupUploadError(
                f"la copia en el bucket mide {remote_size} bytes y el archivo {len(data)}"
            )
        self.stdout.write(f"offsite upload verified: {key} ({len(data) // 1024} KB)")
        self._rotate(storage, keep, key)
        return describe_location(key)

    def _rotate(self, storage, keep: int, just_uploaded: str) -> None:
        """Keep the newest ``keep`` dumps by name (names sort by date). Best effort."""
        try:
            _, files = storage.listdir("")
            dumps = sorted(f for f in files if NAME_RE.match(f))
            for old in dumps[:-keep] if len(dumps) > keep else []:
                if old != just_uploaded:
                    storage.delete(old)
                    self.stdout.write(f"rotated out {old}")
        except Exception as exc:  # noqa: BLE001 (a full bucket is not a failed backup)
            self.stderr.write(f"rotation skipped: {_short(exc)}")

    def _finish(self, marker: dict, copied: list[str], errors: list[str]) -> None:
        now = timezone.now().isoformat()
        marker["offsite_attempt_at"] = now
        if copied:
            marker["offsite"] = " + ".join(copied)
            marker["offsite_at"] = now
        if errors:
            marker["offsite_error"] = "; ".join(errors)[:500]
            marker["offsite_error_at"] = now
        else:
            marker["offsite_error"] = None
            marker["offsite_error_at"] = None
        OpsStatus.set("backup", marker)
        if errors:
            raise CommandError(f"offsite backup FAILED: {marker['offsite_error']}")
        self.stdout.write(f"offsite backup ok: {marker['offsite']}")
