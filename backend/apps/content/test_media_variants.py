"""Media variants (docs/cms/safe-publish.md): a library photo too small for a size has no such
variant, and a request for it serves the next larger one or the original, never a 404."""
import io

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from apps.content.media import MediaAsset, served_variant
from apps.content.pages import Page

pytestmark = pytest.mark.django_db
IMMUTABLE = 'public, max-age=31536000, immutable'


def upload(admin_client, width: int, name: str) -> MediaAsset:
    buf = io.BytesIO()
    Image.new('RGB', (width, width // 2), (40, 120, 80)).save(buf, format='JPEG')
    r = admin_client.post(reverse('admin-media'), {'file': SimpleUploadedFile(name, buf.getvalue(), content_type='image/jpeg'), 'alt': 'Patio'},
                          format='multipart')
    assert r.status_code == 201, r.data
    return MediaAsset.objects.get(pk=r.data['id'])


def width_of(resp) -> int:
    return Image.open(io.BytesIO(b''.join(resp.streaming_content))).width


@pytest.fixture
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)


@pytest.mark.parametrize('width, variants, served', [
    # original px: variants built, and what thumb/md/lg requests get (variant, width served)
    (800, ['thumb'], {'thumb': ('thumb', 320), 'md': ('original', 800), 'lg': ('original', 800)}),
    (1600, ['thumb', 'md'], {'thumb': ('thumb', 320), 'md': ('md', 960), 'lg': ('original', 1600)}),
    (3000, ['thumb', 'md', 'lg'], {'thumb': ('thumb', 320), 'md': ('md', 960), 'lg': ('lg', 1600)}),
])
def test_missing_variant_serves_next_larger_or_original(admin_client, client, media_root, width, variants, served):
    asset = upload(admin_client, width, f'foto-{width}.jpg')
    assert sorted(asset.variants) == sorted(variants)
    for requested, (expected, px) in served.items():
        assert served_variant(asset, requested) == expected
        r = client.get(reverse('media-serve', args=[asset.pk, requested]))
        assert r.status_code == 200, (width, requested)
        assert r['Cache-Control'] == IMMUTABLE
        assert r['ETag'] == f'"{asset.sha256[:16]}-{expected}"'
        assert width_of(r) == px
        assert client.get(reverse('media-serve', args=[asset.pk, requested]), HTTP_IF_NONE_MATCH=r['ETag']).status_code == 304
    original = client.get(reverse('media-serve', args=[asset.pk, 'original']))
    assert original.status_code == 200 and original['Cache-Control'] == IMMUTABLE


def test_unknown_variant_and_missing_asset_are_404(admin_client, client, media_root):
    asset = upload(admin_client, 800, 'foto.jpg')
    assert client.get(reverse('media-serve', args=[asset.pk, 'xl'])).status_code == 404
    assert client.get(reverse('media-serve', args=[asset.pk + 99, 'lg'])).status_code == 404


def test_public_page_says_which_variants_exist(admin_client, client, media_root, admin_user):
    small, big = upload(admin_client, 800, 'chica.jpg'), upload(admin_client, 3000, 'grande.jpg')
    cache.clear()
    Page.objects.create(slug='verano', title='Verano', draft_blocks=[
        {'id': 'h', 'type': 'hero', 'props': {'title': 'Hola', 'image': small.pk}},
        {'id': 'i', 'type': 'image', 'props': {'image': big.pk}},
    ]).publish(admin_user)
    media = client.get(reverse('cms-page', args=['verano'])).json()['media']
    assert media[str(small.pk)] == {'alt': 'Patio', 'width': 800, 'height': 400, 'variants': ['thumb']}
    assert media[str(big.pk)]['variants'] == ['thumb', 'md', 'lg']
    # The admin list already exposes them as urls.
    row = next(r for r in admin_client.get(reverse('admin-media')).data['results'] if r['id'] == small.pk)
    assert set(row['urls']) == {'original', 'thumb'}
