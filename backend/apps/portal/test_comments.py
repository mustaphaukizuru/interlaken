"""
Comunicado detail + family replies (comments). Audience-scoped: a family reads
and posts on any comunicado it can see; hidden comments never list; a comunicado
targeted at another audience 404s (never leaked).
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory
from apps.portal.models import Announcement, AnnouncementComment

pytestmark = pytest.mark.django_db


def _ann(audience=Announcement.Audience.ALL, **kw):
    return Announcement.objects.create(title='Aviso', body='Cuerpo', audience=audience, **kw)


class TestAnnouncementDetail:
    def test_family_reads_visible_announcement(self, api_client):
        ann = _ann()
        api_client.force_authenticate(ParentFactory())
        resp = api_client.get(reverse('announcement-detail', args=[ann.id]))
        assert resp.status_code == 200
        assert resp.json()['title'] == 'Aviso'
        assert resp.json()['comment_count'] == 0

    def test_out_of_audience_404(self, api_client):
        staff_only = _ann(audience=Announcement.Audience.STAFF)
        api_client.force_authenticate(ParentFactory())
        assert api_client.get(
            reverse('announcement-detail', args=[staff_only.id])).status_code == 404


class TestAnnouncementComments:
    def test_family_can_post_and_list(self, api_client):
        ann = _ann()
        api_client.force_authenticate(ParentFactory())
        url = reverse('announcement-comments', args=[ann.id])
        created = api_client.post(url, {'body': '¿A qué hora?'}, format='json')
        assert created.status_code == 201, created.content
        assert created.json()['author_name']            # attributed, not blank
        rows = api_client.get(url).json()['results']
        assert [r['body'] for r in rows] == ['¿A qué hora?']

    def test_hidden_comments_are_not_listed(self, api_client):
        ann = _ann()
        parent = ParentFactory()
        AnnouncementComment.objects.create(announcement=ann, author=parent, body='visible')
        AnnouncementComment.objects.create(announcement=ann, author=parent,
                                           body='oculto', is_hidden=True)
        api_client.force_authenticate(parent)
        rows = api_client.get(reverse('announcement-comments', args=[ann.id])).json()['results']
        assert [r['body'] for r in rows] == ['visible']

    def test_cannot_comment_on_out_of_audience(self, api_client):
        staff_only = _ann(audience=Announcement.Audience.STAFF)
        api_client.force_authenticate(ParentFactory())
        url = reverse('announcement-comments', args=[staff_only.id])
        assert api_client.post(url, {'body': 'hola'}, format='json').status_code == 404

    def test_anonymous_cannot_comment(self, api_client):
        ann = _ann()
        assert api_client.post(
            reverse('announcement-comments', args=[ann.id]), {'body': 'x'}, format='json'
        ).status_code == 401
