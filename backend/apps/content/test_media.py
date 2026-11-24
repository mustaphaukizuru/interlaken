"""P3-1: media library upload, variants, public serving, delete."""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.content.media import MediaAsset

pytestmark = pytest.mark.django_db


def _png(w=1400, h=900):
    buf = io.BytesIO()
    Image.new('RGB', (w, h), (64, 26, 142)).save(buf, format='PNG')
    return SimpleUploadedFile('campus.png', buf.getvalue(), content_type='image/png')


def test_upload_generates_variants_and_serves_publicly(api_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(user=AdminFactory())
    resp = api_client.post(reverse('admin-media'), {'file': _png(), 'alt': 'Campus', 'tags': 'campus,hero'}, format='multipart')
    assert resp.status_code == 201, resp.data
    data = resp.data
    assert data['width'] == 1400 and set(data['urls']) >= {'original', 'thumb', 'md'} and 'lg' not in data['urls']
    api_client.force_authenticate(user=None)
    pub = api_client.get(data['urls']['md'])
    assert pub.status_code == 200 and pub['Content-Type'] == 'image/webp' and 'immutable' in pub['Cache-Control']
    etag = pub['ETag']
    assert api_client.get(data['urls']['md'], HTTP_IF_NONE_MATCH=etag).status_code == 304
    assert api_client.get(data['urls']['original']).status_code == 200


def test_validation_and_permissions(api_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(user=ParentFactory())
    assert api_client.get(reverse('admin-media')).status_code == 403
    api_client.force_authenticate(user=AdminFactory())
    bad = api_client.post(reverse('admin-media'), {'file': SimpleUploadedFile('x.txt', b'hi', content_type='text/plain')}, format='multipart')
    assert bad.status_code == 400 and 'file' in bad.data


def test_patch_alt_and_delete_removes_files(api_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(user=AdminFactory())
    asset_id = api_client.post(reverse('admin-media'), {'file': _png(500, 300)}, format='multipart').data['id']
    upd = api_client.patch(reverse('admin-media-detail', args=[asset_id]), {'alt': 'Patio'}, format='json')
    assert upd.status_code == 200 and upd.data['alt'] == 'Patio'
    assert api_client.delete(reverse('admin-media-detail', args=[asset_id])).status_code == 204
    assert not MediaAsset.objects.filter(pk=asset_id).exists()
    assert api_client.get(f'/api/v1/content/media/{asset_id}/original/').status_code == 404


def test_single_delete_refuses_referenced_asset(api_client, settings, tmp_path):
    from apps.content.pages import Page

    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(user=AdminFactory())
    asset_id = api_client.post(reverse('admin-media'), {'file': _png(500, 300), 'alt': 'Patio'},
                               format='multipart').data['id']
    page = Page.objects.create(slug='galeria', title='Galería',
                               draft_blocks=[{'id': 'g', 'type': 'image', 'props': {'image': asset_id}}])
    resp = api_client.delete(reverse('admin-media-detail', args=[asset_id]))
    assert resp.status_code == 409 and 'se usa en una página o comunicado' in resp.data['detail']
    assert MediaAsset.objects.filter(pk=asset_id).exists()
    page.draft_blocks = []
    page.save()
    assert api_client.delete(reverse('admin-media-detail', args=[asset_id])).status_code == 204


# QA sweep 2026-11-24: the library trusted the declared Content-Type.
@pytest.mark.parametrize('name, body', [
    ('x.png', b'<html><script>alert(1)</script></html>'),
    ('x.png', b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    ('x.jpg', b'\xff\xd8\xff\xe0 not really a jpeg'),
    ('x.gif', b'GIF89a'),
])
def test_non_image_declared_as_image_is_400(api_client, settings, tmp_path, name, body):
    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(user=AdminFactory())
    upload = SimpleUploadedFile(name, body, content_type='image/png')
    resp = api_client.post(reverse('admin-media'), {'file': upload}, format='multipart')
    assert resp.status_code == 400 and 'file' in resp.data
    assert not MediaAsset.objects.exists()


def test_truncated_png_is_400(api_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(user=AdminFactory())
    data = _png(300, 200).read()
    upload = SimpleUploadedFile('cut.png', data[: len(data) // 2], content_type='image/png')
    resp = api_client.post(reverse('admin-media'), {'file': upload}, format='multipart')
    assert resp.status_code == 400


@pytest.mark.parametrize('fmt, declared, stored', [
    ('JPEG', 'image/jpeg', 'image/jpeg'), ('WEBP', 'image/webp', 'image/webp'),
    ('GIF', 'image/gif', 'image/gif'),
    # A real PNG labelled JPEG is stored (and served) as what it is.
    ('PNG', 'image/jpeg', 'image/png'),
])
def test_real_images_are_stored_with_their_real_type(api_client, settings, tmp_path, fmt, declared, stored):
    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(user=AdminFactory())
    buf = io.BytesIO()
    Image.new('RGB', (400, 300), (10, 120, 60)).save(buf, format=fmt)
    upload = SimpleUploadedFile(f'foto.{fmt.lower()}', buf.getvalue(), content_type=declared)
    resp = api_client.post(reverse('admin-media'), {'file': upload}, format='multipart')
    assert resp.status_code == 201, resp.data
    assert resp.data['content_type'] == stored
    assert resp.data['width'] == 400 or fmt == 'GIF'
