"""
record_backup — deploy/backup-db.sh reports its outcome here.

The nightly dump lives on the host; the app container cannot see
/var/backups. Without this marker a backup job that stopped running looks, from
inside the app, identical to one that works. The admin console's sync-health
panel reads the marker; check_backup_fresh raises the alarm when it goes stale.

``--media`` records the uploaded-files archive of the same run (the media
volume, encrypted at once) on its own marker, ``backup_media`` (owner
2026-11-28: uploads were in no backup at all).
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import OpsStatus

MEDIA_KEY = 'backup_media'


class Command(BaseCommand):
    help = 'Record the outcome of the nightly database backup (called by deploy/backup-db.sh).'

    def add_arguments(self, parser):
        g = parser.add_mutually_exclusive_group(required=True)
        g.add_argument('--ok', action='store_true')
        g.add_argument('--failed', action='store_true')
        parser.add_argument('--path', default='')
        parser.add_argument('--size', type=int, default=0)
        parser.add_argument('--target', default='')
        parser.add_argument('--offsite', default='', help='Where the off-box copy went, if any.')
        parser.add_argument('--media', action='store_true',
                            help='The uploaded-files archive, not the database dump.')
        parser.add_argument('--files', type=int, default=0, help='Files in the media archive.')
        parser.add_argument('--error', default='', help='Why the media archive failed.')

    def handle(self, *args, **o):
        key = MEDIA_KEY if o['media'] else 'backup'
        previous = OpsStatus.get(key) or {}
        # The off-site fields belong to offsite_backup, which runs right after
        # this: carry them over untouched (a local run, good or failed, must not
        # erase when the last off-site copy happened or why the last one failed).
        marker = {k: v for k, v in previous.items() if k.startswith('offsite')}
        marker.update({
            'at': timezone.now().isoformat(),
            'ok': bool(o['ok']),
            'path': o['path'],
            'size': o['size'],
            'target': o['target'],
        })
        if o['offsite']:
            marker['offsite'] = o['offsite']
            marker['offsite_at'] = timezone.now().isoformat()
        marker.setdefault('offsite', None)
        marker.setdefault('offsite_at', None)
        if o['media']:
            marker['files'] = o['files']
            marker['error'] = '' if o['ok'] else (o['error'] or 'falló sin motivo registrado')[:300]
        OpsStatus.set(key, marker)
        what = 'uploaded files' if o['media'] else 'backup'
        self.stdout.write((f'{what} recorded: ok' if o['ok'] else f'{what} recorded: FAILED')
                          + (f" {o['path']} ({o['size'] // 1024} KB)" if o['path'] else ''))
