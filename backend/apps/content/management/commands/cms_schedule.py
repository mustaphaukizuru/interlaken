"""
cms_schedule: publish drafts whose publish_at has passed, unpublish pages
whose unpublish_at has passed (BACKLOG P3-11) and fan out comunicados whose
publish_at arrived (P4-4). Idempotent; run every 5 min
from cron next to the cafetería sync.

A scheduled publish goes through the same pre-publish checks as the manual
"Publicar" (``PagePublishView``): a page with blocking errors is skipped and
logged, and keeps its ``publish_at`` so the editor shows it as overdue until
someone fixes it.

A comunicado whose fan-out fails is retried on later ticks only within
``FANOUT_RETRY_WINDOW`` of its publish time or its last edit, so a permanent
failure is not retried every 5 minutes forever. Editing or re-activating the
comunicado re-arms the retry.
"""
import datetime as dt
import logging

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from apps.content.pages import Page

logger = logging.getLogger(__name__)

FANOUT_RETRY_WINDOW = dt.timedelta(hours=24)


def blocking_issues(page: Page) -> list[dict]:
    from apps.content.checks import run_checks
    return [i for i in run_checks(page) if i['level'] == 'error']


class Command(BaseCommand):
    help = 'Apply scheduled CMS publish/unpublish times.'

    def handle(self, *args, **opts):
        now = timezone.now()
        published = unpublished = blocked = 0
        for page in Page.objects.filter(publish_at__lte=now).exclude(publish_at__isnull=True):
            errors = blocking_issues(page)
            if errors:
                blocked += 1
                logger.warning(
                    'cms_schedule: page %s (%s) not published, pre-publish checks failed: %s',
                    page.pk, page.slug, ' · '.join(e['message'] for e in errors[:5]),
                )
                continue
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
        sent = failed = 0
        cutoff = now - FANOUT_RETRY_WINDOW
        pending = (Announcement.objects
                   .filter(is_active=True, fanout_at__isnull=True, publish_at__lte=now)
                   .filter(Q(publish_at__gte=cutoff) | Q(updated_at__gte=cutoff)))
        for ann in pending:
            try:
                fanout_and_stamp(ann)
                sent += 1
            except Exception:  # noqa: BLE001 - keep going; retried while inside the window
                failed += 1
                logger.exception('cms_schedule: comunicado %s fan-out failed (retried until %s after '
                                 'its publish time or last edit)', ann.pk, FANOUT_RETRY_WINDOW)
        self.stdout.write(
            f'Publicadas {published}, bloqueadas por revisión {blocked}, retiradas {unpublished}, '
            f'comunicados enviados {sent}, fallidos {failed}.'
        )
