from io import StringIO
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.content.media import MediaAsset
from apps.content.pages import Page

ASSETS = Path(__file__).resolve().parents[3] / 'frontend' / 'public' / 'assets'


@pytest.mark.django_db
def test_seed_is_idempotent_and_validates(tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)
    src = next(ASSETS.glob('*.webp'), None)
    assets = tmp_path / 'assets'
    assets.mkdir()
    if src:
        (assets / 'facade.webp').write_bytes(src.read_bytes())
    out = StringIO()
    call_command('seed_cms', assets=str(assets), stdout=out)
    assert Page.objects.filter(slug='inicio', status='draft').exists()
    n_pages, n_media = Page.objects.count(), MediaAsset.objects.count()
    assert n_pages == 9 and n_media == (1 if src else 0)
    hero = Page.objects.get(slug='inicio').draft_blocks[0]
    assert hero['type'] == 'hero'
    if src:
        assert hero['props']['image'] == MediaAsset.objects.first().pk

    call_command('seed_cms', assets=str(assets), stdout=out)  # no duplicates
    assert Page.objects.count() == n_pages and MediaAsset.objects.count() == n_media

    call_command('seed_cms', assets=str(assets), publish=True, force=True, stdout=out)
    assert Page.objects.get(slug='inicio').status == 'published'
