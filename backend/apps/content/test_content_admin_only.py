"""QA sweep 2026-11-24 (round 2): site content (pages) and the media library
are admin-only; staff with the «comunicados» area can still pick and upload a
comunicado's attachment from the library, nothing more."""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from apps.accounts.factories import AdminFactory, UserFactory
from apps.accounts.models import User
from apps.content.media import MediaAsset
from apps.content.pages import Page

pytestmark = pytest.mark.django_db

ALL_STAFF_AREAS = ['alumnos', 'accesos', 'admisiones', 'visitas', 'mensajes', 'comunicados',
                   'cafeteria']


def _staff(*areas):
    return UserFactory(role=User.Role.STAFF, staff_areas=list(areas))


def _png():
    buf = io.BytesIO()
    Image.new('RGB', (40, 30), (1, 2, 3)).save(buf, format='PNG')
    return SimpleUploadedFile('a.png', buf.getvalue(), content_type='image/png')


@pytest.mark.parametrize('areas', [[], ALL_STAFF_AREAS])
def test_staff_cannot_touch_pages(api_client, areas):
    page = Page.objects.create(slug='verano', title='Verano', draft_blocks=[])
    api_client.force_authenticate(_staff(*areas))
    assert api_client.get(reverse('admin-pages')).status_code == 403
    assert api_client.post(reverse('admin-pages'), {'slug': 'x', 'title': 'X'},
                           format='json').status_code == 403
    url = reverse('admin-page-detail', args=[page.pk])
    assert api_client.get(url).status_code == 403
    assert api_client.patch(url, {'title': 'Hackeado'}, format='json').status_code == 403
    assert api_client.post(reverse('admin-page-review', args=[page.pk]),
                           {'action': 'request'}, format='json').status_code == 403
    page.refresh_from_db()
    assert page.title == 'Verano'


def test_admin_still_edits_pages(admin_client):
    resp = admin_client.post(reverse('admin-pages'), {'slug': 'verano', 'title': 'Verano'},
                             format='json')
    assert resp.status_code == 201, resp.data


def test_staff_without_comunicados_cannot_use_the_media_library(api_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(_staff('cafeteria', 'visitas'))
    assert api_client.get(reverse('admin-media')).status_code == 403
    assert api_client.post(reverse('admin-media'), {'file': _png()},
                           format='multipart').status_code == 403


def test_comunicados_staff_pick_and_upload_but_not_edit_or_delete(api_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(_staff('comunicados'))
    assert api_client.get(reverse('admin-media')).status_code == 200
    up = api_client.post(reverse('admin-media'), {'file': _png()}, format='multipart')
    assert up.status_code == 201, up.data
    url = reverse('admin-media-detail', args=[up.data['id']])
    assert api_client.patch(url, {'alt': 'x'}, format='json').status_code == 403
    assert api_client.delete(url).status_code == 403
    assert api_client.get(reverse('admin-media-export'), {'fmt': 'csv'}).status_code == 403
    assert MediaAsset.objects.filter(pk=up.data['id']).exists()
    api_client.force_authenticate(AdminFactory())
    assert api_client.delete(url).status_code == 204
