"""
cms_schedule: publish drafts whose publish_at has passed, unpublish pages
whose unpublish_at has passed (BACKLOG P3-11) and fan out comunicados whose
publish_at arrived (P4-4). Idempotent; run every 5 min
from cron next to the cafetería sync.

A scheduled publish goes through the same «Revisión antes de publicar» as the
manual "Publicar" (``publish_checks.review``): a page with an error, or with a
warning that is almost always a slip (``publish_checks.SCHEDULE_BLOCKING``: a
token glued to text, a label holding only tokens, an emptied text, a retired
default), is not published. It keeps its ``publish_at`` so the editor shows it
as overdue, and Dirección gets a notice (bell and e-mail, once a week at most
for the same problems). A draft still in the old generic format
(``legacy_seed``) is never published on a schedule: it would replace the
designed page, which needs an explicit confirmation in the editor
(docs/cms/safe-publish.md).

Every run also checks the published pages as families see them
(``publish_checks.audit_live_pages``): a deploy that makes a route private, a
deleted image or a removed redirect reaches Dirección's bell within minutes.

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

from apps.content.pages import Page, is_legacy_seed, legacy_seed_detail
from apps.content.publish_checks import notify_schedule_blocked, review, schedule_blockers

logger = logging.getLogger(__name__)

FANOUT_RETRY_WINDOW = dt.timedelta(hours=24)


def blocking_issues(page: Page) -> list[dict]:
    """What stops a scheduled publication of ``page`` (empty list: it may go live)."""
    return schedule_blockers(review(page))


class Command(BaseCommand):
    help = 'Apply scheduled CMS publish/unpublish times.'

    def handle(self, *args, **opts):
        now = timezone.now()
        published = unpublished = blocked = 0
        for page in Page.objects.select_related('published_version').filter(publish_at__lte=now).exclude(publish_at__isnull=True):
            if is_legacy_seed(page):
                blocked += 1
                logger.warning(
                    'cms_schedule: page %s (%s) not published: its draft is the old generic seed format '
                    'and would replace the designed page; publish it from the editor to confirm.',
                    page.pk, page.slug,
                )
                notify_schedule_blocked(page, [{'message': legacy_seed_detail(page)}])
                continue
            report = review(page)
            errors = schedule_blockers(report)
            if errors:
                blocked += 1
                logger.warning(
                    'cms_schedule: page %s (%s) not published, pre-publish checks failed: %s',
                    page.pk, page.slug, ' · '.join(e['message'] for e in errors[:5]),
                )
                notify_schedule_blocked(page, errors)
                continue
            # The advisory warnings left (SEO lengths, a large change) go to the audit trail.
            page.publish(None, acknowledged=[w['key'] for w in report['warnings']])
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
        # Published pages as families see them: Dirección hears about a broken one.
        try:
            from apps.content.publish_checks import audit_live_pages
            with_problems = len(audit_live_pages())
        except Exception:  # noqa: BLE001 - the audit never stops the schedule
            with_problems = 0
            logger.exception('cms_schedule: audit of the published pages failed')
        self.stdout.write(
            f'Publicadas {published}, bloqueadas por revisión {blocked}, retiradas {unpublished}, '
            f'comunicados enviados {sent}, fallidos {failed}, páginas publicadas con problemas {with_problems}.'
        )
