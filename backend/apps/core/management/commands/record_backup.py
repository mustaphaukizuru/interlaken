"""
record_backup — deploy/backup-db.sh reports its outcome here.

The nightly dump lives on the host; the app container cannot see
/var/backups. Without this marker a backup job that stopped running looks, from
inside the app, identical to one that works. The admin console's sync-health
panel reads the marker; check_backup_fresh raises the alarm when it goes stale.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import OpsStatus


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

    def handle(self, *args, **o):
        previous = OpsStatus.get('backup') or {}
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
        OpsStatus.set('backup', marker)
        self.stdout.write(('backup recorded: ok' if o['ok'] else 'backup recorded: FAILED')
                          + (f" {o['path']} ({o['size'] // 1024} KB)" if o['path'] else ''))
