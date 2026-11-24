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


# QA sweep 2026-11-24: «Ver más» accepted javascript: URLs.
@pytest.mark.django_db
@pytest.mark.parametrize('link', [
    'javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<b>x</b>', '//evil.test/x',
    'vbscript:x', 'https://', 'https://exa mple.com', '/ruta\\..\\x', '/\\evil.test', 'admisiones',
])
def test_site_link_rejects_unsafe_values(admin_client, admin_user, link):
    a = Announcement.objects.create(title='A', body='b', created_by=admin_user)
    r = admin_client.patch(reverse('admin-announcement-detail', args=[a.pk]),
                           {'site_link': link}, format='json')
    assert r.status_code == 400 and 'site_link' in r.data, link
    a.refresh_from_db()
    assert a.site_link == ''


@pytest.mark.django_db
@pytest.mark.parametrize('link, stored', [
    ('/admisiones', '/admisiones'), ('/admisiones#costos', '/admisiones#costos'),
    ('/calendario?mes=12', '/calendario?mes=12'), (' https://wa.me/5215512345678 ', 'https://wa.me/5215512345678'),
    ('http://interlaken.edu.mx/costos', 'http://interlaken.edu.mx/costos'), ('', ''),
])
def test_site_link_accepts_paths_and_web_addresses(admin_client, admin_user, link, stored):
    a = Announcement.objects.create(title='A', body='b', created_by=admin_user)
    r = admin_client.patch(reverse('admin-announcement-detail', args=[a.pk]),
                           {'site_link': link}, format='json')
    assert r.status_code == 200, r.data
    a.refresh_from_db()
    assert a.site_link == stored


@pytest.mark.django_db
def test_site_link_checked_on_create_too(admin_client):
    r = admin_client.post(reverse('admin-announcements'), {
        'title': 'Aviso', 'body': 'Texto', 'audience': 'all', 'site_link': 'javascript:alert(1)',
    }, format='json')
    assert r.status_code == 400 and 'site_link' in r.data
    assert not Announcement.objects.filter(title='Aviso').exists()
