"""The nightly backup is visible from inside the app, and its alarm can fire.

Before: the dump lived on the host where the container cannot see it, and the
morning alarm piped to `mail`, a binary the VPS does not have. Silence looked
exactly like success. Now backup-db.sh reports in (record_backup), the console
reads the marker, and check_backup_fresh alerts through the app's own email.
"""
from datetime import timedelta
from io import BytesIO, StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.accounts.factories import AdminFactory
from apps.core.models import OpsStatus


@pytest.mark.django_db
class TestRecordBackup:
    def test_records_a_good_run(self):
        call_command('record_backup', '--ok', '--path', '/var/backups/interlaken/db-x.sql.gz',
                     '--size', '257355', '--target', 'external (supabase)')
        m = OpsStatus.get('backup')
        assert m['ok'] is True and m['size'] == 257355 and m['target'] == 'external (supabase)'
        assert m['at']

    def test_a_failed_run_keeps_the_last_offsite_stamp(self):
        OpsStatus.set('backup', {'ok': True, 'at': '2026-09-15T02:30:00+00:00',
                                 'offsite': 'bucket/backups/db-old.sql.gz', 'offsite_at': '2026-09-15T02:31:00+00:00'})
        call_command('record_backup', '--failed', '--target', 'external')
        m = OpsStatus.get('backup')
        assert m['ok'] is False
        assert m['offsite'] == 'bucket/backups/db-old.sql.gz'


@pytest.mark.django_db
class TestCheckBackupFresh:
    def _run(self, *args):
        out = StringIO()
        call_command('check_backup_fresh', *args, stdout=out, stderr=out)
        return out.getvalue()

    def test_fresh_backup_is_quiet(self):
        OpsStatus.set('backup', {'ok': True, 'at': timezone.now().isoformat()})
        with patch('apps.portal.services.send_email') as send:
            out = self._run()
        assert 'backup fresh' in out
        send.assert_not_called()
        assert OpsStatus.get('backup_check')['stale'] is False

    def test_stale_backup_emails_every_active_admin(self):
        OpsStatus.set('backup', {'ok': True, 'at': (timezone.now() - timedelta(hours=40)).isoformat()})
        a1, a2 = AdminFactory(), AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            out = self._run()
        assert 'BACKUP STALE' in out
        recipients = send.call_args.args[2]
        assert set(recipients) == {a1.email, a2.email}
        assert 'atrasado' in send.call_args.args[0]
        assert OpsStatus.get('backup_check')['stale'] is True

    def test_never_recorded_counts_as_stale(self):
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            out = self._run()
        assert 'ever been recorded' in out
        send.assert_called_once()

    def test_a_failed_last_run_is_named_in_the_alert(self):
        OpsStatus.set('backup', {'ok': False, 'at': timezone.now().isoformat()})
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            self._run()
        assert 'FAILED' in send.call_args.args[1]

    def test_no_email_flag_only_updates_the_marker(self):
        AdminFactory()
        with patch('apps.portal.services.send_email') as send:
            self._run('--no-email')
        send.assert_not_called()
        assert OpsStatus.get('backup_check')['stale'] is True


@pytest.mark.django_db
class TestOffsiteBackup:
    def test_is_a_clear_no_op_without_object_storage(self, settings):
        settings.AWS_STORAGE_BUCKET_NAME = ''
        out = StringIO()
        with patch('sys.stdin') as stdin:
            stdin.buffer = BytesIO(b'x' * 20_000)
            call_command('offsite_backup', '--name', 'db-2026-09-16-0230.sql.gz', stdout=out)
        assert 'skipped' in out.getvalue()
        assert OpsStatus.get('backup') is None

    def test_refuses_a_dump_that_is_really_an_error_page(self, settings):
        settings.AWS_STORAGE_BUCKET_NAME = 'bucket'
        with patch('sys.stdin') as stdin:
            stdin.buffer = BytesIO(b'<html>502</html>')
            with pytest.raises(CommandError, match='error page'):
                call_command('offsite_backup', '--name', 'db-2026-09-16-0230.sql.gz')

    def test_rejects_a_name_that_could_escape_the_prefix(self, settings):
        settings.AWS_STORAGE_BUCKET_NAME = 'bucket'
        with patch('sys.stdin') as stdin:
            stdin.buffer = BytesIO(b'x' * 20_000)
            with pytest.raises(CommandError):
                call_command('offsite_backup', '--name', '../etc/passwd')

    def test_uploads_and_stamps_the_marker(self, settings):
        settings.AWS_STORAGE_BUCKET_NAME = 'bucket'
        OpsStatus.set('backup', {'ok': True, 'at': timezone.now().isoformat()})
        saved = {}

        class FakeStorage:
            def save(self, name, content):
                saved['name'] = name; saved['size'] = len(content.read()); return name
            def listdir(self, prefix):
                return [], ['db-2026-09-01-0230.sql.gz', 'db-2026-09-16-0230.sql.gz']
            def delete(self, name):
                saved.setdefault('deleted', []).append(name)

        out = StringIO()
        with patch('apps.core.management.commands.offsite_backup.default_storage', FakeStorage()), \
             patch('sys.stdin') as stdin:
            stdin.buffer = BytesIO(b'x' * 20_000)
            call_command('offsite_backup', '--name', 'db-2026-09-16-0230.sql.gz', '--keep', '1', stdout=out)

        assert saved['name'] == 'backups/db-2026-09-16-0230.sql.gz' and saved['size'] == 20_000
        assert saved['deleted'] == ['backups/db-2026-09-01-0230.sql.gz']   # rotation keeps the newest
        m = OpsStatus.get('backup')
        assert m['offsite'] == 'bucket/backups/db-2026-09-16-0230.sql.gz' and m['offsite_at']
        assert 'offsite backup ok' in out.getvalue()
