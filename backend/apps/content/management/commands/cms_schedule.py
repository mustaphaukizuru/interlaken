"""
cms_schedule: publish drafts whose publish_at has passed, unpublish pages
whose unpublish_at has passed (BACKLOG P3-11) and fan out comunicados whose
publish_at arrived (P4-4). Idempotent; run every 5 min
from cron next to the cafetería sync.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.content.pages import Page


class Command(BaseCommand):
    help = 'Apply scheduled CMS publish/unpublish times.'

    def handle(self, *args, **opts):
        now = timezone.now()
        published = unpublished = 0
        for page in Page.objects.filter(publish_at__lte=now).exclude(publish_at__isnull=True):
            page.publish(None)
            published += 1
        for page in Page.objects.filter(status=Page.Status.PUBLISHED, unpublish_at__lte=now):
            page.unpublish(None)
            page.unpublish_at = None
            page.save(update_fields=['unpublish_at'])
            unpublished += 1
        # Comunicados scheduled for later (P4-4): fan out once their time arrives.
        from apps.portal.models import Announcement
        from apps.portal.services import fanout_and_stamp
        sent = 0
        for ann in Announcement.objects.filter(is_active=True, fanout_at__isnull=True, publish_at__lte=now):
            try:
                fanout_and_stamp(ann)
                sent += 1
            except Exception:  # noqa: BLE001 - keep going, next tick retries
                continue
        self.stdout.write(f'Publicadas {published}, retiradas {unpublished}, comunicados enviados {sent}.')
