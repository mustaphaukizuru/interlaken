"""
cms_schedule: publish drafts whose publish_at has passed and unpublish pages
whose unpublish_at has passed (BACKLOG P3-11). Idempotent; run every 5 min
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
        self.stdout.write(f'Publicadas {published}, retiradas {unpublished}.')
