"""SEO titles and template defaults, and pre-publish checks without false alarms
(docs/cms/safe-publish.md)."""
import datetime as dt

import pytest
from django.core.cache import cache
from django.urls import reverse

from apps.content.checks import run_checks
from apps.content.page_templates import expand_tokens, full_title, has_template, template_seo
from apps.content.pages import Page, published_head
from apps.core import spa

pytestmark = pytest.mark.django_db

GENERIC = [{'id': 'a', 'type': 'hero', 'props': {'title': 'Costos'}},
           {'id': 'b', 'type': 'rich_text', 'props': {'html': '<p>Cifras informativas.</p>'}}]
# A designed page as «Personalizar» creates it: designed sections, built-in photos, internal links.
DESIGNED = [
    {'id': 'costos-1', 'type': 'costos.hero', 'props': {'title': 'Costos {{ciclo}}', 'image': '/assets/facade.webp',
                                                        'subtitle': 'Inscripción y colegiaturas'}},
    {'id': 'costos-2', 'type': 'costos.prices', 'props': {'note': 'Cifras informativas.',
                                                          'cta': {'label': 'Pre-registro', 'href': '/pre-registro'},
                                                          'links': [{'label': 'WhatsApp', 'href': 'https://wa.me/5215555555555'},
                                                                    {'label': 'Llamar', 'href': 'tel:+525553791188'},
                                                                    {'label': 'Documentos', 'href': '/admisiones/documentacion'},
                                                                    {'label': 'Arriba', 'href': '#precios'}]}},
]


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()


# ── SEO ─────────────────────────────────────────────────────────────────────
def test_site_name_is_never_appended_twice():
    assert full_title('Costos') == 'Costos · Colegio Interlaken'
    assert full_title('Costos · Colegio Interlaken') == 'Costos · Colegio Interlaken'
    assert full_title('Colegio Interlaken · Preescolar, Primaria y Secundaria bilingüe').count('Colegio Interlaken') == 1
    html = '<html><head><title>x</title><meta property="og:title" content="x" /></head></html>'
    out = spa.apply_head(html, {'title': 'Costos · Colegio Interlaken'})
    assert '<title>Costos · Colegio Interlaken</title>' in out and 'Interlaken · Colegio' not in out


def test_template_seo_defaults():
    assert has_template('costos') and has_template('inicio') and not has_template('verano')
    # Routed pages take their defaults from ROUTE_META (frontend/src/lib/routeMeta.ts).
    assert template_seo('costos', dt.date(2026, 11, 20))['title'] == 'Costos y colegiaturas 2026\u20132027'
    assert template_seo('costos', dt.date(2027, 1, 2))['title'] == 'Costos y colegiaturas 2027\u20132028'
    assert template_seo('inicio')['title'].startswith('Colegio Interlaken')
    assert '45 años' in expand_tokens('{{anios}} años', dt.date(2026, 5, 1))
    assert template_seo('verano') == {'title': '', 'description': ''}


def test_published_head_keeps_the_template_seo_when_the_page_has_none(admin_user):
    Page.objects.create(slug='costos', title='Costos', draft_blocks=DESIGNED, seo={}).publish(admin_user)
    head = published_head('/admisiones/costos')
    assert head['title'] == template_seo('costos')['title'] and head['description'].startswith('Costos del Colegio Interlaken')
    out = spa.apply_head('<html><head><title>x</title></head></html>', head)
    assert f'<title>{template_seo("costos")["title"]} · Colegio Interlaken</title>' in out
    Page.objects.create(slug='inicio', title='Inicio', draft_blocks=[{'id': 'h', 'type': 'home.hero', 'props': {'title': 'Hola'}}]).publish(admin_user)
    home = spa.apply_head('<html><head><title>x</title></head></html>', published_head('/'))
    assert '<title>Colegio Interlaken | Escuela bilingüe en Tlalnepantla</title>' in home      # the brand title, once


def test_seed_seo_is_exposed_for_the_editor(admin_client):
    page = Page.objects.create(slug='costos', title='Costos', draft_blocks=DESIGNED,
                               seo={'title': 'Costos · Colegio Interlaken', 'description': 'Mía'})
    assert admin_client.get(reverse('admin-page-detail', args=[page.pk])).data['seed_seo'] == {'title': 'Costos · Colegio Interlaken'}


# ── Pre-publish checks ──────────────────────────────────────────────────────
def test_a_page_published_from_the_design_has_no_issues():
    for slug in ('costos', 'inicio', 'pagos', 'no-encontrada'):
        page = Page(slug=slug, title=slug.title(), draft_blocks=DESIGNED, seo={})
        assert run_checks(page) == [], slug


def test_seo_description_warning_only_without_any_description():
    custom = Page(slug='verano', title='Verano', draft_blocks=GENERIC, seo={})
    issue = next(i for i in run_checks(custom) if i['code'] == 'seo_description')
    assert issue['level'] == 'warning' and '«Descripción SEO»' in issue['message']
    custom.seo = {'description': 'Curso de verano para alumnos.'}
    assert not run_checks(custom)


def test_seed_seo_warns_and_names_the_fields():
    page = Page(slug='inicio', title='Inicio', draft_blocks=DESIGNED,
                seo={'title': 'Colegio Interlaken · Preescolar, Primaria y Secundaria bilingüe',
                     'description': 'Colegio bilingüe con incorporación SEP. Inglés diario desde preescolar, valores y comunidad.'})
    codes = {i['code']: i['message'] for i in run_checks(page)}
    assert set(codes) == {'seed_seo', 'seo_title'}
    assert '«Título SEO» y «Descripción SEO»' in codes['seed_seo'] and '«Diseño original»' in codes['seed_seo']


def test_messages_name_the_section_and_the_field():
    page = Page(slug='costos', title='Costos', seo={}, draft_blocks=[
        {'id': 'h', 'type': 'costos.hero', 'props': {'title': ''}},
        {'id': 'p', 'type': 'costos.prices', 'props': {'links': [{'label': 'x', 'href': '/no-existe'}, {'label': 'y', 'href': 'precios'}]}},
    ])
    msgs = {i['code']: i['message'] for i in run_checks(page)}
    assert msgs['required'] == 'Sección 1 (Costos · Portada), campo «Título»: está vacío y es obligatorio.'
    assert msgs['broken_link'].startswith('Enlace roto. Sección 2 (')
    assert 'campo «Enlaces › elemento 1 › Enlace»' in msgs['broken_link']
    assert 'campo «Enlaces › elemento 2 › Enlace»' in msgs['relative_link']
