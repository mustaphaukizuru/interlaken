"""The off-site backup copy is encrypted and private by construction.

Before 2026-11-18, ``offsite_backup`` uploaded the PLAINTEXT dump through
``default_storage``: setting ``AWS_STORAGE_BUCKET_NAME`` for the media library
would have put every family's and child's data, unencrypted, in a bucket the
site serves, at a guessable key. These tests pin the replacement:

* only GPG ciphertext for the school's key is accepted (never gzip, never
  another key, never an error page), under a strict name;
* it goes only to the dedicated BACKUP_S3_* bucket, built without a single
  AWS_* (media) value, never to default_storage;
* the upload is verified before it counts, old copies rotate, the outcome
  lands in the console marker, and check_backup_fresh alarms (deduped) when a
  configured copy is old or failed;
* deploy/backup-db.sh only ever sends the encrypted file off the box, and the
  key it encrypts to is the one this module expects.
"""

import base64
import gzip
import hashlib
import os
import re
import shutil
import subprocess
from datetime import timedelta
from io import BytesIO, StringIO
from pathlib import Path
from unittest.mock import patch

import pytest
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.accounts.factories import AdminFactory
from apps.core import backups
from apps.core.backups import (
    BACKUP_KEY_FINGERPRINT,
    BACKUP_KEY_IDS,
    BackupConfigError,
    BackupRefused,
    check_ciphertext,
    pkesk_key_ids,
)
from apps.core.models import OpsStatus

DEPLOY = Path(__file__).resolve().parents[3] / "deploy"
NAME = "db-2026-11-18-0230.sql.gz.gpg"
SCHOOL_KEY_ID = next(iter(BACKUP_KEY_IDS))


def _find_bash() -> str | None:
    """A POSIX bash by full path. On Windows a bare "bash" resolves to WSL's
    System32 launcher, which cannot see these paths: use Git for Windows' bash."""
    if os.name == "nt":
        found = shutil.which("bash")
        if found and "system32" not in found.lower() and "windowsapps" not in found.lower():
            return found
        git_bash = (
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "bin" / "bash.exe"
        )
        return str(git_bash) if git_bash.exists() else None
    return shutil.which("bash")


BASH = _find_bash()
HAS_GPG = bool(
    BASH
    and subprocess.run([BASH, "-c", "command -v gpg"], capture_output=True, timeout=30).returncode
    == 0
)


def fake_ciphertext(key_id: str = SCHOOL_KEY_ID, size: int = 20_000) -> bytes:
    """A structurally valid gpg --encrypt output: PKESK (old header) + SEIPD (new header)."""
    pkesk = bytes([3]) + bytes.fromhex(key_id) + bytes([18]) + os.urandom(80)
    seipd = b"\x01" + os.urandom(size)
    return (
        bytes([0x84, len(pkesk)])
        + pkesk
        + bytes([0xD2, 0xFF])
        + len(seipd).to_bytes(4, "big")
        + seipd
    )


class FakeBucket:
    """Stands in for BackupS3Storage: records what was written and deleted."""

    instances: list["FakeBucket"] = []

    def __init__(self, existing=(), size_delta=0, lose_upload=False, fail_save=None):
        self.objects = {name: b"old" for name in existing}
        self.size_delta = size_delta
        self.lose_upload = lose_upload
        self.fail_save = fail_save
        self.deleted: list[str] = []
        FakeBucket.instances.append(self)

    def save(self, name, content):
        if self.fail_save:
            raise self.fail_save
        data = content.read()
        if not self.lose_upload:
            self.objects[name] = data
        return name

    def size(self, name):
        if name not in self.objects:
            raise FileNotFoundError(name)
        return len(self.objects[name]) + self.size_delta

    def listdir(self, path):
        return [], sorted(self.objects)

    def delete(self, name):
        self.deleted.append(name)
        self.objects.pop(name, None)


@pytest.fixture
def bucket_settings(settings):
    settings.BACKUP_S3_BUCKET = "colegio-respaldos"
    settings.BACKUP_S3_ENDPOINT_URL = "https://example-account.r2.cloudflarestorage.com"
    settings.BACKUP_S3_ACCESS_KEY_ID = "backup-key-id"
    settings.BACKUP_S3_SECRET_ACCESS_KEY = "backup-secret"
    settings.BACKUP_S3_REGION = "auto"
    settings.BACKUP_S3_PREFIX = "interlaken-db"
    settings.BACKUP_S3_KEEP = 30
    return settings


def run_offsite(data: bytes | None, *args, bucket: FakeBucket | None = None):
    """Run offsite_backup with ``data`` on stdin and ``bucket`` as the backup storage."""
    out, err = StringIO(), StringIO()
    bucket = bucket if bucket is not None else FakeBucket()
    with (
        patch("apps.core.backup_storage.BackupS3Storage", return_value=bucket),
        patch("sys.stdin") as stdin,
    ):
        stdin.buffer = BytesIO(data or b"")
        try:
            call_command("offsite_backup", *args, stdout=out, stderr=err)
            error = None
        except CommandError as exc:
            error = str(exc)
    return out.getvalue(), error, bucket


# ── what may leave the server ─────────────────────────────
class TestCiphertextCheck:
    def test_accepts_a_message_for_the_school_key(self):
        data = fake_ciphertext()
        check_ciphertext(data)
        assert pkesk_key_ids(data) == [SCHOOL_KEY_ID]

    def test_refuses_the_plaintext_gzip_dump(self):
        with pytest.raises(BackupRefused, match="SIN cifrar"):
            check_ciphertext(gzip.compress(b"CREATE TABLE accounts_user (id int);\n" * 2000))

    @pytest.mark.parametrize(
        "data",
        [
            b"-- PostgreSQL database dump\n" * 1000,
            b"-----BEGIN PGP MESSAGE-----\n" + b"A" * 20_000,
            b"\x10" * 20_000,
            bytes([0x89, 0x01, 0x00]) + b"\x00" * 20_000,  # an OpenPGP signature, not a message
        ],
        ids=["sql", "armored", "binary-junk", "signature-packet"],
    )
    def test_refuses_anything_that_is_not_gpg(self, data):
        with pytest.raises(BackupRefused, match="no es un mensaje GPG"):
            check_ciphertext(data)

    def test_refuses_a_message_for_another_key(self):
        with pytest.raises(BackupRefused, match="otra llave"):
            check_ciphertext(fake_ciphertext(key_id="0123456789ABCDEF"))

    def test_refuses_an_error_page_sized_file(self):
        with pytest.raises(BackupRefused, match="bytes"):
            check_ciphertext(fake_ciphertext(size=200))

    @pytest.mark.parametrize(
        "name",
        [
            "db-2026-11-18-0230.sql.gz",
            "../db-2026-11-18-0230.sql.gz.gpg",
            "x/" + NAME,
            "media.gpg",
            "",
        ],
    )
    def test_names_are_strict(self, name):
        with pytest.raises(BackupRefused, match="nombre no válido"):
            backups.check_name(name)


# ── the dedicated storage ─────────────────────────────────
class TestBackupStorageIsDedicated:
    def test_built_only_from_backup_settings_never_from_the_media_ones(self, bucket_settings):
        s = bucket_settings
        s.AWS_STORAGE_BUCKET_NAME = "media-publico"
        s.AWS_ACCESS_KEY_ID = "media-key"
        s.AWS_SECRET_ACCESS_KEY = "media-secret"
        s.AWS_S3_ENDPOINT_URL = "https://media.example.com"
        s.AWS_LOCATION = "public"
        s.AWS_S3_CUSTOM_DOMAIN = "cdn.example.com"
        s.AWS_DEFAULT_ACL = "public-read"
        s.AWS_QUERYSTRING_AUTH = False

        storage = backups.backup_storage()

        assert storage.bucket_name == "colegio-respaldos"
        assert (storage.access_key, storage.secret_key) == ("backup-key-id", "backup-secret")
        assert storage.endpoint_url == "https://example-account.r2.cloudflarestorage.com"
        assert storage.region_name == "auto"
        assert storage.location == "interlaken-db"
        assert storage.default_acl is None  # no public-read leaking in from the media bucket
        assert storage.custom_domain is None
        assert storage.querystring_auth is True
        assert storage.security_token is None and storage.session_profile is None
        with pytest.raises(NotImplementedError):
            storage.url(NAME)

    def test_not_configured(self, settings):
        with pytest.raises(BackupConfigError, match="BACKUP_S3_BUCKET"):
            backups.backup_storage()

    @pytest.mark.parametrize("missing", ["BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"])
    def test_incomplete_keys_are_refused_not_borrowed_from_the_environment(
        self, bucket_settings, missing
    ):
        setattr(bucket_settings, missing, "")
        with pytest.raises(BackupConfigError, match=missing):
            backups.backup_storage()

    def test_the_media_bucket_is_never_a_backup_bucket(self, bucket_settings):
        bucket_settings.AWS_STORAGE_BUCKET_NAME = "colegio-respaldos"
        with pytest.raises(BackupConfigError, match="mismo bucket"):
            backups.backup_storage()


# ── the command ───────────────────────────────────────────
@pytest.mark.django_db
class TestOffsiteBackupCommand:
    def test_media_storage_alone_is_not_an_offsite_copy(self, settings):
        """The 2026-11-18 bug: with only the media bucket set, nothing is uploaded anywhere."""
        settings.AWS_STORAGE_BUCKET_NAME = "media-bucket"
        OpsStatus.set("backup", {"ok": True, "at": timezone.now().isoformat()})
        with patch.object(default_storage, "save") as media_save:
            out, error, bucket = run_offsite(fake_ciphertext(), "--name", NAME)
        assert error is None and "sin copia externa" in out
        media_save.assert_not_called()
        assert bucket.objects == {}
        marker = OpsStatus.get("backup")
        assert not marker.get("offsite") and marker["offsite_remote"] is False
        assert backups.offsite_configured(marker) is False

    def test_uploads_verifies_rotates_and_stamps(self, bucket_settings):
        old = [f"db-2026-10-{d:02d}-0230.sql.gz.gpg" for d in range(1, 6)]
        bucket = FakeBucket(existing=old + ["notes.txt"])
        OpsStatus.set("backup", {"ok": True, "at": timezone.now().isoformat()})
        data = fake_ciphertext()

        out, error, bucket = run_offsite(data, "--name", NAME, "--keep", "3", bucket=bucket)

        assert error is None, error
        assert bucket.objects[NAME] == data
        assert bucket.deleted == old[:3]  # newest 3 by name stay: 10-04, 10-05 and tonight
        assert "notes.txt" in bucket.objects  # rotation only touches dumps
        assert "offsite upload verified" in out
        marker = OpsStatus.get("backup")
        assert marker["offsite"] == f"colegio-respaldos/interlaken-db/{NAME}"
        assert marker["offsite_at"] and marker["offsite_error"] is None
        assert marker["ok"] is True  # the local fields are untouched

    def test_refuses_the_plaintext_dump_and_records_why(self, bucket_settings):
        out, error, bucket = run_offsite(gzip.compress(b"x" * 50_000), "--name", NAME)
        assert error and "SIN cifrar" in error
        assert bucket.objects == {}
        marker = OpsStatus.get("backup")
        assert "SIN cifrar" in marker["offsite_error"] and not marker.get("offsite_at")

    def test_refuses_a_non_gpg_file(self, bucket_settings):
        _, error, bucket = run_offsite(b"<html>502 Bad Gateway</html>" * 500, "--name", NAME)
        assert error and "no es un mensaje GPG" in error
        assert bucket.objects == {}

    def test_refuses_the_old_plaintext_name(self, bucket_settings):
        _, error, bucket = run_offsite(fake_ciphertext(), "--name", "db-2026-11-18-0230.sql.gz")
        assert error and "nombre no válido" in error
        assert bucket.objects == {}

    def test_refuses_when_backup_bucket_is_the_media_bucket(self, bucket_settings):
        bucket_settings.AWS_STORAGE_BUCKET_NAME = "colegio-respaldos"
        _, error, bucket = run_offsite(fake_ciphertext(), "--name", NAME)
        assert error and "mismo bucket" in error
        assert bucket.objects == {}

    def test_a_size_mismatch_is_not_a_backup(self, bucket_settings):
        _, error, _ = run_offsite(
            fake_ciphertext(), "--name", NAME, bucket=FakeBucket(size_delta=-1)
        )
        assert error and "mide" in error
        assert not OpsStatus.get("backup").get("offsite_at")

    def test_an_upload_that_does_not_appear_is_not_a_backup(self, bucket_settings):
        _, error, _ = run_offsite(
            fake_ciphertext(), "--name", NAME, bucket=FakeBucket(lose_upload=True)
        )
        assert error and "no aparece" in error

    def test_a_provider_error_is_recorded(self, bucket_settings):
        boom = RuntimeError("AccessDenied when calling the PutObject operation")
        _, error, _ = run_offsite(
            fake_ciphertext(), "--name", NAME, bucket=FakeBucket(fail_save=boom)
        )
        assert error and "AccessDenied" in error
        assert "AccessDenied" in OpsStatus.get("backup")["offsite_error"]

    def test_a_later_success_clears_the_error_and_keeps_the_local_marker(self, bucket_settings):
        OpsStatus.set(
            "backup",
            {
                "ok": True,
                "at": "2026-11-18T02:30:00-06:00",
                "size": 99,
                "offsite_error": "antes falló",
                "offsite_error_at": "x",
            },
        )
        _, error, _ = run_offsite(fake_ciphertext(), "--name", NAME)
        assert error is None
        marker = OpsStatus.get("backup")
        assert marker["offsite_error"] is None and marker["size"] == 99

    def test_failed_records_without_reading_stdin(self, bucket_settings):
        _, error, bucket = run_offsite(
            None, "--failed", "no se pudo cifrar el respaldo: gpg no está instalado"
        )
        assert error and "gpg no está instalado" in error
        assert bucket.objects == {}
        assert "gpg" in OpsStatus.get("backup")["offsite_error"]

    def test_backup_remote_only(self, settings):
        """BACKUP_REMOTE copied on the host and no bucket: a real off-site copy, reported in."""
        out, error, _ = run_offsite(None, "--name", NAME, "--remote", "ok")
        assert error is None
        marker = OpsStatus.get("backup")
        assert marker["offsite"] == "BACKUP_REMOTE" and marker["offsite_remote"] is True
        assert backups.offsite_configured(marker) is True

    def test_backup_remote_failed_but_bucket_ok(self, bucket_settings):
        _, error, bucket = run_offsite(fake_ciphertext(), "--name", NAME, "--remote", "failed")
        assert error and "BACKUP_REMOTE" in error
        marker = OpsStatus.get("backup")
        assert NAME in bucket.objects and marker["offsite_at"]  # tonight's copy exists...
        assert "BACKUP_REMOTE" in marker["offsite_error"]  # ...but the failure still alarms

    def test_record_backup_keeps_the_offsite_fields(self, bucket_settings):
        run_offsite(fake_ciphertext(), "--name", NAME, "--remote", "failed")
        before = OpsStatus.get("backup")
        call_command(
            "record_backup",
            "--ok",
            "--path",
            "/var/backups/interlaken/x.sql.gz",
            "--size",
            "123456",
            stdout=StringIO(),
        )
        after = OpsStatus.get("backup")
        for key in ("offsite", "offsite_at", "offsite_error", "offsite_error_at", "offsite_remote"):
            assert after[key] == before[key], key
        assert after["size"] == 123456


# ── the morning alarm ─────────────────────────────────────
@pytest.mark.django_db
class TestCheckBackupFreshOffsite:
    def _run(self, *args):
        out = StringIO()
        with patch("apps.portal.services.send_email", return_value=True) as send:
            call_command("check_backup_fresh", *args, stdout=out, stderr=out)
        offsite_mails = [c for c in send.call_args_list if "copia externa" in c.args[0]]
        return out.getvalue(), offsite_mails

    def _marker(self, **offsite):
        OpsStatus.set("backup", {"ok": True, "at": timezone.now().isoformat(), **offsite})

    def test_not_configured_stays_quiet(self):
        AdminFactory()
        self._marker()
        out, mails = self._run()
        assert "sin copia externa" in out and mails == []
        assert OpsStatus.get("backup_offsite_check")["configured"] is False

    def test_fresh_copy_is_quiet(self, bucket_settings):
        AdminFactory()
        self._marker(offsite="b/k", offsite_at=timezone.now().isoformat())
        out, mails = self._run()
        assert "off-site copy fresh" in out and mails == []

    def test_configured_but_never_copied_alerts_once(self, bucket_settings):
        a1, a2 = AdminFactory(), AdminFactory()
        self._marker()
        _, mails = self._run()
        assert len(mails) == 1 and set(mails[0].args[2]) == {a1.email, a2.email}
        assert "ninguna copia externa" in mails[0].args[1]
        _, again = self._run()
        assert again == []  # same problem: no daily repeat (weekly at most)

    def test_old_copy_alerts(self, bucket_settings):
        AdminFactory()
        self._marker(offsite="b/k", offsite_at=(timezone.now() - timedelta(hours=30)).isoformat())
        out, mails = self._run()
        assert "OFF-SITE COPY" in out and len(mails) == 1
        assert "30 h" in mails[0].args[1]
        assert OpsStatus.get("backup_offsite_check")["stale"] is True

    def test_a_failed_attempt_alerts_even_when_the_copy_is_recent(self, bucket_settings):
        AdminFactory()
        self._marker(
            offsite="b/k",
            offsite_at=timezone.now().isoformat(),
            offsite_error="no se pudo subir (AccessDenied)",
        )
        _, mails = self._run()
        assert len(mails) == 1 and "AccessDenied" in mails[0].args[1]

    def test_a_new_problem_alerts_again(self, bucket_settings):
        AdminFactory()
        self._marker(offsite="b/k", offsite_at=(timezone.now() - timedelta(hours=30)).isoformat())
        self._run()
        self._marker(
            offsite="b/k", offsite_at=timezone.now().isoformat(), offsite_error="otra falla"
        )
        _, mails = self._run()
        assert len(mails) == 1

    def test_recovery_clears_the_alert(self, bucket_settings):
        AdminFactory()
        self._marker()
        self._run()
        assert OpsStatus.get("backup_offsite_alert")
        self._marker(offsite="b/k", offsite_at=timezone.now().isoformat())
        self._run()
        assert OpsStatus.get("backup_offsite_alert") == {}

    def test_backup_remote_counts_as_configured(self):
        AdminFactory()
        self._marker(offsite_remote=True)
        _, mails = self._run()
        assert len(mails) == 1

    def test_no_email_only_sets_the_marker(self, bucket_settings):
        AdminFactory()
        self._marker()
        _, mails = self._run("--no-email")
        assert mails == [] and OpsStatus.get("backup_offsite_check")["stale"] is True


# ── the key and the script agree ──────────────────────────
def _armored_packets(path: Path) -> bytes:
    lines = path.read_text(encoding="ascii").splitlines()
    start = lines.index("-----BEGIN PGP PUBLIC KEY BLOCK-----") + 1
    end = lines.index("-----END PGP PUBLIC KEY BLOCK-----")
    body = lines[start:end]
    if "" in body:  # armor headers end at the first blank line
        body = body[body.index("") + 1 :]
    return base64.b64decode("".join(line for line in body if not line.startswith("=")))


def _v4_fingerprint(body: bytes) -> str:
    return hashlib.sha1(b"\x99" + len(body).to_bytes(2, "big") + body).hexdigest().upper()


class TestKeyPinning:
    def test_the_repo_key_is_the_key_the_app_and_the_script_expect(self):
        packets = list(
            backups._packets(_armored_packets(DEPLOY / "backup-public-key.asc"), limit=50)
        )
        primary = next(body for tag, body in packets if tag == 6)
        subkeys = [_v4_fingerprint(body)[-16:] for tag, body in packets if tag == 14]
        assert _v4_fingerprint(primary) == BACKUP_KEY_FINGERPRINT
        assert BACKUP_KEY_IDS <= set(subkeys)
        script = (DEPLOY / "backup-encrypt.sh").read_text(encoding="utf-8")
        assert f'BACKUP_KEY_FINGERPRINT="{BACKUP_KEY_FINGERPRINT}"' in script


# ── deploy/backup-db.sh ───────────────────────────────────
class TestBackupScript:
    script = (DEPLOY / "backup-db.sh").read_text(encoding="utf-8")

    def _code(self) -> str:
        return "\n".join(
            line for line in self.script.splitlines() if not line.lstrip().startswith("#")
        )

    def test_only_the_ciphertext_leaves_the_box(self):
        code = self._code()
        assert "source ./backup-encrypt.sh" in code
        assert 'enc="$out.gpg"' in code
        assert re.search(r'offsite_backup \\\n\s+--name "\$\(basename "\$enc"\)".*< "\$enc"', code)
        assert 'rclone copy "$enc"' in code and 'scp -q "$enc"' in code
        # Nothing reads the plaintext dump into a copy command or the app.
        assert not re.search(r'(offsite_backup|rclone|scp)[^\n]*"\$out"', code)
        assert '< "$out"' not in code
        assert "AWS_STORAGE_BUCKET_NAME" not in code

    def test_encryption_failure_uploads_nothing(self):
        code = self._code()
        block = code[code.index("if ! why=$(encrypt_dump") :]
        block = block[: block.index("\nfi\n")]
        assert "--failed" in block and "exit 1" in block
        assert "rclone" not in block and "--name" not in block

    def test_dumps_are_private_to_the_backup_user(self):
        assert "\numask 077\n" in self.script

    @pytest.mark.skipif(not BASH, reason="bash not available")
    @pytest.mark.parametrize("name", ["backup-db.sh", "restore-db.sh", "backup-encrypt.sh"])
    def test_scripts_parse(self, name):
        result = subprocess.run(
            [BASH, "-n", (DEPLOY / name).as_posix()], capture_output=True, text=True, timeout=60
        )
        assert result.returncode == 0, result.stderr


@pytest.mark.skipif(not HAS_GPG, reason="needs bash and gpg")
class TestEncryptDump:
    """backup-encrypt.sh for real: the same gpg the VPS runs, no secret key anywhere."""

    def _encrypt(self, tmp_path, *, key=None, prelude=""):
        dump = tmp_path / "db-2026-11-18-0230.sql.gz"
        rows = (
            f"INSERT INTO accounts_user VALUES ({i}, 'Alumna Prueba', '{os.urandom(16).hex()}');\n"
            for i in range(2000)
        )
        dump.write_bytes(gzip.compress("".join(rows).encode()))
        out = tmp_path / NAME
        key = key or (DEPLOY / "backup-public-key.asc").as_posix()
        cmd = (
            f'source "{(DEPLOY / "backup-encrypt.sh").as_posix()}"; {prelude}'
            f'encrypt_dump "{dump.as_posix()}" "{out.as_posix()}" "{key}"'
        )
        result = subprocess.run([BASH, "-c", cmd], capture_output=True, text=True, timeout=120)
        return result, out

    def test_output_is_ciphertext_the_app_accepts(self, tmp_path):
        result, out = self._encrypt(tmp_path)
        assert result.returncode == 0, result.stdout + result.stderr
        data = out.read_bytes()
        assert data[:2] != b"\x1f\x8b"
        check_ciphertext(data)  # the app takes exactly what the script produces
        assert b"Alumna Prueba" not in data

    def test_a_key_that_is_not_the_school_key_is_refused(self, tmp_path):
        result, out = self._encrypt(tmp_path, prelude="BACKUP_KEY_FINGERPRINT=0000; ")
        assert result.returncode == 1 and "no es la del colegio" in result.stdout
        assert not out.exists()

    def test_a_missing_key_is_refused(self, tmp_path):
        result, out = self._encrypt(tmp_path, key=(tmp_path / "missing.asc").as_posix())
        assert result.returncode == 1 and "falta la llave" in result.stdout
        assert not out.exists()
