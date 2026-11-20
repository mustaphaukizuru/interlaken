"""Navegación → «Textos del sitio» (SiteSettings.chrome) and the app-screen CMS pages.

The site-wide texts share the chrome JSON with the header/footer form; empty
values mean «the built-in text», unknown keys are dropped, and the screens
whose copy is now in Contenido (sign-in, invitation wizards, e-mail
confirmation) never reach the sitemap.
"""
import pytest
from django.core.cache import cache
from django.urls import reverse

from apps.content.models import SiteSettings
from apps.content.navigation import SITE_TEXTS, UNLISTED_SLUGS, page_path
from apps.content.pages import Page, published_head


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
class TestSiteTexts:
    def test_admin_saves_texts_next_to_the_header_footer_copy(self, admin_client, client):
        chrome = {
            'footer_note': 'Validez oficial SEP',
            'cookie_text': 'Usamos cookies de medición.',
            'cookie_accept': 'De acuerdo',
            'wa_visit': 'Hola, quiero conocer el colegio.',
            'funnel_2': 'Recorrido',
            'offline_text': 'Sin señal por ahora.',
            'legal_links': [{'label': 'Aviso de Privacidad', 'href': '/aviso-de-privacidad'},
                            {'label': 'Reglamento', 'href': 'https://example.com/reglamento.pdf'}],
            'not_a_key': 'se descarta',
        }
        r = admin_client.patch(reverse('admin-site-settings'), {'chrome': chrome}, format='json')
        assert r.status_code == 200, r.data
        saved = SiteSettings.load().chrome
        assert saved['cookie_accept'] == 'De acuerdo'
        assert saved['funnel_2'] == 'Recorrido'
        assert saved['footer_note'] == 'Validez oficial SEP'
        assert saved['legal_links'][1] == {'label': 'Reglamento', 'href': 'https://example.com/reglamento.pdf'}
        assert 'not_a_key' not in saved
        assert client.get(reverse('site-settings')).data['chrome']['wa_visit'] == 'Hola, quiero conocer el colegio.'

    def test_blank_values_are_dropped_so_the_site_uses_the_built_in_text(self, admin_client):
        r = admin_client.patch(reverse('admin-site-settings'), {'chrome': {'cookie_text': '   ', 'legal_links': [{'label': '', 'href': ''}]}}, format='json')
        assert r.status_code == 200, r.data
        assert SiteSettings.load().chrome == {}

    @pytest.mark.parametrize('chrome', [
        {'cookie_accept': 'x' * (SITE_TEXTS['cookie_accept'] + 1)},
        {'legal_links': [{'label': 'Malo', 'href': 'javascript:alert(1)'}]},
        {'legal_links': [{'label': 'Sin texto' * 10, 'href': '/x'}]},
        {'legal_links': [{'label': f'L{i}', 'href': '/x'} for i in range(5)]},
        {'legal_links': 'no es lista'},
    ])
    def test_invalid_texts_are_refused(self, admin_client, chrome):
        r = admin_client.patch(reverse('admin-site-settings'), {'chrome': chrome}, format='json')
        assert r.status_code == 400
        assert SiteSettings.load().chrome == {}

    def test_staff_without_admin_cannot_edit(self, client, django_user_model):
        staff = django_user_model.objects.create_user(email='editor@test.mx', password='x-pass-1234', role='staff')
        client.force_login(staff)
        r = client.patch(reverse('admin-site-settings'), {'chrome': {'cookie_text': 'x'}}, content_type='application/json')
        assert r.status_code in (401, 403)


@pytest.mark.django_db
class TestAppScreenPages:
    def test_paths_and_sitemap_exclusion(self, client):
        assert page_path('iniciar-sesion') == '/login'
        assert page_path('inscripcion') == '/inscripcion'
        assert page_path('inscripcion-documentos') == '/inscripcion/documentos'
        assert page_path('confirmar-correo') == '/confirmar-correo'
        assert {'iniciar-sesion', 'inscripcion', 'inscripcion-documentos', 'confirmar-correo'} <= UNLISTED_SLUGS
        for slug in ('iniciar-sesion', 'inscripcion', 'confirmar-correo'):
            Page.objects.create(slug=slug, title=slug, status=Page.Status.PUBLISHED, seo={'title': f'SEO {slug}'})
        body = client.get('/sitemap.xml').content.decode()
        for path in ('/login', '/inscripcion', '/confirmar-correo'):
            assert f'interlaken.edu.mx{path}<' not in body

    def test_server_head_uses_the_published_login_seo(self):
        Page.objects.create(slug='iniciar-sesion', title='Iniciar sesión', status=Page.Status.PUBLISHED,
                            seo={'title': 'Portal de familias', 'description': 'Acceso al portal.'})
        head = published_head('/login')
        assert head and head['title'] == 'Portal de familias'
        assert published_head('/inscripcion/documentos') is None
