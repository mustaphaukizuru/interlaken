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
