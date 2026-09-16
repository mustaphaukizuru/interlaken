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
        marker = {
            'at': timezone.now().isoformat(),
            'ok': bool(o['ok']),
            'path': o['path'],
            'size': o['size'],
            'target': o['target'],
            # A failed run must not erase the last good off-site stamp.
            'offsite': o['offsite'] or (previous.get('offsite') if not o['ok'] else None),
            'offsite_at': previous.get('offsite_at') if not o['offsite'] else timezone.now().isoformat(),
        }
        if o['ok'] and not o['offsite']:
            # Successful local dump but no off-box copy yet this run: keep the
            # previous off-site info so the panel can still say when it last happened.
            marker['offsite'] = previous.get('offsite')
            marker['offsite_at'] = previous.get('offsite_at')
        OpsStatus.set('backup', marker)
        self.stdout.write(('backup recorded: ok' if o['ok'] else 'backup recorded: FAILED')
                          + (f" {o['path']} ({o['size'] // 1024} KB)" if o['path'] else ''))
