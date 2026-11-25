"""P3-3: CMS pages — validation, publish/versions/rollback, public cache+ETag, preview token, alt guardrail."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, UserFactory
from apps.content.pages import Page

pytestmark = pytest.mark.django_db

BLOCKS = [
    {'type': 'hero', 'props': {'title': 'Bienvenidos', 'subtitle': 'Colegio Interlaken'}},
    {'type': 'rich_text', 'props': {'html': '<p>Hola</p>'}},
]


@pytest.fixture
def admin_client(api_client):
    api_client.force_authenticate(user=AdminFactory())
    return api_client


def test_create_validates_blocks(admin_client):
    bad = admin_client.post(reverse('admin-pages'), {'slug': 'x', 'title': 'X', 'draft_blocks': [{'type': 'nope', 'props': {}}]}, format='json')
    assert bad.status_code == 400 and 'blocks' in str(bad.data)
    bad2 = admin_client.post(reverse('admin-pages'), {'slug': 'x', 'title': 'X', 'draft_blocks': [{'type': 'hero', 'props': {}}]}, format='json')
    assert bad2.status_code == 400
    ok = admin_client.post(reverse('admin-pages'), {'slug': 'inicio', 'title': 'Inicio', 'template': 'home', 'draft_blocks': BLOCKS}, format='json')
    assert ok.status_code == 201 and all('id' in b for b in ok.data['draft_blocks']) and ok.data['has_unpublished_changes']


def test_publish_versions_rollback_and_public_cache(admin_client, api_client):
    # A custom page: generic blocks on a designed page's slug need confirm_legacy (test_safe_publish.py).
    page = Page.objects.create(slug='verano', title='Verano', draft_blocks=BLOCKS)
    # unpublished page is 404 publicly
    api_client.force_authenticate(user=None)
    assert api_client.get(reverse('cms-page', args=['verano'])).status_code == 404
    api_client.force_authenticate(user=AdminFactory())
    r1 = api_client.post(reverse('admin-page-publish', args=[page.pk]), {'action': 'publish'}, format='json')
    assert r1.status_code == 200 and r1.data['version'] == 1
    api_client.force_authenticate(user=None)
    pub = api_client.get(reverse('cms-page', args=['verano']))
    assert pub.status_code == 200 and pub.data['blocks'][0]['type'] == 'hero' and pub['ETag']
    assert api_client.get(reverse('cms-page', args=['verano']), HTTP_IF_NONE_MATCH=pub['ETag']).status_code == 304
    # edit draft → public unchanged until publish (cache busts on publish)
    api_client.force_authenticate(user=AdminFactory())
    api_client.patch(reverse('admin-page-detail', args=[page.pk]), {'draft_blocks': [BLOCKS[1]]}, format='json')
    api_client.force_authenticate(user=None)
    assert len(api_client.get(reverse('cms-page', args=['verano'])).data['blocks']) == 2
    api_client.force_authenticate(user=AdminFactory())
    # Taking a section out is a «large change»: published once acknowledged.
    assert api_client.post(reverse('admin-page-publish', args=[page.pk]), {'acknowledge_warnings': True}, format='json').data['version'] == 2
    api_client.force_authenticate(user=None)
    assert len(api_client.get(reverse('cms-page', args=['verano'])).data['blocks']) == 1
    # restoring v1 copies it into the DRAFT only: nothing is published yet
    api_client.force_authenticate(user=AdminFactory())
    rb = api_client.post(reverse('admin-page-versions', args=[page.pk]), {'version': 1}, format='json')
    assert rb.status_code == 200 and rb.data['restored_from'] == 1
    assert len(rb.data['page']['draft_blocks']) == 2 and rb.data['page']['has_unpublished_changes']
    versions = api_client.get(reverse('admin-page-versions', args=[page.pk])).data
    assert [v['number'] for v in versions] == [2, 1]
    api_client.force_authenticate(user=None)
    assert len(api_client.get(reverse('cms-page', args=['verano'])).data['blocks']) == 1
    # publishing the restored draft (through the checked publish flow) creates v3
    api_client.force_authenticate(user=AdminFactory())
    # (these test blocks carry no ids, so each save names them anew: «Qué cambia» sees a section swapped)
    assert api_client.post(reverse('admin-page-publish', args=[page.pk]), {'acknowledge_warnings': True}, format='json').data['version'] == 3
    api_client.force_authenticate(user=None)
    assert len(api_client.get(reverse('cms-page', args=['verano'])).data['blocks']) == 2


def test_restore_version_rejects_bad_input_and_staff(admin_client, api_client):
    page = Page.objects.create(slug='otra', title='Otra', draft_blocks=BLOCKS)
    page.publish(None)
    url = reverse('admin-page-versions', args=[page.pk])
    api_client.force_authenticate(user=AdminFactory())
    assert api_client.post(url, {'version': 'abc'}, format='json').status_code == 400
    assert api_client.post(url, {'version': 99}, format='json').status_code == 400
    api_client.force_authenticate(user=UserFactory(role='staff'))
    assert api_client.get(url).status_code == 403
    assert api_client.post(url, {'version': 1}, format='json').status_code == 403


def test_preview_requires_admin_or_token(admin_client, api_client):
    page = Page.objects.create(slug='draft-page', title='D', draft_blocks=BLOCKS)
    api_client.force_authenticate(user=ParentFactory())
    assert api_client.get(reverse('cms-page-preview', args=[page.pk])).status_code == 403
    api_client.force_authenticate(user=AdminFactory())
    tok = api_client.post(reverse('admin-page-preview-token', args=[page.pk]), {}, format='json').data
    assert f'/p/{page.slug}?preview=' in tok['url']
    api_client.force_authenticate(user=None)
    ok = api_client.get(reverse('cms-page-preview', args=[page.pk]), {'token': tok['token']})
    assert ok.status_code == 200 and ok.data['blocks'][0]['type'] == 'hero' and ok['Cache-Control'] == 'no-store'
    assert api_client.get(reverse('cms-page-preview', args=[page.pk]), {'token': 'bad'}).status_code == 403


def test_publish_blocks_images_without_alt(admin_client, settings, tmp_path):
    import io

    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image
    settings.MEDIA_ROOT = str(tmp_path)
    buf = io.BytesIO()
    Image.new('RGB', (50, 50)).save(buf, format='PNG')
    asset = admin_client.post(reverse('admin-media'), {'file': SimpleUploadedFile('a.png', buf.getvalue(), content_type='image/png')}, format='multipart').data
    page = Page.objects.create(slug='fotos', title='G', draft_blocks=[{'type': 'image', 'props': {'image': asset['id']}}])
    resp = admin_client.post(reverse('admin-page-publish', args=[page.pk]), {}, format='json')
    assert resp.status_code == 409 and 'texto alternativo' in resp.data['detail']
    admin_client.patch(reverse('admin-media-detail', args=[asset['id']]), {'alt': 'Campus'}, format='json')
    assert admin_client.post(reverse('admin-page-publish', args=[page.pk]), {}, format='json').status_code == 200


def test_designed_page_without_published_content_is_204_not_404(api_client):
    # Production logs showed hundreds of 404s a day (plataformas, galeria,
    # primaria, iniciar-sesion...): every visit asks whether the school
    # published a version, and «no» is the normal answer. A page the site
    # knows answers 204 (the browser renders it from code); an unknown slug
    # is still a 404.
    from datetime import timedelta

    from django.utils import timezone

    for slug in ('galeria', 'plataformas', 'primaria', 'iniciar-sesion', 'inicio'):
        resp = api_client.get(reverse('cms-page', args=[slug]))
        assert resp.status_code == 204, slug
        assert resp.content == b''
        assert resp['Cache-Control'] == 'public, no-cache'
    # A draft that was never published is still «nothing published».
    Page.objects.create(slug='galeria', title='Galería', draft_blocks=BLOCKS)
    assert api_client.get(reverse('cms-page', args=['galeria'])).status_code == 204
    # A designed page whose withdrawal date passed, too.
    Page.objects.create(slug='nosotros', title='Nosotros', draft_blocks=BLOCKS, status=Page.Status.PUBLISHED,
                        unpublish_at=timezone.now() - timedelta(minutes=1))
    assert api_client.get(reverse('cms-page', args=['nosotros'])).status_code == 204
    # Unknown or custom slugs without a published page: 404 as before.
    assert api_client.get(reverse('cms-page', args=['no-existe'])).status_code == 404
    Page.objects.create(slug='verano', title='Verano', draft_blocks=BLOCKS)
    assert api_client.get(reverse('cms-page', args=['verano'])).status_code == 404
