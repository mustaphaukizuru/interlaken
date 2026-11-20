from io import StringIO
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.content.media import MediaAsset
from apps.content.pages import Page

ASSETS = Path(__file__).resolve().parents[3] / 'frontend' / 'public' / 'assets'


@pytest.mark.django_db
def test_seed_imports_media_idempotently_and_creates_no_pages(tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)
    src = next(ASSETS.glob('*.webp'), None)
    assets = tmp_path / 'assets'
    assets.mkdir()
    if src:
        (assets / 'facade.webp').write_bytes(src.read_bytes())
    out = StringIO()
    call_command('seed_cms', assets=str(assets), stdout=out)
    n_media = MediaAsset.objects.count()
    assert n_media == (1 if src else 0)
    if src:
        assert MediaAsset.objects.get().alt == 'Fachada del Colegio Interlaken'
    # Page drafts come from the frontend templates now (CMS-COMPLETION-PLAN).
    assert Page.objects.count() == 0

    call_command('seed_cms', assets=str(assets), stdout=out)  # no duplicates
    assert MediaAsset.objects.count() == n_media
