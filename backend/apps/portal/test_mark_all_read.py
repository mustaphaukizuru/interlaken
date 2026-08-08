"""POST /api/v1/portal/notifications/mark-all-read/"""
import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory
from apps.portal.models import Notification

URL = reverse('notifications-mark-all-read')


@pytest.mark.django_db
class TestMarkAllNotificationsRead:
    def test_marks_only_own_unread(self, api_client):
        me = ParentFactory()
        other = ParentFactory()
        n1 = Notification.objects.create(
            user=me, notif_type=Notification.NotifType.INFO, title='A', message='m')
        n2 = Notification.objects.create(
            user=me, notif_type=Notification.NotifType.INFO, title='B', message='m',
            is_read=True)
        n3 = Notification.objects.create(
            user=other, notif_type=Notification.NotifType.INFO, title='C', message='m')

        api_client.force_authenticate(me)
        resp = api_client.post(URL)
        assert resp.status_code == 200
        assert resp.json()['marked'] == 1

        n1.refresh_from_db()
        n2.refresh_from_db()
        n3.refresh_from_db()
        assert n1.is_read is True
        assert n2.is_read is True
        assert n3.is_read is False

    def test_requires_auth(self, api_client):
        assert api_client.post(URL).status_code in (401, 403)
