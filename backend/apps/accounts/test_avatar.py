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
def test_upload_serve_and_delete_avatar(admin_client, admin_user, client, settings, tmp_path):
    # Staff manage their own photo; families cannot (bitácora 10, test_profile_lock.py).
    auth_client, parent_user = admin_client, admin_user
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


# QA sweep 2026-11-24: the 5 MB file cap did not bound memory (a 9400x9400 PNG
# decoded to ~380 MB). The size is read from the header before decoding.
def _png_claiming(width, height):
    """A real PNG whose IHDR claims ``width`` x ``height``: opening it reads
    only the header, decoding it would fail (or eat hundreds of MB)."""
    import struct
    import zlib

    buf = io.BytesIO()
    Image.new('RGB', (8, 8), (1, 2, 3)).save(buf, format='PNG')
    data = bytearray(buf.getvalue())
    ihdr = 8 + 4 + 4                     # signature, chunk length, b'IHDR'
    data[ihdr:ihdr + 8] = struct.pack('>II', width, height)
    crc = zlib.crc32(bytes(data[ihdr - 4:ihdr + 13])) & 0xFFFFFFFF
    data[ihdr + 13:ihdr + 17] = struct.pack('>I', crc)
    return SimpleUploadedFile('huge.png', bytes(data), content_type='image/png')


def _jpeg(w, h):
    buf = io.BytesIO()
    Image.new('RGB', (w, h), (30, 120, 200)).save(buf, format='JPEG', quality=70)
    return SimpleUploadedFile('camera.jpg', buf.getvalue(), content_type='image/jpeg')


@pytest.mark.django_db
def test_huge_pixel_count_is_refused_before_decoding(admin_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    r = admin_client.post(reverse('my-avatar'), {'file': _png_claiming(9400, 9400)},
                          format='multipart')
    assert r.status_code == 400
    assert 'demasiado grande' in r.data['file'][0]


@pytest.mark.django_db
def test_square_webp_raises_image_too_large():
    from apps.accounts.avatar import ImageTooLarge, _square_webp

    with pytest.raises(ImageTooLarge):
        _square_webp(_png_claiming(4097, 4096).read())


@pytest.mark.django_db
def test_big_camera_jpeg_still_works(admin_client, settings, tmp_path):
    # 18 MP, above the full-decode cap: a JPEG is decoded scaled down (draft).
    settings.MEDIA_ROOT = str(tmp_path)
    r = admin_client.post(reverse('my-avatar'), {'file': _jpeg(6000, 3000)}, format='multipart')
    assert r.status_code == 200, r.data
    assert r.data['has_custom_avatar'] is True


@pytest.mark.django_db
def test_normal_png_at_the_cap_still_works(admin_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    r = admin_client.post(reverse('my-avatar'), {'file': _png(1290, 2796)}, format='multipart')
    assert r.status_code == 200, r.data
