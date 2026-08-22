import datetime as dt

import pytest
from django.core.cache import cache
from django.urls import reverse

from apps.portal.models import Announcement


@pytest.mark.django_db
def test_site_notices_public_and_filtered(client, admin_user):
    cache.clear()
    Announcement.objects.create(title='Suspensión', body='No hay clases el lunes.', created_by=admin_user, show_on_site=True, site_link='/calendario')
    Announcement.objects.create(title='Vieja', body='x', created_by=admin_user, show_on_site=True, site_until=dt.date(2020, 1, 1))
    Announcement.objects.create(title='Solo portal', body='x', created_by=admin_user, show_on_site=False)
    Announcement.objects.create(title='Inactiva', body='x', created_by=admin_user, show_on_site=True, is_active=False)
    r = client.get(reverse('site-notices'))
    assert r.status_code == 200
    assert [n['title'] for n in r.data] == ['Suspensión'] and r.data[0]['link'] == '/calendario'


@pytest.mark.django_db
def test_admin_toggle_clears_cache(admin_client, admin_user, client):
    cache.clear()
    a = Announcement.objects.create(title='A', body='b', created_by=admin_user)
    assert client.get(reverse('site-notices')).data == []
    r = admin_client.patch(reverse('admin-announcement-detail', args=[a.pk]), {'show_on_site': True}, format='json')
    assert r.status_code == 200 and r.data['show_on_site'] is True
    assert [n['id'] for n in client.get(reverse('site-notices')).data] == [a.pk]
