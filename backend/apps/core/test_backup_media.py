"""The uploaded files are backed up too (owner 2026-11-28).

Photos and documents uploaded through the site live in the ``media`` Docker
volume, which the nightly database dump never held: a lost server lost them.
backup-db.sh now archives the volume in the same run, encrypts it at once to
the school's key and keeps only the ciphertext; the app records it on its own
marker (``backup_media``), the off-site copy accepts it under its own name,
and the 07:45 check emails the admins when it fails or goes stale.
"""

import gzip
import io
import re
import subprocess
import tarfile
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.accounts.factories import AdminFactory
from apps.core.backups import MEDIA_MIN_BYTES, BackupRefused, check_ciphertext, check_name
from apps.core.models import OpsStatus
from apps.core.test_backup_offsite import (  # noqa: F401 (bucket_settings is a fixture)
    BASH,
    DEPLOY,
    HAS_GPG,
    FakeBucket,
    bucket_settings,
    fake_ciphertext,
    run_offsite,
)

MEDIA_NAME = "media-2026-11-28-0230.tar.gz.gpg"


@pytest.mark.django_db
class TestRecordMedia:
    def test_records_the_archive_on_its_own_marker(self):
        OpsStatus.set(
            "backup", {"ok": True, "at": "2026-11-28T08:30:00+00:00", "path": "db.sql.gz"}
        )
        call_command(
            "record_backup",
            "--media",
            "--ok",
            "--path",
            "/var/backups/interlaken/" + MEDIA_NAME,
            "--size",
            "4096",
            "--files",
            "3",
            stdout=StringIO(),
        )
        media = OpsStatus.get("backup_media")
        assert media["ok"] is True and media["files"] == 3 and media["size"] == 4096
        assert media["error"] == "" and media["at"]
        # The database marker is untouched.
        assert OpsStatus.get("backup")["path"] == "db.sql.gz"

    def test_a_failed_archive_keeps_why(self):
        call_command(
            "record_backup",
            "--media",
            "--failed",
            "--error",
            "no existe el volumen x",
            stdout=StringIO(),
        )
        media = OpsStatus.get("backup_media")
        assert media["ok"] is False and media["error"] == "no existe el volumen x"


@pytest.mark.django_db
class TestMorningCheck:
    def _run(self):
        out = StringIO()
        call_command("check_backup_fresh", stdout=out, stderr=out)
        return out.getvalue()

    def _fresh_db(self):
        OpsStatus.set("backup", {"ok": True, "at": timezone.now().isoformat()})

    def test_quiet_until_the_first_archive_reports(self):
        self._fresh_db()
        with patch("apps.portal.services.send_email") as send:
            out = self._run()
        assert "uploaded files: none recorded yet" in out
        send.assert_not_called()

    def test_a_fresh_archive_is_quiet(self):
        self._fresh_db()
        OpsStatus.set("backup_media", {"ok": True, "at": timezone.now().isoformat(), "files": 2})
        with patch("apps.portal.services.send_email") as send:
            out = self._run()
        assert "uploaded files fresh" in out and "2 files" in out
        send.assert_not_called()
        assert OpsStatus.get("backup_media_check")["stale"] is False

    def test_a_failed_archive_emails_every_admin(self):
        self._fresh_db()
        a1, a2 = AdminFactory(), AdminFactory()
        OpsStatus.set(
            "backup_media",
            {
                "ok": False,
                "at": timezone.now().isoformat(),
                "error": "no se pudo empaquetar el volumen interlaken_media",
            },
        )
        with patch("apps.portal.services.send_email", return_value=True) as send:
            out = self._run()
        assert "UPLOADED FILES BACKUP" in out
        media_mail = [c for c in send.call_args_list if "archivos subidos" in c.args[0]]
        assert media_mail and set(media_mail[0].args[2]) == {a1.email, a2.email}
        assert "no se pudo empaquetar" in media_mail[0].args[1]
        assert OpsStatus.get("backup_media_check")["stale"] is True

    def test_a_stale_archive_emails(self):
        self._fresh_db()
        AdminFactory()
        old = (timezone.now() - timedelta(hours=40)).isoformat()
        OpsStatus.set("backup_media", {"ok": True, "at": old})
        with patch("apps.portal.services.send_email", return_value=True) as send:
            self._run()
        media_mail = [c for c in send.call_args_list if "archivos subidos" in c.args[0]]
        assert media_mail and "40 horas" in media_mail[0].args[1]


class TestNamesAndSize:
    def test_media_names_are_strict_and_separate(self):
        assert check_name(MEDIA_NAME, kind="media") == MEDIA_NAME
        for bad in ("media-2026-11-28.tar.gz", "db-2026-11-28-0230.sql.gz.gpg", "media.tar.gz.gpg"):
            with pytest.raises(BackupRefused):
                check_name(bad, kind="media")
        with pytest.raises(BackupRefused):
            check_name(MEDIA_NAME)  # the database name rule never takes a media archive

    def test_a_small_archive_of_a_nearly_empty_volume_is_still_a_backup(self):
        check_ciphertext(fake_ciphertext(size=300), min_bytes=MEDIA_MIN_BYTES)
        with pytest.raises(BackupRefused):
            check_ciphertext(fake_ciphertext(size=300))  # the database floor stays 10 KB

    def test_plaintext_media_never_passes(self):
        with pytest.raises(BackupRefused):
            check_ciphertext(gzip.compress(b"x" * 5000), min_bytes=MEDIA_MIN_BYTES)


@pytest.mark.django_db
class TestOffsiteMedia:
    @pytest.mark.usefixtures("bucket_settings")
    def test_uploads_on_its_own_marker_and_rotates_only_media(self):
        old_media = [f"media-2026-10-{d:02d}-0230.tar.gz.gpg" for d in range(1, 5)]
        db_dump = "db-2026-10-01-0230.sql.gz.gpg"
        bucket = FakeBucket(existing=old_media + [db_dump])
        OpsStatus.set(
            "backup", {"ok": True, "offsite": "colegio-respaldos/db", "offsite_error": None}
        )
        data = fake_ciphertext(size=600)
        out, error, bucket = run_offsite(
            data, "--kind", "media", "--name", MEDIA_NAME, "--keep", "2", bucket=bucket
        )
        assert error is None, error
        assert bucket.objects[MEDIA_NAME] == data
        assert db_dump in bucket.objects  # rotation never touches the database dumps
        assert bucket.deleted == old_media[:3]
        media = OpsStatus.get("backup_media")
        assert media["offsite"].endswith(MEDIA_NAME) and media["offsite_error"] is None
        assert OpsStatus.get("backup")["offsite"] == "colegio-respaldos/db"  # untouched

    @pytest.mark.usefixtures("bucket_settings")
    def test_refuses_plaintext_and_records_it_on_the_media_marker(self):
        _, error, bucket = run_offsite(
            gzip.compress(b"x" * 5000), "--kind", "media", "--name", MEDIA_NAME
        )
        assert error and "SIN cifrar" in error and bucket.objects == {}
        assert "SIN cifrar" in OpsStatus.get("backup_media")["offsite_error"]
        assert not (OpsStatus.get("backup") or {}).get("offsite_error")


class TestScript:
    script = (DEPLOY / "backup-db.sh").read_text(encoding="utf-8")

    def _code(self) -> str:
        return "\n".join(
            line for line in self.script.splitlines() if not line.lstrip().startswith("#")
        )

    def test_the_volume_is_mounted_read_only_and_only_ciphertext_is_kept(self):
        code = self._code()
        assert '-v "$MEDIA_VOLUME":/m:ro' in code
        assert 'encrypt_dump "$media_plain" "$media_enc" ./backup-public-key.asc' in code
        assert 'rm -f "$media_plain"' in code
        # The plaintext archive is removed on every exit, and never copied or uploaded.
        assert '[[ -n "${media_plain:-}" ]] && rm -f "$media_plain"' in code
        assert not re.search(r'(offsite_backup|rclone|scp)[^\n]*"\$media_plain"', code)
        assert re.search(
            r'offsite_backup --kind media \\\n\s+--name "\$\(basename "\$media_enc"\)".*< "\$media_enc"',
            code,
        )
        # Only ciphertext rotates, with the same retention as the dumps.
        assert "-name 'media-*.tar.gz.gpg' -mtime \"+$KEEP_DAYS\" -delete" in code

    def test_a_media_failure_never_skips_the_database_copy_but_fails_the_run(self):
        code = self._code()
        assert code.index("backup_media()") < code.index(
            'offsite_backup \\\n       --name "$(basename "$enc")"'
        )
        assert '[[ -z "$offsite_failed" && -n "$media_ok" ]] || exit 1' in code

    def test_uses_unix_line_endings(self):
        assert "\r" not in (DEPLOY / "backup-db.sh").read_bytes().decode("utf-8")

    @pytest.mark.skipif(not BASH, reason="bash not available")
    def test_parses(self):
        result = subprocess.run(
            [BASH, "-n", (DEPLOY / "backup-db.sh").as_posix()],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, result.stderr


@pytest.mark.skipif(not HAS_GPG, reason="needs bash and gpg")
class TestEncryptArchive:
    """backup-encrypt.sh on a real media tarball, small or not."""

    def _archive(self, tmp_path, files: dict[str, bytes]):
        path = tmp_path / "media.tar.gz"
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for name, data in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        path.write_bytes(buf.getvalue())
        return path

    def _encrypt(self, tmp_path, src):
        out = tmp_path / MEDIA_NAME
        cmd = (
            f'source "{(DEPLOY / "backup-encrypt.sh").as_posix()}"; '
            f'encrypt_dump "{src.as_posix()}" "{out.as_posix()}" '
            f'"{(DEPLOY / "backup-public-key.asc").as_posix()}"'
        )
        result = subprocess.run([BASH, "-c", cmd], capture_output=True, text=True, timeout=120)
        return result, out

    @pytest.mark.parametrize("files", [{}, {"avatars/alumna.webp": b"RIFF....WEBPVP8 foto"}])
    def test_the_app_accepts_what_the_script_makes(self, tmp_path, files):
        result, out = self._encrypt(tmp_path, self._archive(tmp_path, files))
        assert result.returncode == 0, result.stdout + result.stderr
        data = out.read_bytes()
        check_ciphertext(data, min_bytes=MEDIA_MIN_BYTES)
        assert b"WEBPVP8" not in data and b"avatars" not in data
