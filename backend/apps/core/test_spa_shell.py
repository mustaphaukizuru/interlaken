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
