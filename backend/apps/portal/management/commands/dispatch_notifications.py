"""
dispatch_notifications — deliver email + web-push for pending notifications.

Bulk announcement fan-out only creates in-app rows (fast, one INSERT); this cron
sends the out-of-band channels (email + push) in a capped batch so a comunicado
targeted at hundreds of families actually reaches them without timing out the
publish request (which sends only a first batch of 20 itself). Scheduled every
5 minutes under its own flock (deploy/crontab.example). Safe to overlap with a
publish request or another run: each row is claimed on its own.

It also finishes the emergency broadcast's WhatsApp blast: the publish request
records one pending row per number and a thread sends them after the
response; whatever that thread could not send (worker restarted, Cloud API
error) is sent here, within a time budget that ends before the next run.
"""
from django.core.management.base import BaseCommand

from apps.portal.services import dispatch_pending_notifications, dispatch_pending_whatsapp

# Seconds of WhatsApp sends per run: the run ends before the next one (5 min).
WHATSAPP_CRON_SECONDS = 4 * 60


class Command(BaseCommand):
    help = 'Deliver email + web-push for undelivered (bulk fan-out) notifications.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=500,
                            help='Max notifications to dispatch this run (default 500).')

    def handle(self, *args, **opts):
        sent = dispatch_pending_notifications(limit=opts['limit'])
        self.stdout.write(self.style.SUCCESS(f'Dispatched {sent} notification(s).'))
        wa = dispatch_pending_whatsapp(limit=opts['limit'], time_budget=WHATSAPP_CRON_SECONDS)
        if wa:
            self.stdout.write(self.style.SUCCESS(f'Sent {wa} WhatsApp message(s).'))
