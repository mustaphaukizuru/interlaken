"""GET /api/v1/portal/notifications/<pk>/ — one notification, opened on its own page.

Before this endpoint an 'info' notification had nowhere to be read in full: the
list clamps the body to two lines and tapping the row did nothing.
"""
import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory
from apps.portal.models import Announcement, Notification


def url(pk):
    return reverse('notification-detail', args=[pk])


@pytest.mark.django_db
class TestNotificationDetail:
    def test_returns_the_full_message_and_delivery_stamp(self, api_client):
        me = ParentFactory()
        sent = timezone.now()
        body = 'Línea uno.\nLínea dos, mucho más larga de lo que cabe en la lista.'
        n = Notification.objects.create(
            user=me, notif_type=Notification.NotifType.WARNING,
            title='Saldo bajo', message=body, delivered_at=sent)

        api_client.force_authenticate(me)
        resp = api_client.get(url(n.pk))

        assert resp.status_code == 200
        data = resp.json()
        assert data['message'] == body          # not truncated
        assert data['notif_type'] == 'warning'
        assert data['type_label'] == 'Advertencia'
        assert data['delivered_at'] is not None
        assert data['announcement'] is None
        assert data['announcement_title'] == ''

    def test_names_the_related_announcement(self, api_client):
        me = ParentFactory()
        ann = Announcement.objects.create(title='Junta de padres', body='b', audience='all')
        n = Notification.objects.create(
            user=me, notif_type=Notification.NotifType.INFO,
            title='Nuevo comunicado', message='m', announcement=ann)

        api_client.force_authenticate(me)
        data = api_client.get(url(n.pk)).json()

        assert data['announcement'] == ann.pk
        assert data['announcement_title'] == 'Junta de padres'

    def test_another_familys_notification_is_a_404_not_a_leak(self, api_client):
        mine = ParentFactory()
        theirs = ParentFactory()
        n = Notification.objects.create(
            user=theirs, notif_type=Notification.NotifType.INFO,
            title='Privado', message='secreto')

        api_client.force_authenticate(mine)
        resp = api_client.get(url(n.pk))

        assert resp.status_code == 404
        assert 'secreto' not in resp.content.decode()

    def test_requires_authentication(self, api_client):
        n = Notification.objects.create(
            user=ParentFactory(), notif_type=Notification.NotifType.INFO,
            title='A', message='m')
        assert api_client.get(url(n.pk)).status_code == 401
