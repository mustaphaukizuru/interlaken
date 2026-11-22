"""Structured, labelled CMS errors (editor round, contract C3).

Save and publish errors keep `detail` and add `errors`: one entry per problem
with the section (index, id, label) and the field (path and Spanish label), so
the editor can show each one next to its field. No message names a prop key.
"""
import re

import pytest
from django.core.files.base import ContentFile
from django.urls import reverse

from apps.content.checks import run_checks
from apps.content.media import MediaAsset
from apps.content.pages import Page, field_label, field_path, manifest

ERROR_KEYS = {'block_index', 'block_id', 'block_label', 'field', 'field_label', 'message'}
RAW_KEY = re.compile(r'"(title|cta|href|image|images|items|photos|html)"')


def _asset(alt=''):
    a = MediaAsset(filename='patio.png', content_type='image/png', alt=alt)
    a.file.save('patio.png', ContentFile(b'x'), save=False)
    a.save()
    return a


def test_manifest_labels_every_field_path():
    m = manifest()
    assert m['costos.prices']['labels']['feesTitle'] == 'Inscripción: título'
    assert m['galeria.grid']['labels']['photos[].image'] == 'Foto'
    for t, entry in m.items():
        for name in entry['required']:
            assert entry['labels'].get(name), f'{t}.{name} has no label'


def test_field_paths_and_labels_never_show_keys():
    assert field_label('feature_grid', 'items.2.title') == 'Tarjetas › elemento 3 › Título'
    assert field_label('galeria.grid', 'photos.0.image') == 'Fotos › elemento 1 › Foto'
    assert field_path('cta_band', 'cta.href') == 'cta'
    assert field_path('nivel.others', 'items.0.href') == 'items.0.href'
    assert field_label('hero', 'no_such_key') == ''


@pytest.mark.django_db
def test_save_with_invalid_blocks_returns_located_errors(admin_client):
    page = Page.objects.create(slug='t', title='T', draft_blocks=[])
    r = admin_client.patch(reverse('admin-page-detail', args=[page.pk]),
                           {'draft_blocks': [{'id': 'ok', 'type': 'rich_text', 'props': {'html': '<p>x</p>'}},
                                             {'id': 'h1', 'type': 'hero', 'props': {}}]}, format='json')
    assert r.status_code == 400
    assert r.data['detail'] and r.data['draft_blocks']['blocks'] == [r.data['detail']]
    assert r.data['detail'] == 'Sección 2 (Portada (hero)), campo «Título»: falta este dato.'
    assert not RAW_KEY.search(r.data['detail'])
    [e] = r.data['errors']
    assert set(e) == ERROR_KEYS
    assert (e['block_index'], e['block_id'], e['block_label'], e['field'], e['field_label']) == (1, 'h1', 'Portada (hero)', 'title', 'Título')
    # Unknown types are named in words too.
    r = admin_client.post(reverse('admin-pages'), {'slug': 'x', 'title': 'X', 'draft_blocks': [{'type': 'nope', 'props': {}}]}, format='json')
    assert r.status_code == 400 and r.data['errors'][0]['block_index'] == 0 and 'nope' not in r.data['detail']


@pytest.mark.django_db
def test_publish_errors_name_section_and_field(admin_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    no_alt = _asset('')
    page = Page.objects.create(slug='t', title='T', draft_blocks=[
        {'id': 'a', 'type': 'hero', 'props': {'title': ''}},
        {'id': 'b', 'type': 'cta_band', 'props': {'title': 'x', 'cta': {'label': 'Ir', 'href': '/no-existe'}}},
        {'id': 'c', 'type': 'galeria.grid', 'props': {'photos': [{'image': '/assets/facade.webp'}, {'image': no_alt.pk}], 'filters': []}},
        {'id': 'd', 'type': 'nivel.others', 'props': {'title': 'x', 'items': [{'name': 'Otro', 'href': '/tampoco'}]}},
    ])
    r = admin_client.post(reverse('admin-page-publish', args=[page.pk]), {'action': 'publish'}, format='json')
    assert r.status_code == 409 and r.data['code'] == 'publish_blocked'
    assert r.data['detail'].startswith('Corrija antes de publicar:')
    assert not RAW_KEY.search(r.data['detail'])
    by_block = {e['block_id']: e for e in r.data['errors']}
    # Publish errors are whole review issues (publish_checks): the C3 keys plus code, fix…
    assert all(ERROR_KEYS <= set(e) for e in r.data['errors'])
    assert (by_block['a']['field'], by_block['a']['field_label'], by_block['a']['block_index']) == ('title', 'Título', 0)
    assert (by_block['b']['field'], by_block['b']['field_label']) == ('cta', 'Botón')
    assert 'Enlace roto' in by_block['b']['message']
    assert (by_block['c']['field'], by_block['c']['field_label']) == ('photos.1.image', 'Fotos › elemento 2 › Foto')
    assert 'texto alternativo' in by_block['c']['message']
    assert (by_block['d']['field'], by_block['d']['field_label']) == ('items.0.href', 'Tarjetas › elemento 1 › Enlace')


@pytest.mark.django_db
def test_checks_issues_carry_location_and_short_message(admin_client):
    page = Page.objects.create(slug='t', title='T', draft_blocks=[
        {'id': 'x', 'type': 'rich_text', 'props': {'html': '<p></p>'}},
        {'id': 'y', 'type': 'faq', 'props': {'items': [{'q': 'P', 'a': '<a href="sin-barra">x</a>'}]}},
    ])
    issues = {i['code']: i for i in run_checks(page)}
    assert issues['empty_text']['field'] == 'html' and issues['empty_text']['field_label'] == 'Contenido'
    assert issues['empty_text']['field_message'] == 'No tiene contenido. Escriba el texto o elimine la sección.'
    assert issues['relative_link']['field'] == 'items.0.a' and issues['relative_link']['field_label'] == 'Preguntas › elemento 1 › Respuesta'
    assert issues['relative_link']['message'].startswith('Sección 2 (Preguntas frecuentes), campo «Preguntas › elemento 1 › Respuesta»:')
    data = admin_client.get(reverse('admin-page-checks', args=[page.pk])).data
    assert {i['code'] for i in data['issues']} >= {'empty_text', 'relative_link'}
    assert all('field_label' in i for i in data['issues'] if i['block_id'])


@pytest.mark.django_db
def test_table_limits_come_back_as_labelled_errors(admin_client):
    page = Page.objects.create(slug='t', title='T', draft_blocks=[])
    wide = {'columns': [{'label': f'C{i}'} for i in range(9)], 'rows': [['x'] * 9]}
    r = admin_client.patch(reverse('admin-page-detail', args=[page.pk]),
                           {'draft_blocks': [{'id': 'tb', 'type': 'table', 'props': {'title': 'Cuotas', 'table': wide}}]}, format='json')
    assert r.status_code == 400
    assert r.data['detail'] == 'Sección 1 (Tabla), campo «Tabla › Columnas»: la tabla admite hasta 8 columnas.'
    [e] = r.data['errors']
    assert (e['block_id'], e['field'], e['field_label'], e['message']) == ('tb', 'table', 'Tabla › Columnas', 'La tabla admite hasta 8 columnas.')
    rows = {'columns': [{'label': 'A'}], 'rows': [['x', 'y']]}
    r = admin_client.patch(reverse('admin-page-detail', args=[page.pk]),
                           {'draft_blocks': [{'id': 'tb', 'type': 'table', 'props': {'table': rows}}]}, format='json')
    assert r.status_code == 400 and r.data['errors'][0]['field_label'] == 'Tabla › Filas'
