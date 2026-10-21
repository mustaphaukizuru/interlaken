"""Designed sections in the CMS (docs/CMS-COMPLETION-PLAN.md)."""
import pytest
from django.core.cache import cache
from django.urls import reverse
from rest_framework import serializers

from apps.content.checks import run_checks
from apps.content.media import MediaAsset
from apps.content.ops import referenced_media_ids
from apps.content.pages import BLOCK_SCHEMAS, Page, image_refs, manifest, validate_blocks


def test_manifest_lists_every_generic_block_and_the_page_sections():
    types = manifest()
    generic = {t for t in types if '.' not in t}
    assert generic == set(BLOCK_SCHEMAS), 'frontend generic blocks and BLOCK_SCHEMAS drifted'
    assert {'home.hero', 'home.stats', 'page.hero'} <= set(types)
    assert types['home.hero']['images'] == ['poster']


def test_validate_keeps_hidden_and_rejects_unknown_sections():
    out = validate_blocks([{'id': 'a', 'type': 'home.stats', 'props': {'items': []}, 'hidden': True},
                           {'id': 'b', 'type': 'home.hero', 'props': {'title': 'Hola'}}])
    assert out[0]['hidden'] is True and 'hidden' not in out[1]
    with pytest.raises(serializers.ValidationError):
        validate_blocks([{'type': 'home.nope', 'props': {}}])
    with pytest.raises(serializers.ValidationError):
        validate_blocks([{'type': 'home.hero', 'props': {}}])   # required title


def test_image_refs_follow_manifest_paths():
    assert image_refs({'type': 'home.hero', 'props': {'poster': 7}}) == [7]
    assert image_refs({'type': 'home.levels', 'props': {'items': [{'image': 3}, {'image': '/assets/x.webp'}]}}) == [3]
    assert image_refs({'type': 'gallery', 'props': {'images': [{'image': 4}]}}) == [4]


@pytest.mark.django_db
def test_public_payload_strips_hidden_blocks_and_serves_alt(admin_user, client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    cache.clear()
    asset = MediaAsset.objects.create(filename='f.webp', content_type='image/webp', size=1, sha256='x' * 64, alt='Fachada', width=10, height=5)
    page = Page.objects.create(slug='inicio', title='Inicio', draft_blocks=validate_blocks([
        {'id': 'h', 'type': 'home.hero', 'props': {'title': 'Hola', 'poster': asset.pk}},
        {'id': 's', 'type': 'home.stats', 'props': {'items': []}, 'hidden': True},
    ]))
    page.publish(admin_user)
    data = client.get(reverse('cms-page', args=['inicio'])).json()
    assert [b['id'] for b in data['blocks']] == ['h']
    assert data['media'] == {str(asset.pk): {'alt': 'Fachada', 'width': 10, 'height': 5}}
    assert asset.pk in referenced_media_ids()


@pytest.mark.django_db
def test_checks_accept_site_photos_skip_hidden_and_flag_hidden_locked(admin_user):
    locked = next((t for t, e in manifest().items() if e.get('locked')), None)
    blocks = [
        {'id': 'h', 'type': 'home.hero', 'props': {'title': 'Hola', 'poster': '/assets/court-wide.webp', 'primary': {'label': 'x', 'href': '/no-existe'}}},
        {'id': 'x', 'type': 'home.hero', 'props': {'title': '', 'primary': {'href': '/tampoco'}}, 'hidden': True},
    ]
    if locked:
        blocks.append({'id': 'l', 'type': locked, 'props': {}, 'hidden': True})
    page = Page.objects.create(slug='prueba', title='Prueba', seo={'description': 'ok'}, draft_blocks=blocks)
    issues = run_checks(page)
    codes = [(i['code'], i['block_id']) for i in issues]
    assert ('broken_link', 'h') in codes                       # links inside section props are checked
    assert not any(bid == 'x' for _c, bid in codes)            # hidden blocks are skipped
    assert not any(c in ('missing_image', 'missing_alt') for c, _b in codes)
    if locked:
        assert ('locked_hidden', 'l') in codes


@pytest.mark.django_db
def test_checks_warn_when_the_social_image_was_deleted():
    page = Page.objects.create(slug='redes', title='Redes', seo={'description': 'ok', 'og_image': 999},
                               draft_blocks=[{'id': 'h', 'type': 'home.hero', 'props': {'title': 'Hola'}}])
    assert 'missing_og_image' in [i['code'] for i in run_checks(page)]
