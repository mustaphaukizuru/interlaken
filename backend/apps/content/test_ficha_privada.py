"""The ficha de inscripción is private (2026-11-21).

* 0032: «Permitir iniciar la ficha sin enlace» is off by default and on the
  existing settings (reversible).
* 0033: CMS pages holding the old defaults that link to /pre-registro get the
  new ones («Agendar visita», «Solicitar informes»); a published page whose
  draft equals the live version is republished; pages the school edited are
  left alone and reported.
* /pre-registro is noindex and out of the sitemap.

Synthetic content only.
"""
from importlib import import_module

import pytest
from django.apps import apps as global_apps
from django.core.cache import cache
from django.urls import reverse

from apps.content.models import SiteSettings
from apps.content.navigation import STATIC_ROUTES, UNLISTED_SLUGS, build_sitemap
from apps.content.pages import Page, PageVersion
from apps.core import spa
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

m0032 = import_module('apps.content.migrations.0032_ficha_privada')
m0033 = import_module('apps.content.migrations.0033_ficha_privada_links')

VISIT = {'label': 'Agendar visita', 'href': '/agendar-visita'}
INFORMES_HREF = ('https://wa.me/{{whatsapp}}?text=Hola%2C%20me%20gustar%C3%ADa%20recibir%20informes%20de%20'
                 'admisi%C3%B3n%20del%20Colegio%20Interlaken.')
OLD_COSTOS_TEXT = ('Llene la ficha de inscripción para el ciclo {{ciclo}}: toma unos 15 minutos, puede continuar '
                   'después y un asesor le contactará.')


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()


def costos_blocks(primary_label='Llene la ficha de inscripción', text=OLD_COSTOS_TEXT):
    """«Costos» as «Cargar el diseño» stored it before the ficha became private."""
    return [
        {'id': 'costos-1', 'type': 'costos.hero', 'props': {'title': 'Costos {{ciclo}}', 'image': '/assets/facade.webp'}},
        {'id': 'costos-2', 'type': 'costos.prices', 'props': {
            'ctaTitle': 'Asegure el lugar de su hijo/a',
            'ctaText': text,
            'ctaPrimary': {'label': primary_label, 'href': '/pre-registro'},
            'ctaSecondary': {'label': 'Agendar visita', 'href': '/agendar-visita'},
            'noteLink': {'label': 'contacte a admisiones', 'href': '/contacto'},
        }},
    ]


def published(slug, blocks, admin_user):
    page = Page.objects.create(slug=slug, title=slug.title(), draft_blocks=blocks, seo={})
    page.publish(admin_user)
    page.refresh_from_db()
    return page


def prices(blocks):
    return next(b for b in blocks if b['type'] == 'costos.prices')['props']


# ── 0032: the public start is off ───────────────────────────────────────────
def test_public_start_is_off_by_default():
    assert SiteSettings._meta.get_field('admissions_public_start').default is False
    assert SiteSettings.load().admissions_public_start is False  # the migrated row


def test_public_start_migration_is_reversible():
    SiteSettings.load()  # the singleton row the migration updates
    m0032.turn_on(global_apps, None)
    assert SiteSettings.load().admissions_public_start is True
    m0032.turn_off(global_apps, None)
    assert SiteSettings.load().admissions_public_start is False


def test_public_start_refused_by_default(api_client):
    from apps.admissions.factories import start_payload

    resp = api_client.post(reverse('register-create'), start_payload(), format='json')
    assert resp.status_code == 403 and resp.data['code'] == 'public_start_disabled'
    assert api_client.get(reverse('ficha-schema')).json()['public_start_enabled'] is False


# ── 0033: the costos page (published, draft = live) ─────────────────────────
@pytest.mark.parametrize('label,text', [
    ('Llene la ficha de inscripción', OLD_COSTOS_TEXT),
    ('Llenar la ficha de inscripción', OLD_COSTOS_TEXT),
    # The design before the ficha (2026-11-20).
    ('Iniciar pre-registro',
     'Inicie su pre-registro para el ciclo {{ciclo}} — toma menos de 5 minutos y un asesor le contactará.'),
])
def test_published_costos_is_updated_and_republished(admin_user, capsys, label, text):
    page = published('costos', costos_blocks(label, text), admin_user)
    assert page.published_version.number == 1
    revision = page.draft_revision
    cache.set('cms:page:costos', 'stale')

    m0033.forwards(global_apps, None)

    page.refresh_from_db()
    assert page.published_version.number == 2 and page.status == 'published'
    assert page.published_version.author is None
    live = prices(page.published_version.blocks)
    assert live['ctaPrimary'] == VISIT
    assert live['ctaSecondary'] == {'label': 'Solicitar informes', 'href': INFORMES_HREF}
    assert 'ficha de inscripción' in live['ctaText'] and live['ctaText'].startswith('Agende una visita para el ciclo {{ciclo}}')
    assert live['ctaTitle'] == 'Asegure el lugar de su hijo/a'                       # not an old ficha text: kept
    assert live['noteLink'] == {'label': 'contacte a admisiones', 'href': '/contacto'}
    assert page.draft_blocks == page.published_version.blocks
    assert page.draft_revision == revision + 1                                       # an open editor gets a conflict
    assert '/pre-registro' not in str(page.published_version.blocks)
    # Version 1 stays in the history («Versiones»).
    assert prices(PageVersion.objects.get(page=page, number=1).blocks)['ctaPrimary']['href'] == '/pre-registro'
    assert cache.get('cms:page:costos') is None
    row = AuditLog.objects.filter(object_type='content.page', object_id=str(page.pk)).latest('pk')
    assert row.changes['published_version'] == 2 and row.context == 'cms.publish'
    out = capsys.readouterr().out
    assert '«costos»' in out and 'publicados (versión 2)' in out

    # Running it again changes nothing (no third version).
    m0033.forwards(global_apps, None)
    page.refresh_from_db()
    assert page.published_version.number == 2


def test_a_button_the_school_edited_is_left_alone_and_reported(admin_user, capsys):
    blocks = costos_blocks('Inscríbase hoy')
    page = published('costos', blocks, admin_user)
    m0033.forwards(global_apps, None)
    page.refresh_from_db()
    # The text still held the old default: it changes and the page republishes,
    # but the edited button and its secondary stay as the school left them.
    live = prices(page.published_version.blocks)
    assert live['ctaPrimary'] == {'label': 'Inscríbase hoy', 'href': '/pre-registro'}
    assert live['ctaSecondary'] == VISIT
    out = capsys.readouterr().out
    assert '«costos»: todavía enlaza a /pre-registro' in out and 'ctaPrimary' in out


def test_a_page_with_unpublished_edits_is_left_alone_and_reported(admin_user, capsys):
    page = published('costos', costos_blocks(), admin_user)
    draft = costos_blocks()
    draft[0]['props']['title'] = 'Costos (borrador del colegio)'
    Page.objects.filter(pk=page.pk).update(draft_blocks=draft)

    m0033.forwards(global_apps, None)

    page.refresh_from_db()
    assert page.published_version.number == 1
    assert page.draft_blocks == draft
    assert prices(page.published_version.blocks)['ctaPrimary']['href'] == '/pre-registro'
    assert '«costos»: tiene cambios sin publicar; no se modificó' in capsys.readouterr().out


def test_an_unpublished_page_gets_the_new_draft_only():
    page = Page.objects.create(slug='costos', title='Costos', draft_blocks=costos_blocks())
    m0033.forwards(global_apps, None)
    page.refresh_from_db()
    assert page.status == 'draft' and page.published_version_id is None
    assert not PageVersion.objects.filter(page=page).exists()
    assert prices(page.draft_blocks)['ctaPrimary'] == VISIT


def test_backwards_is_a_no_op(admin_user):
    page = published('costos', costos_blocks(), admin_user)
    m0033.forwards(global_apps, None)
    page.refresh_from_db()
    before = (page.published_version_id, page.draft_blocks)
    m0033.backwards(global_apps, None)
    page.refresh_from_db()
    assert (page.published_version_id, page.draft_blocks) == before


# ── 0033: the other designs ─────────────────────────────────────────────────
def test_home_admisiones_and_acceso_defaults(admin_user):
    home = published('inicio', [
        {'id': 'h', 'type': 'home.hero', 'props': {'title': 'Formando líderes',
                                                    'primary': {'label': 'Llene la ficha de inscripción', 'href': '/pre-registro'},
                                                    'secondary': {'label': 'Portal Cafetería', 'href': '/login'}}},
        {'id': 'v', 'type': 'home.video', 'props': {'primary': {'label': 'Agendar una visita', 'href': '/agendar-visita'},
                                                     'secondary': {'label': 'Ver la galería', 'href': '/galeria'}}},
        {'id': 'c', 'type': 'home.cta', 'props': {
            'title': 'Comience el futuro de su hijo hoy',
            'text': 'Agende una visita o llene en línea la ficha de inscripción: unos 15 minutos, y puede continuar después.',
            'primary': {'label': 'Llene la ficha de inscripción', 'href': '/pre-registro'},
            'secondary': {'label': 'Agendar visita', 'href': '/agendar-visita'}}},
    ], admin_user)
    admisiones = Page.objects.create(slug='admisiones', title='Admisiones', draft_blocks=[
        {'id': 's', 'type': 'admisiones.steps', 'props': {'items': [
            {'icon': 'WhatsApp', 'step': '01', 'key': 'informes', 'title': 'Informes', 'text': 'x', 'link': {'label': '', 'href': ''}},
            {'icon': 'FileText', 'step': '03', 'key': 'documentacion', 'title': 'Documentación',
             'text': 'Consulte la lista de documentos requeridos, con enlaces a trámites oficiales.', 'color': 'var(--pink)',
             'link': {'label': 'Ver documentación', 'href': '/admisiones/documentacion'}},
            {'icon': 'ClipboardList', 'step': '04', 'key': 'inscripcion', 'title': 'Inscripción',
             'text': 'Complete el pre-registro en línea en menos de 5 minutos y asegure su lugar.', 'color': 'var(--green)',
             'link': {'label': 'Iniciar pre-registro', 'href': '/pre-registro'}},
        ]}},
        {'id': 'f', 'type': 'admisiones.faq', 'props': {'items': [
            {'cat': 'Niveles', 'q': '¿Qué niveles?', 'a': 'Tres.'},
            {'cat': 'Inscripción', 'q': '¿Cuánto tarda la ficha de inscripción en línea?',
             'a': 'Unos 15 minutos. Se guarda en cada paso, así que puede dejarla y continuar después con el enlace que le '
                  'enviamos a su correo. Un asesor le contactará en un plazo de 2 días hábiles.'},
        ]}},
    ])
    acceso = Page.objects.create(slug='iniciar-sesion', title='Acceso', draft_blocks=[
        {'id': 'a', 'type': 'acceso.screen', 'props': {
            'signupText': '¿No tiene cuenta?', 'signupLink': {'label': 'Llene la ficha de inscripción', 'href': '/pre-registro'}}},
    ])

    m0033.forwards(global_apps, None)

    home.refresh_from_db()
    blocks = {b['id']: b['props'] for b in home.published_version.blocks}
    assert blocks['h']['primary'] == VISIT and blocks['h']['secondary'] == {'label': 'Portal Cafetería', 'href': '/login'}
    assert blocks['v'] == {'primary': {'label': 'Agendar una visita', 'href': '/agendar-visita'},
                           'secondary': {'label': 'Ver la galería', 'href': '/galeria'}}       # no ficha: untouched
    assert blocks['c']['primary'] == VISIT and blocks['c']['secondary']['label'] == 'Solicitar informes'
    assert 'ficha' not in blocks['c']['text']

    admisiones.refresh_from_db()
    steps = admisiones.draft_blocks[0]['props']['items']
    assert steps[0]['text'] == 'x'
    assert (steps[1]['key'], steps[1]['title']) == ('examen', 'Examen de valoración')
    assert steps[2]['link'] == {'label': 'Ver costos', 'href': '/admisiones/costos'}
    assert steps[2]['text'].startswith('Si su hijo/a es admitido')
    faq = admisiones.draft_blocks[1]['props']['items']
    assert faq[0] == {'cat': 'Niveles', 'q': '¿Qué niveles?', 'a': 'Tres.'}
    assert faq[1]['q'] == '¿Cuándo se llena la ficha de inscripción?' and faq[1]['cat'] == 'Inscripción'

    acceso.refresh_from_db()
    props = acceso.draft_blocks[0]['props']
    assert props['signupLink'] == {'label': 'Conozca el proceso de admisión', 'href': '/admisiones'}
    assert props['signupText'] == '¿No tiene cuenta? Su cuenta se crea al inscribirse.'


def test_a_secondary_button_changes_only_with_its_ficha_button(admin_user):
    """«Agendar visita» stays the secondary button when the primary was not the ficha."""
    page = Page.objects.create(slug='nosotros', title='Nosotros', draft_blocks=[
        {'id': 'c', 'type': 'about.cta', 'props': {'primary': {'label': 'Contacto', 'href': '/contacto'},
                                                    'secondary': {'label': 'Agendar visita', 'href': '/agendar-visita'}}},
    ])
    m0033.forwards(global_apps, None)
    page.refresh_from_db()
    assert page.draft_blocks[0]['props']['secondary'] == VISIT


def test_generic_blocks_linking_to_the_ficha_are_reported(admin_user, capsys):
    Page.objects.create(slug='verano', title='Verano', draft_blocks=[
        {'id': 'b', 'type': 'cta_band', 'props': {'title': 'Inscríbase', 'cta': {'label': 'Ficha', 'href': '/pre-registro'}}},
        {'id': 'f', 'type': 'form', 'props': {'form': 'pre-registro'}},
    ])
    m0033.forwards(global_apps, None)
    out = capsys.readouterr().out
    assert '«verano»: todavía enlaza a /pre-registro' in out
    assert '1 (cta_band).props.cta' in out and '2 (form).props.form' in out


# ── SEO: noindex and out of the sitemap ─────────────────────────────────────
def test_pre_registro_is_not_in_the_sitemap(admin_user):
    assert '/pre-registro' not in {p for p, _f, _p in STATIC_ROUTES}
    assert 'pre-registro' in UNLISTED_SLUGS
    Page.objects.create(slug='pre-registro', title='Ficha', draft_blocks=[
        {'id': 'h', 'type': 'preregistro.hero', 'props': {'title': 'Ficha de inscripción'}},
    ]).publish(admin_user)
    xml = build_sitemap()
    assert '/pre-registro' not in xml and '<loc>https://interlaken.edu.mx/agendar-visita</loc>' in xml


def test_pre_registro_head_is_noindex(settings, tmp_path):
    """spa.py writes the route table's robots meta into /pre-registro's raw HTML."""
    (tmp_path / 'seo-routes.json').write_text(
        '{"/pre-registro": {"title": "Ficha de inscripción · Colegio Interlaken", "description": "Personal.",'
        ' "robots": "noindex", "jsonLd": []}, "/agendar-visita": {"title": "Agendar", "description": "x", "jsonLd": []}}',
        encoding='utf-8',
    )
    settings.STATICFILES_DIRS = [str(tmp_path)]
    spa.clear_caches()
    try:
        doc = '<html><head><title>x</title><!--HEAD--></head><body><div id="root"><!--SHELL--></div></body></html>'
        out = spa.apply_head(doc, spa._seo_routes()['/pre-registro'], '/pre-registro')
        assert '<meta name="robots" content="noindex" />' in out
        from apps.content.navigation import static_routes
        assert [p for p, _f, _pr in static_routes()] == ['/agendar-visita']
    finally:
        spa.clear_caches()
