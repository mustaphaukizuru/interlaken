import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image


def _png(w=600, h=400):
    buf = io.BytesIO()
    Image.new('RGB', (w, h), (200, 30, 30)).save(buf, format='PNG')
    return SimpleUploadedFile('me.png', buf.getvalue(), content_type='image/png')


@pytest.mark.django_db
def test_upload_serve_and_delete_avatar(auth_client, parent_user, client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    url = reverse('my-avatar')
    assert auth_client.post(url, {}, format='multipart').status_code == 400
    bad = SimpleUploadedFile('x.txt', b'hi', content_type='text/plain')
    assert auth_client.post(url, {'file': bad}, format='multipart').status_code == 400
    r = auth_client.post(url, {'file': _png()}, format='multipart')
    assert r.status_code == 200 and r.data['has_custom_avatar'] is True
    assert r.data['avatar'].startswith('/api/v1/accounts/avatar/')
    # /me reflects it; the served file is a 256px square webp, public by token
    assert auth_client.get(reverse('current-user')).data['avatar'] == r.data['avatar']
    served = client.get(r.data['avatar'])
    assert served.status_code == 200 and served['Content-Type'] == 'image/webp'
    img = Image.open(io.BytesIO(b''.join(served.streaming_content)))
    assert img.size == (256, 256)
    assert client.get(r.data['avatar'].replace(r.data['avatar'].rstrip('/').split('/')[-1], 'badtoken')).status_code == 404
    # delete → falls back to Google picture
    parent_user.avatar = 'https://lh3.googleusercontent.com/x'
    parent_user.save()
    r = auth_client.delete(url)
    assert r.status_code == 200 and r.data['has_custom_avatar'] is False and r.data['avatar'] == 'https://lh3.googleusercontent.com/x'
