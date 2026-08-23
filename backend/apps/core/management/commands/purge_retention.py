"""
purge_retention: apply the data retention policy (BACKLOG P5-4, docs/RETENTION.md).

Dry-run by default: prints what would be purged. `--apply` executes. Wire to
cron weekly with --apply; `report_retention` remains the human-review report
for the records this job deliberately never touches.
"""
from django.core.management.base import BaseCommand

from apps.core.retention import run, windows


class Command(BaseCommand):
    help = 'Purge/anonymise operational data past its retention window (dry-run unless --apply).'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **opts):
        counts = run(apply=opts['apply'])
        mode = 'APLICADO' if opts['apply'] else 'SIMULACIÓN (use --apply para ejecutar)'
        self.stdout.write(self.style.WARNING(f'Retención {mode}; ventanas (días): {windows()}'))
        for k, v in counts.items():
            self.stdout.write(f'  {k}: {v}')
