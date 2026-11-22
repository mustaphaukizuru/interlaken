"""«Revisión antes de publicar» (publish_checks.py), on the incident of 2026-11-21.

Production's «costos» page had unpublished draft edits where editor token
chips were inserted by accident (``daycareYear`` «Precios 2026{{anio}}»,
``tuitionPending`` «{{ciclo}}», ``feesPending`` «{{ciclo}}{{anio}}{{anios}}»),
and its published version still had a button to /pre-registro, which is
private now. Synthetic data only.
"""
import copy
import datetime as dt
from io import StringIO

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.content import publish_checks as pc
from apps.content.pages import Page
from apps.core.models import AuditLog
from apps.portal.models import Notification

FICHA_BUTTON = {'label': 'Llene la ficha de inscripción', 'href': '/pre-registro'}
VISIT = {'label': 'Agendar visita', 'href': '/agendar-visita'}


def prices(**props):
    return {'id': 'costos-2', 'type': 'costos.prices', 'props': props}


HERO = {'id': 'costos-1', 'type': 'costos.hero', 'props': {'title': 'Costos y colegiaturas'}}
LIVE = [HERO, prices(ctaPrimary=FICHA_BUTTON)]
DRAFT = [HERO, prices(ctaPrimary=FICHA_BUTTON, daycareYear='Precios 2026{{anio}}', tuitionPending='{{ciclo}}',
                      feesPending='{{ciclo}}{{anio}}{{anios}}')]


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()


@pytest.fixture
def costos(db, admin_user):
    """«costos» as in production: the live version with the ficha button, the draft with the token slips."""
    page = Page.objects.create(slug='costos', title='Costos', draft_blocks=copy.deepcopy(LIVE))
    page.publish(admin_user)
    page.draft_blocks = copy.deepcopy(DRAFT)
    page.save()
    return Page.objects.select_related('published_version').get(pk=page.pk)


def by_code(report, code):
    return {i['field']: i for i in report['issues'] if i['code'] == code}


def year():
    return timezone.localdate().year


def apply(blocks, issue):
    """What the editor's quick fix does: the issue's field takes the fix value."""
    out = copy.deepcopy(blocks)
    b = out[issue['block_index']]
    pc.set_at(b['props'], issue['field'], copy.deepcopy(issue['fix']['value']))
    return out


# ── the incident, rule by rule ──────────────────────────────────────────────
@pytest.mark.django_db
def test_the_incident_draft_is_blocked_with_every_slip_named(costos):
    report = pc.review(costos)
    assert report['ok'] is False
    [private] = report['errors']
    assert (private['code'], private['field'], private['block_index']) == ('private_link', 'ctaPrimary', 1)
    assert 'la ficha de inscripción es personal' in private['message'].lower()
    assert private['fix'] == {'kind': 'replace_link', 'label': 'Cambiar por «Agendar visita»', 'value': VISIT,
                              'preview': 'Agendar visita → /agendar-visita'}

    glued = by_code(report, 'token_glued')['daycareYear']
    assert glued['level'] == 'warning'
    assert glued['preview'] == f'Precios 2026{year()}'
    assert f'se verá «Precios 2026{year()}»' in glued['message']
    assert glued['fix']['kind'] == 'remove_token' and glued['fix']['label'] == 'Quitar {{anio}}'
    assert glued['fix']['value'] == 'Precios 2026'

    only = by_code(report, 'token_only_label')
    assert set(only) == {'tuitionPending', 'feesPending'}
    assert only['tuitionPending']['fix'] == {'kind': 'clear', 'label': 'Vaciar', 'value': '', 'preview': ''}
    assert only['feesPending']['fix']['value'] == ''
    assert only['feesPending']['preview'] == f'{year()}–{year() + 1}{year()}{year() - 1981}'
    # One issue per slip: the pending labels are not also «glued».
    assert 'feesPending' not in by_code(report, 'token_glued')


@pytest.mark.django_db
def test_the_quick_fixes_clear_the_review(costos):
    report = pc.review(costos)
    blocks = costos.draft_blocks
    for issue in report['errors'] + report['warnings']:
        if issue['fix'] and issue['block_index'] is not None:
            blocks = apply(blocks, issue)
    after = pc.review(costos, blocks=blocks)
    assert after['ok'] is True and after['warnings'] == []
    props = blocks[1]['props']
    assert props['ctaPrimary'] == VISIT and props['daycareYear'] == 'Precios 2026'
    assert props['tuitionPending'] == '' and props['feesPending'] == ''


@pytest.mark.django_db
def test_publishing_blocked_then_warned_then_acknowledged(admin_client, costos):
    url = reverse('admin-page-publish', args=[costos.pk])
    r = admin_client.post(url, {'action': 'publish'}, format='json')
    assert r.status_code == 409 and r.data['code'] == 'publish_blocked'
    assert r.data['detail'].startswith('Corrija antes de publicar:')
    assert [e['code'] for e in r.data['errors']] == ['private_link']
    assert {w['code'] for w in r.data['warnings']} == {'token_glued', 'token_only_label'}
    assert r.data['changes']
    assert Page.objects.get(pk=costos.pk).published_version.number == 1

    # Fix the private link only: the warnings still stop it.
    page = Page.objects.get(pk=costos.pk)
    page.draft_blocks[1]['props']['ctaPrimary'] = VISIT
    page.save()
    r = admin_client.post(url, {'action': 'publish'}, format='json')
    assert r.status_code == 409 and r.data['code'] == 'publish_warnings' and r.data['errors'] == []
    keys = [w['key'] for w in r.data['warnings']]
    # A list of acknowledged keys that misses one is not enough.
    r2 = admin_client.post(url, {'action': 'publish', 'acknowledge_warnings': True, 'acknowledged_warnings': keys[:1]}, format='json')
    assert r2.status_code == 409 and r2.data['code'] == 'publish_warnings'
    r3 = admin_client.post(url, {'action': 'publish', 'acknowledge_warnings': True, 'acknowledged_warnings': keys}, format='json')
    assert r3.status_code == 200 and r3.data['version'] == 2
    audit = AuditLog.objects.filter(context='cms.publish', object_id=str(costos.pk)).order_by('-created_at').first()
    assert sorted(audit.changes['warnings_acknowledged']) == sorted(keys)


@pytest.mark.django_db
def test_a_clean_draft_publishes_straight_away(admin_client, admin_user):
    page = Page.objects.create(slug='verano', title='Verano', draft_blocks=[{'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>Hola</p>'}}])
    r = admin_client.post(reverse('admin-page-publish', args=[page.pk]), {'action': 'publish'}, format='json')
    assert r.status_code == 200 and r.data['version'] == 1


@pytest.mark.django_db
def test_checks_endpoint_reviews_the_saved_or_the_posted_draft(admin_client, costos):
    url = reverse('admin-page-checks', args=[costos.pk])
    saved = admin_client.get(url).data
    assert saved['ok'] is False and saved['baseline'] == 'published'
    assert {i['code'] for i in saved['issues']} >= {'private_link', 'token_glued', 'token_only_label'}
    # The editor posts its draft as on screen: nothing is stored.
    fixed = copy.deepcopy(costos.draft_blocks)
    fixed[1]['props'] = {'ctaPrimary': VISIT}
    posted = admin_client.post(url, {'draft_blocks': fixed}, format='json').data
    assert posted['ok'] is True and posted['warnings'] == []
    assert Page.objects.get(pk=costos.pk).draft_blocks == costos.draft_blocks
    bad = admin_client.post(url, {'draft_blocks': [{'id': 'x', 'type': 'hero', 'props': {}}]}, format='json')
    assert bad.status_code == 400 and bad.data['errors']


@pytest.mark.django_db
def test_que_cambia_shows_what_visitors_will_read(costos):
    changes = {c['field']: c for c in pc.review(costos)['changes'] if c['kind'] == 'changed'}
    assert changes['daycareYear']['before'] == 'Precios 2026'          # the design's default
    assert changes['daycareYear']['after'] == f'Precios 2026{year()}'
    assert changes['daycareYear']['after_code'] == 'Precios 2026{{anio}}'
    assert changes['feesPending']['before'] == '' and changes['feesPending']['field_label'] == 'Inscripción: aviso de precios pendientes'
    assert 'ctaPrimary' not in changes   # unchanged since the published version


# ── scheduled publishing and live pages ─────────────────────────────────────
@pytest.mark.django_db
def test_a_scheduled_publish_with_slips_stays_unpublished_and_tells_direccion(costos, admin_user, settings):
    settings.FRONTEND_URL = 'https://sitio.example'
    page = Page.objects.get(pk=costos.pk)
    page.publish_at = timezone.now() - dt.timedelta(minutes=1)
    page.draft_blocks[1]['props']['ctaPrimary'] = VISIT   # no error left: the glued token alone stops it
    page.save()
    out = StringIO()
    call_command('cms_schedule', stdout=out)
    page.refresh_from_db()
    assert page.published_version.number == 1 and page.publish_at is not None
    assert 'bloqueadas por revisión 1' in out.getvalue()
    notice = Notification.objects.get(user=admin_user, title='Publicación programada detenida: Costos')
    assert notice.notif_type == 'warning'
    assert 'quedó pegado al texto' in notice.message and 'https://sitio.example/admin/contenido/' in notice.message
    # The next run (5 minutes later) does not repeat the same notice.
    call_command('cms_schedule', stdout=StringIO())
    assert Notification.objects.filter(user=admin_user, title='Publicación programada detenida: Costos').count() == 1


@pytest.mark.django_db
def test_a_scheduled_publish_with_only_advisory_warnings_goes_live(admin_user):
    long_seo = {'description': 'x' * 170}
    page = Page.objects.create(slug='verano', title='Verano', seo=long_seo, publish_at=timezone.now() - dt.timedelta(seconds=5),
                               draft_blocks=[{'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>Hola</p>'}}])
    call_command('cms_schedule', stdout=StringIO())
    page.refresh_from_db()
    assert page.status == 'published' and page.publish_at is None


@pytest.mark.django_db
def test_a_live_page_that_breaks_reaches_the_bell(costos, admin_user):
    out = StringIO()
    call_command('cms_schedule', stdout=out)
    assert 'páginas publicadas con problemas 1' in out.getvalue()
    [notice] = Notification.objects.filter(user=admin_user, title__startswith='Página publicada con')
    assert notice.title == 'Página publicada con un problema: Costos'
    assert 'ficha de inscripción es personal' in notice.message
    problems = pc.audit_live_pages()
    assert [p.slug for p, _e in problems] == ['costos']
    assert Notification.objects.filter(user=admin_user, title__startswith='Página publicada con').count() == 1


# ── single rules ────────────────────────────────────────────────────────────
@pytest.mark.parametrize('text,fixed,removed,spaced', [
    ('Precios 2026{{anio}}', 'Precios 2026', ['{{anio}}'], False),
    ('{{anio}}2026', '2026', ['{{anio}}'], False),
    ('Hoy {{anio}}{{anio}} abierto', 'Hoy {{anio}} abierto', ['{{anio}}'], False),
    ('Ciclo{{ciclo}}', 'Ciclo {{ciclo}}', [], True),
    ('{{anios}}años de historia', '{{anios}} años de historia', [], True),
    ('Ciclo {{ciclo}}: inscripciones', None, None, None),
    ('<a href="https://wa.me/52{{whatsapp}}">Escríbanos</a>', None, None, None),
    ('[WhatsApp](https://wa.me/52{{whatsapp}})', None, None, None),
])
def test_glued_tokens(text, fixed, removed, spaced):
    got = pc.glued_fix(text)
    if fixed is None:
        assert got is None
    else:
        assert got == (fixed, removed, spaced)


@pytest.mark.parametrize('text,wrong,repaired', [
    ('Ciclo {{Ciclo}}', ['{{Ciclo}}'], 'Ciclo {{ciclo}}'),
    ('Desde {{año}}', ['{{año}}'], 'Desde {{anio}}'),
    ('Hoy {{fecha}} cerrado', ['{{fecha}}'], 'Hoy cerrado'),
    ('Precios {{anio}', ['{{anio}'], 'Precios {{anio}}'),
    ('Ciclo {{ ciclo }}', [], None),
])
def test_unknown_tokens(text, wrong, repaired):
    assert pc.unknown_tokens(text) == (wrong, repaired)


@pytest.mark.parametrize('href,target', [
    ('/pre-registro', '/pre-registro'), ('/pre-registro?nivel=primaria', '/pre-registro'),
    ('/inscripcion/documentos', '/inscripcion'), ('/inscripciones', '/inscripcion'),
    ('https://interlaken.edu.mx/pre-registro', '/pre-registro'), ('/admin/contenido', '/admin'), ('/staff', '/staff'),
    ('/confirmar-correo', '/confirmar-correo'), ('/admisiones', None), ('/agendar-visita', None),
    ('https://otro.example/pre-registro', None), ('mailto:a@b.mx', None),
])
def test_private_targets(href, target):
    assert pc.private_target(href) == target


@pytest.mark.django_db
def test_private_links_in_text_buttons_and_lists(admin_user):
    page = Page(slug='verano', title='Verano', draft_blocks=[
        {'id': 'r', 'type': 'rich_text', 'props': {'html': '<p>Antes <a href="/admin">entre aquí</a> y <a href="/contacto">contacto</a></p>'}},
        {'id': 'c', 'type': 'cta_band', 'props': {'title': 'Inscríbase', 'cta': {'label': 'Ficha', 'href': 'https://interlaken.edu.mx/inscripcion'}}},
        {'id': 'f', 'type': 'form', 'props': {'form': 'pre-registro'}},
    ])
    errors = {i['block_id']: i for i in pc.review(page)['errors'] if i['code'] == 'private_link'}
    assert errors['r']['fix']['kind'] == 'unlink'
    assert errors['r']['fix']['value'] == '<p>Antes entre aquí y <a href="/contacto">contacto</a></p>'
    assert errors['r']['message'].startswith('Sección 1 (Texto), campo «Contenido»: /admin es la consola del personal')
    assert errors['c']['fix']['value'] == {'label': 'Agendar visita', 'href': '/agendar-visita'}
    assert errors['f']['fix'] is None


@pytest.mark.django_db
def test_private_pages_may_link_to_each_other(admin_user):
    page = Page(slug='pre-registro', title='Ficha', draft_blocks=[
        {'id': 'h', 'type': 'preregistro.hero', 'props': {'title': 'Ficha', 'link': {'label': 'Documentos', 'href': '/inscripcion/documentos'}}},
    ])
    assert not [i for i in pc.review(page)['issues'] if i['code'] == 'private_link']


@pytest.mark.django_db
def test_token_only_is_fine_where_the_design_puts_a_token_alone(admin_user):
    """home.stats shows {{anios}} alone as a figure; a timeline year is {{anio}}."""
    page = Page(slug='inicio', title='Inicio', draft_blocks=[
        {'id': 's', 'type': 'home.stats', 'props': {'items': [{'value': '{{anios}}', 'label': 'Años'}]}},
        {'id': 'h', 'type': 'home.hero', 'props': {'title': '{{ciclo}}'}},
    ])
    only = {(i['block_id'], i['field']) for i in pc.review(page)['issues'] if i['code'] == 'token_only_label'}
    assert ('s', 'items.0.value') not in only
    assert ('h', 'title') in only


@pytest.mark.django_db
def test_unknown_tokens_block_publishing_and_seo_is_checked_too(admin_user):
    page = Page(slug='verano', title='Verano', seo={'title': 'Verano {{Ciclo}}', 'description': 'Curso 2026{{anio}}'}, draft_blocks=[
        {'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>Abierto {{fecha}}</p>'}},
    ])
    report = pc.review(page)
    unknown = {i['field']: i for i in report['errors'] if i['code'] == 'unknown_token'}
    assert unknown['html']['fix']['value'] == '<p>Abierto</p>' and unknown['html']['fix']['label'] == 'Quitar {{fecha}}'
    assert unknown['seo.title']['fix']['value'] == 'Verano {{ciclo}}'
    assert unknown['seo.title']['fix']['label'] == 'Cambiar por {{ciclo}}'
    assert unknown['seo.title']['message'].startswith('SEO, campo «Título SEO»:')
    glued = [i for i in report['warnings'] if i['code'] == 'token_glued']
    assert [g['field'] for g in glued] == ['seo.description'] and glued[0]['fix']['value'] == 'Curso 2026'


@pytest.mark.django_db
def test_retired_defaults_and_emptied_texts(admin_user):
    old_text = 'Agende una visita o inicie su pre-registro en línea en solo unos minutos.'
    page = Page.objects.create(slug='inicio', title='Inicio', draft_blocks=[
        {'id': 'inicio-1', 'type': 'home.hero', 'props': {'title': 'Bienvenidos'}},
        {'id': 'c', 'type': 'home.cta', 'props': {'title': 'Visítenos', 'text': old_text}},
    ])
    page.publish(admin_user)
    page.draft_blocks[0]['props']['title'] = 'Bienvenidos'
    page.draft_blocks[1]['props']['title'] = ''
    page.save()
    report = pc.review(Page.objects.get(pk=page.pk))
    retired = by_code(report, 'restored_old_default')['text']
    assert retired['fix']['kind'] == 'restore' and 'pre-registro' not in retired['fix']['value']
    emptied = by_code(report, 'empty_required')['title']
    assert emptied['block_id'] == 'c' and emptied['fix']['value'] == 'Visítenos'
    assert 'Antes decía «Visítenos»' in emptied['message']


@pytest.mark.django_db
def test_large_change_is_one_warning_without_a_fix(admin_user):
    blocks = [{'id': f'b{n}', 'type': 'rich_text', 'props': {'html': f'<p>Texto {n}</p>'}} for n in range(4)]
    page = Page.objects.create(slug='verano', title='Verano', draft_blocks=blocks)
    page.publish(admin_user)
    page.draft_blocks = [blocks[0], {**blocks[1], 'hidden': True}]
    page.save()
    report = pc.review(Page.objects.get(pk=page.pk))
    [big] = [w for w in report['warnings'] if w['code'] == 'large_change']
    assert big['fix'] is None
    assert big['message'] == 'Este borrador quita 2 secciones («Texto», «Texto») y oculta 1 sección. Revise «Qué cambia» antes de publicar.'
    kinds = [c['kind'] for c in report['changes']]
    assert kinds.count('removed') == 2 and kinds.count('hidden') == 1


# ── «Contenido» chips, discard, unpublished_since ───────────────────────────
@pytest.mark.django_db
def test_checks_summary_names_the_problem_in_constant_queries(admin_client, costos, admin_user, django_assert_max_num_queries):
    for n in range(4):
        Page.objects.create(slug=f'p{n}', title=f'P{n}', draft_blocks=[{'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>x</p>'}}]).publish(admin_user)
    url = reverse('admin-pages-checks-summary')
    with django_assert_max_num_queries(12):
        r = admin_client.get(url)
    rows = {row['slug']: row for row in r.data['results']}
    assert rows['costos']['draft']['first_error'] == {'code': 'private_link', 'label': 'enlace privado'}
    assert rows['costos']['draft']['warnings'] == 3
    assert rows['costos']['live']['errors'] == 1 and rows['costos']['has_unpublished_changes'] is True
    assert rows['p0']['draft'] == {'errors': 0, 'warnings': 0, 'first_error': None, 'first_warning': None}
    assert rows['p0']['unpublished_since'] is None
    # More pages, same queries.
    for n in range(4, 12):
        Page.objects.create(slug=f'p{n}', title=f'P{n}', draft_blocks=[]).publish(admin_user)
    with django_assert_max_num_queries(12):
        assert admin_client.get(url).status_code == 200


@pytest.mark.django_db
def test_discard_returns_the_draft_to_the_published_version(admin_client, costos):
    url = reverse('admin-page-discard', args=[costos.pk])
    assert admin_client.post(url, {'draft_revision': costos.draft_revision + 5}, format='json').status_code == 409
    r = admin_client.post(url, {'draft_revision': costos.draft_revision}, format='json')
    assert r.status_code == 200 and r.data['has_unpublished_changes'] is False and r.data['unpublished_since'] is None
    page = Page.objects.get(pk=costos.pk)
    assert page.draft_blocks == LIVE and page.published_version.number == 1
    fresh = Page.objects.create(slug='nueva', title='Nueva', draft_blocks=[])
    assert admin_client.post(reverse('admin-page-discard', args=[fresh.pk]), {}, format='json').status_code == 400


@pytest.mark.django_db
def test_unpublished_since_starts_with_the_first_unpublished_edit(admin_user):
    page = Page.objects.create(slug='verano', title='Verano', draft_blocks=[{'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>1</p>'}}])
    assert page.unpublished_since is not None   # never published
    page.publish(admin_user)
    page.refresh_from_db()
    assert page.unpublished_since is None
    page.draft_blocks = [{'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>2</p>'}}]
    page.save()
    first = page.unpublished_since
    assert first is not None
    page.draft_blocks = [{'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>3</p>'}}]
    page.save(update_fields=['draft_blocks'])
    page.refresh_from_db()
    assert page.unpublished_since == first
    page.draft_blocks = [{'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>1</p>'}}]
    page.save(update_fields=['draft_blocks'])
    page.refresh_from_db()
    assert page.unpublished_since is None   # back to what is published


@pytest.mark.django_db
def test_bulk_publish_skips_pages_with_warnings(admin_client, costos):
    page = Page.objects.get(pk=costos.pk)
    page.draft_blocks[1]['props']['ctaPrimary'] = VISIT
    page.save()
    r = admin_client.post(reverse('admin-pages-bulk'), {'action': 'publish', 'ids': [page.pk]}, format='json')
    assert r.status_code == 200
    assert Page.objects.get(pk=page.pk).published_version.number == 1
    assert 'advertencias' in str(r.data)
