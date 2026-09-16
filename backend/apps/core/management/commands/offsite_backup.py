"""
offsite_backup — copy the nightly dump into the app's object storage.

A backup that only exists on the machine it protects is not a backup. The app
already knows how to talk to Supabase Storage (S3-compatible) for uploads, so
the dump goes there too, under backups/. The container cannot see
/var/backups, so deploy/backup-db.sh streams the file in on stdin:

    docker compose exec -T app python manage.py offsite_backup --name db-2026-09-16-0230.sql.gz < "$out"

No-op with a clear message until AWS_STORAGE_BUCKET_NAME (+ keys) are set in
.env — the console's backup light says "sin copia externa" until then.
"""
import sys

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.core.models import OpsStatus

PREFIX = 'backups/'


class Command(BaseCommand):
    help = 'Upload a database dump (read from stdin) to the configured object storage.'

    def add_arguments(self, parser):
        parser.add_argument('--name', required=True, help='File name, e.g. db-2026-09-16-0230.sql.gz')
        parser.add_argument('--keep', type=int, default=30, help='Dumps to keep in the bucket.')

    def handle(self, *args, **o):
        if not getattr(settings, 'AWS_STORAGE_BUCKET_NAME', ''):
            self.stdout.write('offsite backup skipped: no object storage configured '
                              '(set AWS_STORAGE_BUCKET_NAME + keys in .env)')
            return
        name = o['name'].strip()
        if '/' in name or not name.startswith('db-') or not name.endswith('.sql.gz'):
            raise CommandError('--name must look like db-<date>.sql.gz')

        data = sys.stdin.buffer.read()
        if len(data) < 10_000:
            raise CommandError(f'refusing to upload a {len(data)}-byte dump: that is an error page, not a database')

        key = default_storage.save(PREFIX + name, ContentFile(data))

        # Rotation: keep the newest N by name (names sort by date).
        try:
            _, files = default_storage.listdir(PREFIX)
            dumps = sorted(f for f in files if f.startswith('db-') and f.endswith('.sql.gz'))
            for old in dumps[:-o['keep']] if len(dumps) > o['keep'] else []:
                default_storage.delete(PREFIX + old)
        except Exception as exc:  # noqa: BLE001 — rotation is best-effort
            self.stderr.write(f'rotation skipped: {exc}')

        marker = OpsStatus.get('backup') or {}
        marker.update({'offsite': f'{settings.AWS_STORAGE_BUCKET_NAME}/{key}',
                       'offsite_at': timezone.now().isoformat()})
        OpsStatus.set('backup', marker)
        self.stdout.write(f'offsite backup ok: {key} ({len(data) // 1024} KB)')
