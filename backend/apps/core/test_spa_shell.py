import copy

import pytest
from django.template import engines

from apps.core import spa


@pytest.mark.django_db
def test_spa_index_injects_shell_only_for_known_routes(client, settings, tmp_path):
    (tmp_path / 'index.html').write_text('<html><body><div id="root"><!--SHELL--></div></body></html>', encoding='utf-8')
    (tmp_path / 'shells.json').write_text('{"/": "<div data-shell>Formando líderes</div>", "/admisiones": "<h1 data-shell>Admisiones</h1>"}', encoding='utf-8')
    # Replace the whole TEMPLATES attribute (never mutate the nested dict:
    # pytest-django restores only attribute assignments, and the cached template
    # engines would keep leaking tmp_path into every later test).
    templates = copy.deepcopy(settings.TEMPLATES)
    templates[0]['DIRS'] = [str(tmp_path)]
    settings.TEMPLATES = templates
    settings.STATICFILES_DIRS = [str(tmp_path)]
    spa._shells.cache_clear()
    spa._index_html.cache_clear()
    engines._engines.clear()
    try:
        home = client.get('/').content.decode()
        assert 'data-shell' in home and 'Formando líderes' in home and '<!--SHELL-->' not in home
        adm = client.get('/admisiones/').content.decode()
        assert 'Admisiones' in adm
        portal = client.get('/portal/cafeteria').content.decode()
        assert 'data-shell' not in portal and '<div id="root"></div>' in portal
    finally:
        # The settings fixture reverts TEMPLATES after this test; drop every
        # cache that captured the temporary engine or files.
        spa._shells.cache_clear()
        spa._index_html.cache_clear()
        engines._engines.clear()


def test_apply_head_rewrites_title_description_image_and_noindex():
    html = ('<html><head><title>Colegio Interlaken</title>'
            '<meta name="description" content="x" /><meta property="og:title" content="x" />'
            '<meta property="og:description" content="x" /><meta property="og:image" content="old.png" />'
            '<meta property="og:image:width" content="1200" /><meta name="twitter:image" content="old.png" />'
            '</head><body></body></html>')
    out = spa.apply_head(html, {'title': 'Verano & más', 'description': 'Curso "de" verano', 'image': 'https://s/api/v1/content/media/3/lg/', 'noindex': True})
    assert '<title>Verano &amp; más · Colegio Interlaken</title>' in out
    assert '<meta name="description" content="Curso &quot;de&quot; verano" />' in out
    assert '<meta property="og:image" content="https://s/api/v1/content/media/3/lg/" />' in out
    assert '<meta property="og:image:width" content="1200" />' in out          # untouched
    assert '<meta name="robots" content="noindex" />' in out
    assert spa.apply_head(html, {'title': '', 'description': '', 'image': ''}) == html


@pytest.mark.django_db
def test_published_cms_page_skips_the_stale_shell_and_sets_its_head(admin_user):
    from django.core.cache import cache

    from apps.content.pages import Page, published_head

    cache.clear()
    assert published_head('/nosotros') is None
    page = Page.objects.create(slug='nosotros', title='Nosotros', seo={'title': 'Quiénes somos', 'og_image': 5},
                               draft_blocks=[{'id': 'h', 'type': 'home.hero', 'props': {'title': 'Hola'}}])
    page.publish(admin_user)
    head = published_head('/nosotros/')
    assert head['title'] == 'Quiénes somos' and head['image'].endswith('/api/v1/content/media/5/lg/')
    assert published_head('/niveles/primaria') is None          # nested paths map through SLUG_PATHS only
    page.unpublish(admin_user)
    assert published_head('/nosotros') is None                  # cache busted on unpublish
