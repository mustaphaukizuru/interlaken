"""Launch fix 4: a comunicado scheduled for later stays out of sight until its time.

Only the family list and the fan-out used to respect ``publish_at``: the public
site banner, the dashboards, the detail page, the comments, mark-read and
«Enterado» showed (or accepted) a comunicado the office had scheduled for
later. They all share one «published» filter now; the console still sees
scheduled ones.
"""
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.portal.models import Announcement, AnnouncementComment, AnnouncementRead, published_q
from apps.portal.views import SITE_NOTICES_TTL, site_notices_ttl

pytestmark = pytest.mark.django_db


@pytest.fixture
def family(parent_user):
    client = APIClient()
    client.force_authenticate(parent_user)
    return client


@pytest.fixture
def scheduled(admin_user):
    return Announcement.objects.create(
        title='Suspensión del lunes', body='No habrá clases.', audience=Announcement.Audience.ALL,
        created_by=admin_user, is_active=True, show_on_site=True, requires_ack=True,
        publish_at=timezone.now() + timedelta(hours=2))


def _arrive(ann):
    """The scheduled time comes."""
    Announcement.objects.filter(pk=ann.pk).update(publish_at=timezone.now() - timedelta(minutes=1))
    cache.clear()


def test_published_filter():
    now = timezone.now()
    a = Announcement.objects.create(title='Ya', body='x')
    b = Announcement.objects.create(title='Antes', body='x', publish_at=now - timedelta(minutes=5))
    Announcement.objects.create(title='Luego', body='x', publish_at=now + timedelta(minutes=5))
    assert set(Announcement.objects.filter(published_q()).values_list('pk', flat=True)) == {a.pk, b.pk}


def test_public_site_banner_waits(client, scheduled):
    cache.clear()
    assert client.get(reverse('site-notices')).data == []
    _arrive(scheduled)
    assert [n['id'] for n in client.get(reverse('site-notices')).data] == [scheduled.pk]


def test_banner_cache_never_outlives_the_next_scheduled_notice(scheduled):
    now = timezone.now()
    assert SITE_NOTICES_TTL == 300
    assert site_notices_ttl(now) == 300                    # two hours away: the usual 5 minutes
    Announcement.objects.filter(pk=scheduled.pk).update(publish_at=now + timedelta(seconds=90))
    assert 1 <= site_notices_ttl(now) <= 91


def test_dashboard_waits(family, scheduled):
    assert family.get(reverse('dashboard')).data['announcements'] == []
    _arrive(scheduled)
    assert [a['id'] for a in family.get(reverse('dashboard')).data['announcements']] == [scheduled.pk]


def test_detail_waits(family, scheduled):
    url = reverse('announcement-detail', args=[scheduled.pk])
    assert family.get(url).status_code == 404
    _arrive(scheduled)
    assert family.get(url).status_code == 200


def test_comments_wait(family, scheduled):
    url = reverse('announcement-comments', args=[scheduled.pk])
    assert family.get(url).status_code == 404
    assert family.post(url, {'body': '¿Hay transporte?'}, format='json').status_code == 404
    assert not AnnouncementComment.objects.exists()
    _arrive(scheduled)
    assert family.post(url, {'body': '¿Hay transporte?'}, format='json').status_code == 201


def test_mark_read_ignores_it_until_published(family, parent_user, scheduled):
    url = reverse('announcements-mark-read')
    assert family.post(url, {'ids': [scheduled.pk]}, format='json').data == {'marked': 0}
    assert not AnnouncementRead.objects.exists()
    _arrive(scheduled)
    assert family.post(url, {'ids': [scheduled.pk]}, format='json').data == {'marked': 1}


def test_ack_waits(family, scheduled):
    url = reverse('announcement-ack', args=[scheduled.pk])
    assert family.post(url, {}, format='json').status_code == 404
    _arrive(scheduled)
    assert family.post(url, {}, format='json').status_code == 200


def test_the_console_still_sees_scheduled_ones(admin_client, scheduled):
    ids = [a['id'] for a in admin_client.get(reverse('admin-announcements')).data['results']]
    assert ids == [scheduled.pk]
