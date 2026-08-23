import datetime as dt
from io import StringIO

import pytest
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.content.media import MediaAsset
from apps.portal.models import Announcement, AnnouncementRead, Notification


@pytest.mark.django_db
def test_scheduled_comunicado_waits_for_cms_schedule(admin_client, parent_user, settings, tmp_path):
    auth_client = APIClient()
    auth_client.force_authenticate(parent_user)
    settings.MEDIA_ROOT = str(tmp_path)
    asset = MediaAsset(filename='circular.pdf', content_type='application/pdf', alt='Circular')
    asset.file.save('circular.pdf', ContentFile(b'%PDF'), save=False)
    asset.save()
    later = (timezone.now() + dt.timedelta(hours=2)).isoformat()
    r = admin_client.post(reverse('admin-announcements'), {
        'title': 'Junta', 'body': 'Viernes', 'audience': 'all', 'is_active': True, 'push_enabled': False,
        'publish_at': later, 'requires_ack': True, 'attachments': [{'id': asset.pk, 'name': 'Circular 3'}],
    }, format='json')
    assert r.status_code == 201, r.data
    assert r.data['attachments'][0]['url'].startswith('/api/v1/content/media/')
    ann = Announcement.objects.get()
    assert ann.fanout_at is None and Notification.objects.count() == 0
    # families cannot see it yet
    assert [a['id'] for a in auth_client.get(reverse('announcements')).data['results']] == []
    # bad attachment rejected
    bad = admin_client.patch(reverse('admin-announcement-detail', args=[ann.pk]), {'attachments': [{'id': 99999}]}, format='json')
    assert bad.status_code == 400
    # time arrives → cms_schedule fans out once
    Announcement.objects.filter(pk=ann.pk).update(publish_at=timezone.now() - dt.timedelta(minutes=1))
    out = StringIO()
    call_command('cms_schedule', stdout=out)
    ann.refresh_from_db()
    assert ann.fanout_at is not None and Notification.objects.filter(user=parent_user).exists()
    assert 'comunicados enviados 1' in out.getvalue()
    call_command('cms_schedule', stdout=out)
    assert Notification.objects.filter(user=parent_user).count() == 1
    listed = auth_client.get(reverse('announcements')).data['results'][0]
    assert listed['requires_ack'] is True and listed['acknowledged'] is False and listed['attachments'][0]['name'] == 'Circular 3'


@pytest.mark.django_db
def test_ack_is_idempotent_and_counted(admin_client, parent_user, admin_user):
    auth_client = APIClient()
    auth_client.force_authenticate(parent_user)
    ann = Announcement.objects.create(title='A', body='b', created_by=admin_user, requires_ack=True)
    url = reverse('announcement-ack', args=[ann.pk])
    assert auth_client.post(url, {}, format='json').status_code == 200
    assert auth_client.post(url, {}, format='json').status_code == 200
    assert AnnouncementRead.objects.filter(announcement=ann, user=parent_user, acknowledged_at__isnull=False).count() == 1
    assert auth_client.get(reverse('announcements')).data['results'][0]['acknowledged'] is True
    d = admin_client.get(reverse('admin-announcement-delivery', args=[ann.pk])).data
    assert d['acknowledged'] == 1 and d['requires_ack'] is True
    staff_only = Announcement.objects.create(title='S', body='b', created_by=admin_user, audience=Announcement.Audience.STAFF)
    assert auth_client.post(reverse('announcement-ack', args=[staff_only.pk]), {}, format='json').status_code == 404
