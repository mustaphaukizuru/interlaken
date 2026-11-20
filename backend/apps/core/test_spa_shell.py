import copy
import json
import re

import pytest
from django.core.cache import cache
from django.template import engines

from apps.core import spa

INDEX = """<html><head>
<title>Colegio Interlaken | Escuela bilingüe en Tlalnepantla</title>
<meta name="description" content="home" />
<link rel="canonical" href="https://interlaken.edu.mx/" />
<!--HEAD-->
<meta property="og:title" content="home" />
<meta property="og:description" content="home" />
<meta property="og:url" content="https://interlaken.edu.mx/" />
<meta property="og:image" content="https://interlaken.edu.mx/og-image.png" />
<meta name="twitter:title" content="home" />
<meta name="twitter:description" content="home" />
<meta name="twitter:image" content="https://interlaken.edu.mx/og-image.png" />
</head><body><div id="root"><!--SHELL--></div></body></html>"""

SEO_ROUTES = {
    '/': {'title': 'Colegio Interlaken | Escuela bilingüe en Tlalnepantla', 'description': 'Inicio.',
          'canonical': 'https://interlaken.edu.mx/', 'image': 'https://interlaken.edu.mx/og-image.png', 'jsonLd': []},
    '/admisiones': {'title': 'Admisiones 2026–2027 · Colegio Interlaken', 'description': 'Requisitos y fechas <de> admisión.',
                    'canonical': 'https://interlaken.edu.mx/admisiones', 'image': 'https://interlaken.edu.mx/og-image.png',
                    'jsonLd': [{'@type': 'BreadcrumbList', 'name': '</script><script>alert(1)</script>'}]},
    '/nosotros': {'title': 'Nosotros · Colegio Interlaken', 'description': 'Historia.',
                  'canonical': 'https://interlaken.edu.mx/nosotros', 'image': 'https://interlaken.edu.mx/og-image.png', 'jsonLd': []},
    '/inscripcion': {'title': 'Inscripción formal · Colegio Interlaken', 'description': 'Flujo privado.',
                     'canonical': 'https://interlaken.edu.mx/inscripcion', 'image': 'https://interlaken.edu.mx/og-image.png',
                     'robots': 'noindex', 'jsonLd': []},
    '/confirmar-correo': {'title': 'Confirmar correo · Colegio Interlaken', 'description': 'Privado.',
                          'canonical': 'https://interlaken.edu.mx/confirmar-correo', 'image': 'https://interlaken.edu.mx/og-image.png',
                          'robots': 'noindex', 'jsonLd': []},
}


@pytest.fixture
def built_site(settings, tmp_path):
    (tmp_path / 'index.html').write_text(INDEX, encoding='utf-8')
    (tmp_path / 'shells.json').write_text('{"/": "<div data-shell>Formando líderes</div>", "/admisiones": "<h1 data-shell>Admisiones</h1>"}', encoding='utf-8')
    (tmp_path / 'seo-routes.json').write_text(json.dumps(SEO_ROUTES), encoding='utf-8')
    # Replace the whole TEMPLATES attribute (never mutate the nested dict:
    # pytest-django restores only attribute assignments, and the cached template
    # engines would keep leaking tmp_path into every later test).
    templates = copy.deepcopy(settings.TEMPLATES)
    templates[0]['DIRS'] = [str(tmp_path)]
    settings.TEMPLATES = templates
    settings.STATICFILES_DIRS = [str(tmp_path)]
    spa.clear_caches()
    engines._engines.clear()
    cache.clear()
    yield
    spa.clear_caches()
    engines._engines.clear()
    cache.clear()


def _head(html: str) -> dict:
    return {
        'title': re.findall(r'<title>([^<]*)</title>', html),
        'canonical': re.findall(r'rel="canonical" href="([^"]*)"', html),
        'description': re.findall(r'name="description" content="([^"]*)"', html),
        'og_url': re.findall(r'property="og:url" content="([^"]*)"', html),
        'robots': re.findall(r'name="robots" content="([^"]*)"', html),
        'ld': re.findall(r'<script type="application/ld\+json" data-page-ld>(.*?)</script>', html),
    }


@pytest.mark.django_db
def test_shell_only_for_known_routes(client, built_site):
    home = client.get('/').content.decode()
    assert 'data-shell' in home and 'Formando líderes' in home and '<!--SHELL-->' not in home
    portal = client.get('/portal/cafeteria')
    assert portal.status_code == 200
    assert 'data-shell' not in portal.content.decode() and '<div id="root"></div>' in portal.content.decode()


@pytest.mark.django_db
def test_each_route_gets_its_own_head_in_the_raw_html(client, built_site):
    r = client.get('/admisiones')
    assert r.status_code == 200
    h = _head(r.content.decode())
    assert h['title'] == ['Admisiones 2026–2027 · Colegio Interlaken']
    assert h['canonical'] == ['https://interlaken.edu.mx/admisiones']
    assert h['og_url'] == ['https://interlaken.edu.mx/admisiones']
    assert h['description'] == ['Requisitos y fechas &lt;de&gt; admisión.']
    assert h['robots'] == []
    # Page JSON-LD lands at the marker and cannot close its own <script>.
    assert len(h['ld']) == 1 and '</script>' not in h['ld'][0] and '\\u003c/script>' in h['ld'][0]
    assert '<!--HEAD-->' not in r.content.decode()


@pytest.mark.django_db
def test_private_flows_and_app_screens_say_noindex(client, built_site):
    assert _head(client.get('/inscripcion').content.decode())['robots'] == ['noindex']
    login = client.get('/login')
    assert login.status_code == 200 and _head(login.content.decode())['robots'] == ['noindex']
    assert client.get('/admin/alumnos').status_code == 200
    r = client.get('/confirmar-correo?token=abc')
    assert r.status_code == 200 and r['Referrer-Policy'] == 'no-referrer'


@pytest.mark.django_db
def test_unknown_paths_are_real_404s_and_spam_paths_410(client, built_site):
    for path in ('/no-existe', '/index.php', '/nosotros.html', '/niveles/kinder'):
        r = client.get(path)
        assert r.status_code == 404, path
        h = _head(r.content.decode())
        assert h['robots'] == ['noindex'] and h['title'] == ['Página no encontrada · Colegio Interlaken']
        assert '<div id="root"></div>' in r.content.decode()  # the SPA still renders its 404 page
    assert client.get('/testmama/tag/manualidades').status_code == 410


@pytest.mark.django_db
def test_trailing_slash_and_aliases_redirect_permanently(client, built_site):
    r = client.get('/contacto/?utm_source=fb')
    assert r.status_code == 301 and r['Location'] == '/contacto?utm_source=fb'
    r = client.get('/puertas-abiertas')
    assert r.status_code == 301 and r['Location'] == '/agendar-visita'
    # Consoles and the portal keep answering with or without the slash.
    assert client.get('/admin/alumnos/').status_code == 200
    assert client.get('/portal/').status_code == 200


@pytest.mark.django_db
def test_cms_redirects_answer_on_the_server(client, built_site):
    from apps.content.navigation import Redirect
    Redirect.objects.create(from_path='/inscripciones', to_path='/admisiones', permanent=True)
    Redirect.objects.create(from_path='/verano-2025', to_path='/agendar-visita', permanent=False)
    r = client.get('/inscripciones')
    assert r.status_code == 301 and r['Location'] == '/admisiones'
    assert client.get('/verano-2025').status_code == 302
    assert Redirect.objects.get(from_path='/inscripciones').hits == 1


@pytest.mark.django_db
def test_published_cms_version_refines_the_head(client, built_site, admin_user):
    from apps.content.pages import Page
    user = admin_user
    page = Page.objects.create(slug='nosotros', title='Nosotros', seo={'title': 'Quiénes somos', 'description': 'Desde 1981.'})
    page.publish(user)
    h = _head(client.get('/nosotros').content.decode())
    assert h['title'] == ['Quiénes somos · Colegio Interlaken'] and h['description'] == ['Desde 1981.']
    assert h['canonical'] == ['https://interlaken.edu.mx/nosotros']
    # A CMS landing page outside ROUTE_META is a real page, canonical at /<slug>.
    landing = Page.objects.create(slug='verano', title='Curso de verano', seo={'description': 'Julio y agosto.'})
    landing.publish(user)
    for path in ('/verano', '/p/verano'):
        r = client.get(path)
        assert r.status_code == 200, path
        assert _head(r.content.decode())['canonical'] == ['https://interlaken.edu.mx/verano']


@pytest.mark.django_db
def test_sitemap_lists_the_built_routes_minus_noindex(client, built_site):
    from apps.content.navigation import SITEMAP_CACHE_KEY
    cache.delete(SITEMAP_CACHE_KEY)
    xml = client.get('/sitemap.xml').content.decode()
    locs = re.findall(r'<loc>([^<]+)</loc>', xml)
    assert 'https://interlaken.edu.mx/admisiones' in locs
    assert 'https://interlaken.edu.mx/inscripcion' not in locs


def test_apply_head_rewrites_title_description_image_and_noindex():
    html = ('<html><head><title>Colegio Interlaken</title>'
            '<meta name="description" content="x" /><meta property="og:title" content="x" />'
            '<meta property="og:description" content="x" /><meta property="og:image" content="old.png" />'
            '<meta property="og:image:width" content="1200" /><meta name="twitter:image" content="old.png" />'
            '</head><body></body></html>')
    cms = {'title': 'Verano & más', 'description': 'Curso "de" verano', 'image': 'https://s/api/v1/content/media/3/lg/', 'noindex': True}
    out = spa.apply_head(html, spa._cms_refine({}, cms), '/verano')
    assert '<title>Verano &amp; más · Colegio Interlaken</title>' in out
    assert '<meta name="description" content="Curso &quot;de&quot; verano" />' in out
    assert '<meta property="og:image" content="https://s/api/v1/content/media/3/lg/" />' in out
    assert '<meta property="og:image:width" content="1200" />' in out          # untouched
    assert '<meta name="robots" content="noindex" />' in out
    assert spa.apply_head(html, spa._cms_refine({}, {'title': '', 'description': '', 'image': ''}), '/verano') == html


@pytest.mark.django_db
def test_published_head_follows_publish_and_unpublish(admin_user):
    from apps.content.pages import Page, published_head

    cache.clear()
    assert published_head('/nosotros') is None
    page = Page.objects.create(slug='nosotros', title='Nosotros', seo={'title': 'Quiénes somos', 'og_image': 5},
                               draft_blocks=[{'id': 'h', 'type': 'home.hero', 'props': {'title': 'Hola'}}])
    page.publish(admin_user)
    head = published_head('/nosotros/')
    assert head['title'] == 'Quiénes somos' and head['image'].endswith('/api/v1/content/media/5/lg/')
    page.unpublish(admin_user)
    assert published_head('/nosotros') is None                  # cache busted on unpublish
