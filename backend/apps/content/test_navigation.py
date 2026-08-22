import pytest
from django.core.cache import cache
from django.urls import reverse

from apps.content.models import SiteSettings
from apps.content.navigation import Redirect
from apps.content.pages import Page


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
class TestMenu:
    def test_admin_sets_menu_and_public_reads_it(self, admin_client, client):
        menu = [{'label': 'El Colegio', 'items': [{'label': 'Nosotros', 'to': '/nosotros', 'icon': 'Users'}]}]
        r = admin_client.patch(reverse('admin-site-settings'), {'menu': menu}, format='json')
        assert r.status_code == 200, r.data
        assert client.get(reverse('site-settings')).data['menu'] == menu

    def test_menu_validation(self, admin_client):
        bad = [{'label': 'X', 'items': [{'label': 'Malo', 'to': 'javascript:alert(1)'}]}]
        r = admin_client.patch(reverse('admin-site-settings'), {'menu': bad}, format='json')
        assert r.status_code == 400 and 'menu' in r.data
        assert SiteSettings.load().menu == []


@pytest.mark.django_db
class TestRedirects:
    def test_crud_and_public_map(self, admin_client, client):
        r = admin_client.post(reverse('admin-redirects'), {'from_path': '/inscripciones/', 'to_path': '/admisiones'}, format='json')
        assert r.status_code == 201 and r.data['from_path'] == '/inscripciones'
        assert admin_client.post(reverse('admin-redirects'), {'from_path': '/api/x', 'to_path': '/y'}, format='json').status_code == 400
        assert admin_client.post(reverse('admin-redirects'), {'from_path': '/a', 'to_path': '/a'}, format='json').status_code == 400
        assert client.get(reverse('cms-redirects')).data == {'/inscripciones': {'to': '/admisiones', 'permanent': True}}
        client.post(reverse('cms-redirect-hit'), {'from': '/inscripciones'}, content_type='application/json')
        assert Redirect.objects.get().hits == 1

    def test_parent_cannot_manage(self, auth_client):
        assert auth_client.get(reverse('admin-redirects')).status_code == 403


@pytest.mark.django_db
class TestSitemap:
    def test_lists_static_and_published_pages_minus_redirects(self, client, admin_user):
        Page.objects.create(slug='verano', title='Verano', draft_blocks=[]).publish(admin_user)
        Page.objects.create(slug='borrador', title='B', draft_blocks=[])
        Page.objects.create(slug='oculta', title='O', draft_blocks=[], seo={'noindex': True}).publish(admin_user)
        Redirect.objects.create(from_path='/galeria', to_path='/verano')
        r = client.get('/sitemap.xml')
        assert r.status_code == 200 and r['Content-Type'].startswith('application/xml')
        xml = r.content.decode()
        assert 'https://interlaken.edu.mx/verano' in xml and '<lastmod>' in xml
        assert '/borrador' not in xml and '/oculta' not in xml
        assert 'https://interlaken.edu.mx/galeria</loc>' not in xml
        assert 'https://interlaken.edu.mx/admisiones</loc>' in xml
