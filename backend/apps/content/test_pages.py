"""P3-3: CMS pages — validation, publish/versions/rollback, public cache+ETag, preview token, alt guardrail."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
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
    page = Page.objects.create(slug='nosotros', title='Nosotros', draft_blocks=BLOCKS)
    # unpublished page is 404 publicly
    api_client.force_authenticate(user=None)
    assert api_client.get(reverse('cms-page', args=['nosotros'])).status_code == 404
    api_client.force_authenticate(user=AdminFactory())
    r1 = api_client.post(reverse('admin-page-publish', args=[page.pk]), {'action': 'publish'}, format='json')
    assert r1.status_code == 200 and r1.data['version'] == 1
    api_client.force_authenticate(user=None)
    pub = api_client.get(reverse('cms-page', args=['nosotros']))
    assert pub.status_code == 200 and pub.data['blocks'][0]['type'] == 'hero' and pub['ETag']
    assert api_client.get(reverse('cms-page', args=['nosotros']), HTTP_IF_NONE_MATCH=pub['ETag']).status_code == 304
    # edit draft → public unchanged until publish (cache busts on publish)
    api_client.force_authenticate(user=AdminFactory())
    api_client.patch(reverse('admin-page-detail', args=[page.pk]), {'draft_blocks': [BLOCKS[1]]}, format='json')
    api_client.force_authenticate(user=None)
    assert len(api_client.get(reverse('cms-page', args=['nosotros'])).data['blocks']) == 2
    api_client.force_authenticate(user=AdminFactory())
    assert api_client.post(reverse('admin-page-publish', args=[page.pk]), {}, format='json').data['version'] == 2
    api_client.force_authenticate(user=None)
    assert len(api_client.get(reverse('cms-page', args=['nosotros'])).data['blocks']) == 1
    # rollback to v1 creates v3 with 2 blocks
    api_client.force_authenticate(user=AdminFactory())
    rb = api_client.post(reverse('admin-page-versions', args=[page.pk]), {'version': 1}, format='json')
    assert rb.data == {'restored_from': 1, 'version': 3}
    versions = api_client.get(reverse('admin-page-versions', args=[page.pk])).data
    assert [v['number'] for v in versions] == [3, 2, 1]


def test_preview_requires_admin_or_token(admin_client, api_client):
    page = Page.objects.create(slug='draft-page', title='D', draft_blocks=BLOCKS)
    api_client.force_authenticate(user=ParentFactory())
    assert api_client.get(reverse('cms-page-preview', args=[page.pk])).status_code == 403
    api_client.force_authenticate(user=AdminFactory())
    tok = api_client.post(reverse('admin-page-preview-token', args=[page.pk]), {}, format='json').data
    assert f'/{page.slug}?preview=' in tok['url']
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
    page = Page.objects.create(slug='galeria', title='G', draft_blocks=[{'type': 'image', 'props': {'image': asset['id']}}])
    resp = admin_client.post(reverse('admin-page-publish', args=[page.pk]), {}, format='json')
    assert resp.status_code == 400 and 'texto alternativo' in resp.data['detail']
    admin_client.patch(reverse('admin-media-detail', args=[asset['id']]), {'alt': 'Campus'}, format='json')
    assert admin_client.post(reverse('admin-page-publish', args=[page.pk]), {}, format='json').status_code == 200
