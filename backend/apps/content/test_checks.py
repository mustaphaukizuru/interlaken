import pytest
from django.core.files.base import ContentFile
from django.urls import reverse

from apps.content.checks import run_checks
from apps.content.media import MediaAsset
from apps.content.navigation import Redirect
from apps.content.pages import Page


def _asset(alt=''):
    a = MediaAsset(filename='f.png', content_type='image/png', alt=alt)
    a.file.save('f.png', ContentFile(b'x'), save=False)
    a.save()
    return a


@pytest.mark.django_db
def test_run_checks_finds_errors_and_warnings(admin_user, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    ok_img, no_alt = _asset('Fachada'), _asset('')
    Page.objects.create(slug='verano', title='V', draft_blocks=[]).publish(admin_user)
    Redirect.objects.create(from_path='/viejo', to_path='/verano')
    p = Page.objects.create(slug='t', title='T', seo={'description': 'x' * 170}, draft_blocks=[
        {'id': 'a', 'type': 'hero', 'props': {'title': 'Hola', 'image': ok_img.pk, 'cta': {'label': 'Ir', 'href': '/verano'}}},
        {'id': 'b', 'type': 'hero', 'props': {'title': '', 'image': no_alt.pk}},
        {'id': 'c', 'type': 'rich_text', 'props': {'html': '<p> </p>'}},
        {'id': 'd', 'type': 'cta_band', 'props': {'title': 'x', 'cta': {'label': 'y', 'href': '/no-existe'}}},
        {'id': 'e', 'type': 'cta_band', 'props': {'title': 'x', 'cta': {'label': 'y', 'href': '/viejo'}}},
        {'id': 'f', 'type': 'image', 'props': {'image': 99999}},
        {'id': 'g', 'type': 'rich_text', 'props': {'html': '<p><a href="http://x.mx">i</a> <a href="/niveles/primaria">ok</a> <a href="mailto:a@b.c">m</a></p>'}},
    ])
    codes = {(i['code'], i['block_id']) for i in run_checks(p)}
    assert ('required', 'b') in codes and ('missing_alt', 'b') in codes
    assert ('empty_text', 'c') in codes
    assert ('broken_link', 'd') in codes and ('broken_link', 'e') not in codes
    assert ('missing_image', 'f') in codes
    assert ('duplicate', 'b') in codes and ('duplicate', 'e') in codes
    assert ('insecure_link', 'g') in codes and ('broken_link', 'g') not in codes
    assert ('seo_long', None) in codes


@pytest.mark.django_db
def test_publish_blocked_by_errors_and_checks_endpoint(admin_client):
    p = Page.objects.create(slug='t', title='T', draft_blocks=[{'id': 'a', 'type': 'cta_band', 'props': {'title': 'x', 'cta': {'label': 'y', 'href': '/nada'}}}])
    r = admin_client.get(reverse('admin-page-checks', args=[p.pk]))
    assert r.status_code == 200 and r.data['ok'] is False
    r = admin_client.post(reverse('admin-page-publish', args=[p.pk]), {'action': 'publish'}, format='json')
    assert r.status_code == 400 and 'Enlace roto' in r.data['detail'] and r.data['issues']
    p.draft_blocks[0]['props']['cta']['href'] = '/admisiones'
    p.save()
    assert admin_client.get(reverse('admin-page-checks', args=[p.pk])).data['ok'] is True
    assert admin_client.post(reverse('admin-page-publish', args=[p.pk]), {'action': 'publish'}, format='json').status_code == 200
