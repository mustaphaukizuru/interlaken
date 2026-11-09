"""
dispatch_notifications — deliver email + web-push for pending notifications.

Bulk announcement fan-out only creates in-app rows (fast, one INSERT); this cron
sends the out-of-band channels (email + push) in a capped batch so a comunicado
targeted at hundreds of families actually reaches them without timing out the
publish request (which sends only a first batch of 20 itself). Scheduled every
5 minutes under its own flock (deploy/crontab.example). Safe to overlap with a
publish request or another run: each row is claimed on its own.
"""
from django.core.management.base import BaseCommand

from apps.portal.services import dispatch_pending_notifications


class Command(BaseCommand):
    help = 'Deliver email + web-push for undelivered (bulk fan-out) notifications.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=500,
                            help='Max notifications to dispatch this run (default 500).')

    def handle(self, *args, **opts):
        sent = dispatch_pending_notifications(limit=opts['limit'])
        self.stdout.write(self.style.SUCCESS(f'Dispatched {sent} notification(s).'))
