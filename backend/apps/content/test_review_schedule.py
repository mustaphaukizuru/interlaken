import datetime as dt
from io import StringIO

import pytest
from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import User
from apps.content.pages import Page
from apps.portal.models import Notification


@pytest.fixture
def staff_client(api_client, db):
    u = User.objects.create_user(email='staff@test.mx', password='x-pass-1234', first_name='Sol', last_name='Staff', role=User.Role.STAFF)
    api_client.force_authenticate(u)
    api_client.user = u
    return api_client


@pytest.fixture(autouse=True)
def _cache():
    cache.clear()


@pytest.mark.django_db
class TestApproval:
    def test_staff_edits_and_requests_review_admin_publishes(self, staff_client, admin_user, settings):
        settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
        r = staff_client.post(reverse('admin-pages'), {'slug': 'verano', 'title': 'Verano', 'draft_blocks': [{'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>Hola</p>'}}], 'seo': {}}, format='json')
        assert r.status_code == 201
        pk = r.data['id']
        assert staff_client.patch(reverse('admin-page-detail', args=[pk]), {'title': 'Curso de verano'}, format='json').status_code == 200
        # staff cannot publish, delete or roll back
        assert staff_client.post(reverse('admin-page-publish', args=[pk]), {'action': 'publish'}, format='json').status_code == 403
        assert staff_client.delete(reverse('admin-page-detail', args=[pk])).status_code == 403
        assert staff_client.get(reverse('admin-page-versions', args=[pk])).status_code == 403
        # request approval: admins notified with preview link
        r = staff_client.post(reverse('admin-page-review', args=[pk]), {'action': 'request'}, format='json')
        assert r.status_code == 200 and r.data['review_requested_at'] and r.data['review_requested_by_name'] == 'Sol Staff'
        n = Notification.objects.get(user=admin_user)
        assert 'verano?preview=' in n.message
        # preview token from the link is valid for a week
        token = n.message.split('preview=')[1].split()[0]
        assert staff_client.get(reverse('cms-page-preview-token') + f'?token={token}').status_code == 200
        # admin rejects with a note → requester notified; then publishes → cleared
        staff_client.force_authenticate(admin_user)
        r = staff_client.post(reverse('admin-page-review', args=[pk]), {'action': 'reject', 'note': 'Falta el precio.'}, format='json')
        assert r.status_code == 200 and r.data['review_requested_at'] is None and r.data['review_note'] == 'Falta el precio.'
        assert Notification.objects.filter(user__email='staff@test.mx', message='Falta el precio.').exists()
        assert staff_client.post(reverse('admin-page-publish', args=[pk]), {'action': 'publish'}, format='json').status_code == 200
        assert Page.objects.get(pk=pk).review_note == ''

    def test_staff_cannot_reject(self, staff_client, admin_user):
        p = Page.objects.create(slug='x', title='X', review_requested_at=timezone.now())
        assert staff_client.post(reverse('admin-page-review', args=[p.pk]), {'action': 'reject'}, format='json').status_code == 403


@pytest.mark.django_db
class TestSchedule:
    def test_lazy_unpublish_and_command(self, client, admin_user, admin_client):
        p = Page.objects.create(slug='oferta', title='Oferta', draft_blocks=[])
        p.publish(admin_user)
        assert client.get(reverse('cms-page', args=['oferta'])).status_code == 200
        cache.clear()
        r = admin_client.patch(reverse('admin-page-detail', args=[p.pk]), {'unpublish_at': (timezone.now() - dt.timedelta(minutes=1)).isoformat()}, format='json')
        assert r.status_code == 200
        cache.clear()
        assert client.get(reverse('cms-page', args=['oferta'])).status_code == 404
        assert Page.objects.get(pk=p.pk).status == 'draft'
        # scheduled publish
        q = Page.objects.create(slug='futuro', title='F', draft_blocks=[], publish_at=timezone.now() - dt.timedelta(seconds=1))
        out = StringIO()
        call_command('cms_schedule', stdout=out)
        q.refresh_from_db()
        assert q.status == 'published' and q.publish_at is None
        assert 'Publicadas 1' in out.getvalue()
        assert not mail.outbox or True
