"""
Admin comunicados (announcements) CRUD from the console: compose, edit/toggle,
delete — admin-only. The public list stays audience-filtered + active-only.
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import (AdminFactory, ParentFactory,
                                     StudentUserFactory, UserFactory)
from apps.accounts.models import User
from apps.portal.models import Announcement, Notification

pytestmark = pytest.mark.django_db

LIST_URL = reverse('admin-announcements')


class TestAnnouncementAdminCRUD:
    def test_admin_creates_announcement_with_author(self, api_client):
        admin = AdminFactory()
        api_client.force_authenticate(admin)
        resp = api_client.post(LIST_URL, {
            'title': 'Suspensión de clases', 'body': 'No habrá clases el viernes.',
            'audience': 'parents',
        }, format='json')
        assert resp.status_code == 201, resp.content
        a = Announcement.objects.get()
        assert a.title == 'Suspensión de clases'
        assert a.audience == 'parents'
        assert a.created_by_id == admin.id
        assert a.is_active is True

    def test_publishing_fans_out_notifications_to_the_audience(self, api_client):
        # Publishing an active comunicado must alert its audience in-app; before
        # the fix, perform_create notified nobody.
        p1, p2 = ParentFactory(), ParentFactory()
        StudentUserFactory()                       # wrong audience
        UserFactory(role=User.Role.STAFF)          # wrong audience
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(LIST_URL, {
            'title': 'Junta de padres', 'body': 'Mañana a las 5 pm.',
            'audience': 'parents',
        }, format='json')
        assert resp.status_code == 201, resp.content
        notified = set(Notification.objects.values_list('user_id', flat=True))
        assert notified == {p1.id, p2.id}          # parents only
        assert Notification.objects.get(user=p1).title == 'Junta de padres'

    def test_draft_announcement_notifies_nobody(self, api_client):
        ParentFactory()
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(LIST_URL, {
            'title': 'Borrador', 'body': 'x', 'audience': 'all', 'is_active': False,
        }, format='json')
        assert resp.status_code == 201, resp.content
        assert Notification.objects.count() == 0

    def test_admin_lists_all_including_inactive(self, api_client):
        Announcement.objects.create(title='A', body='x', is_active=True)
        Announcement.objects.create(title='B', body='y', is_active=False)
        api_client.force_authenticate(AdminFactory())
        rows = api_client.get(LIST_URL).json()['results']
        assert {r['title'] for r in rows} == {'A', 'B'}   # inactive included

    def test_admin_toggles_and_edits(self, api_client):
        a = Announcement.objects.create(title='A', body='x', is_active=True)
        api_client.force_authenticate(AdminFactory())
        url = reverse('admin-announcement-detail', args=[a.id])
        resp = api_client.patch(url, {'is_active': False, 'title': 'A2'}, format='json')
        assert resp.status_code == 200, resp.content
        a.refresh_from_db()
        assert a.is_active is False and a.title == 'A2'

    def test_admin_deletes(self, api_client):
        a = Announcement.objects.create(title='A', body='x')
        api_client.force_authenticate(AdminFactory())
        resp = api_client.delete(reverse('admin-announcement-detail', args=[a.id]))
        assert resp.status_code == 204
        assert not Announcement.objects.filter(id=a.id).exists()

    def test_parent_cannot_manage(self, api_client):
        api_client.force_authenticate(ParentFactory())
        assert api_client.get(LIST_URL).status_code == 403
        assert api_client.post(LIST_URL, {'title': 'x', 'body': 'y'}, format='json').status_code == 403
