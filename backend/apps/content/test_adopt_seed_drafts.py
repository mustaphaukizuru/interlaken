"""cms_adopt_seed_drafts + legacy_seed: the old seed_cms drafts go back to «Diseño original»
(docs/cms/safe-publish.md). The seed drafts are rebuilt with the verbatim historical
``page_definitions`` (seed_history_fixture.py) so the matcher is tested against what the
command really wrote, in every version."""
from io import StringIO

import pytest
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.utils import timezone

from apps.content.legacy_seed import SEED_PAGES, compare_to_seed, seed_seo_fields
from apps.content.media import MediaAsset
from apps.content.pages import Page, validate_blocks
from apps.content.seed_history_fixture import page_definitions
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

PHOTOS = ['campus-mural.webp', 'classroom.webp', 'court-wide.webp', 'facade-sign.webp', 'facade.webp',
          'interlaken-image (1).webp', 'interlaken-image (2).webp', 'primaria-gate.webp', 'secundaria.webp', 'logo-extra.webp']


@pytest.fixture
def media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    out = {}
    for name in PHOTOS:   # sorted like the seed's assets_dir.glob
        a = MediaAsset(filename=name, content_type='image/webp', size=1, sha256=name.ljust(64, 'x')[:64])
        a.file.save(name, ContentFile(b'x'), save=False)
        a.save()
        out[name] = a.pk
    return out


def seed(img, **knobs) -> dict[str, Page]:
    """What `seed_cms` (without --force/--publish) left in the database."""
    pages = {}
    for d in page_definitions(img, **knobs):
        pages[d['slug']] = Page.objects.create(slug=d['slug'], title=d['title'], template=d['template'],
                                               draft_blocks=validate_blocks(d['blocks']), seo=d['seo'])
    return pages


def names():
    return dict(MediaAsset.objects.values_list('pk', 'filename')).get


@pytest.mark.parametrize('knobs', [
    {'visit_href': '/pre-registro', 'timeline': False},    # 9c7b059, 6e2d399
    {'visit_href': '/pre-registro', 'timeline': True},     # 7a404c4
    {'visit_href': '/agendar-visita', 'timeline': True},   # 58e8e11
])
def test_every_seed_version_is_recognised(media, knobs):
    for slug, page in seed(media, **knobs).items():
        cmp = compare_to_seed(slug, page.title, page.draft_blocks, page.seo, names())
        assert cmp.matches, (slug, cmp.differences)
    assert set(SEED_PAGES) == {'inicio', 'nosotros', 'admisiones', 'costos', 'modelo-educativo', 'plataformas',
                               'documentacion', 'galeria', 'contacto'}


def test_seed_without_photos_and_with_deleted_photos_still_matches(media):
    pages = seed({})                       # the assets folder was empty when it ran
    for slug, page in pages.items():
        assert compare_to_seed(slug, page.title, page.draft_blocks, page.seo, names()).matches, slug
    Page.objects.all().delete()
    pages = seed(media)
    MediaAsset.objects.filter(filename='facade.webp').delete()   # a seed photo deleted later
    assert compare_to_seed('costos', 'Costos', pages['costos'].draft_blocks, pages['costos'].seo, names()).matches


def test_any_edit_counts_as_an_edit(media):
    pages = seed(media)
    blocks = pages['costos'].draft_blocks
    blocks[0]['props']['subtitle'] += ' '
    cmp = compare_to_seed('costos', 'Costos', blocks, pages['costos'].seo, names())
    assert not cmp.matches and cmp.differences == ['bloque 1 (hero): el contenido cambió']
    # another photo in an image slot, a hidden block, a new block, a new title, a new SEO description
    b = pages['contacto'].draft_blocks
    b[0]['props']['image'] = media['facade.webp']
    assert not compare_to_seed('contacto', 'Contacto', b, pages['contacto'].seo, names()).matches
    b = pages['nosotros'].draft_blocks
    b[3]['hidden'] = True
    assert not compare_to_seed('nosotros', 'Nosotros', b, pages['nosotros'].seo, names()).matches
    b = pages['galeria'].draft_blocks + [{'id': 'x', 'type': 'rich_text', 'props': {'html': '<p>Hola</p>'}}]
    assert 'tiene 3 bloques (la semilla tenía 2)' in compare_to_seed('galeria', 'Galería', b, pages['galeria'].seo, names()).differences
    assert not compare_to_seed('inicio', 'Portada', pages['inicio'].draft_blocks, pages['inicio'].seo, names()).matches
    seo = {**pages['plataformas'].seo, 'description': 'Nueva'}
    assert compare_to_seed('plataformas', 'Plataformas', pages['plataformas'].draft_blocks, seo, names()).differences == ['el SEO cambió']


def test_volatile_metadata_is_ignored(media):
    pages = seed(media)
    blocks = pages['admisiones'].draft_blocks
    for i, b in enumerate(blocks):
        b['id'] = f'otro-{i}'
        b['hidden'] = False
    blocks[2]['props']['title'] = ''          # an empty field the old editor may have added
    seo = {**pages['admisiones'].seo, 'noindex': False, 'og_image': None}
    assert compare_to_seed('admisiones', 'Admisiones', blocks, seo, names()).matches


def test_seed_seo_fields():
    assert seed_seo_fields('costos', {'title': 'Costos · Colegio Interlaken', 'description': 'Mía'}) == {'title': 'Costos · Colegio Interlaken'}
    assert seed_seo_fields('costos', {'title': 'Costos 2027'}) == {}
    assert seed_seo_fields('pagos', {'title': 'Pagos · Colegio Interlaken'}) == {}


def run(*args) -> str:
    out = StringIO()
    call_command('cms_adopt_seed_drafts', *args, stdout=out)
    return out.getvalue()


def test_dry_run_lists_and_changes_nothing_apply_deletes_with_one_audit_each(media, admin_user):
    pages = seed(media, visit_href='/pre-registro', timeline=False)
    # Edited draft: listed, never touched.
    edited = pages['costos']
    edited.draft_blocks[0]['props']['title'] = 'Costos y becas'
    edited.save()
    # Published at some point, under review, scheduled: never touched either.
    pages['galeria'].publish(admin_user)
    Page.objects.filter(pk=pages['contacto'].pk).update(review_requested_at=timezone.now())
    Page.objects.filter(pk=pages['plataformas'].pk).update(publish_at=timezone.now())
    # A designed draft (already personalised) is not an old draft: not listed.
    Page.objects.create(slug='pagos', title='Pagos', draft_blocks=[{'id': 'pagos-1', 'type': 'pagos.hero', 'props': {'title': 'Pagos'}}])
    # A custom page with generic blocks is not a designed page: not listed.
    Page.objects.create(slug='verano', title='Verano', draft_blocks=[{'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>x</p>'}}])

    before = Page.objects.count()
    out = run()
    assert 'SIMULACIÓN' in out and Page.objects.count() == before and not AuditLog.objects.filter(context='cms.adopt_seed_drafts').exists()
    for slug in ('inicio', 'nosotros', 'admisiones', 'modelo-educativo', 'documentacion'):
        assert f'{slug} ' in out
    assert out.count('Se eliminará: vuelve a «Diseño original»') == 5
    assert 'bloque 1 (hero): el contenido cambió' in out
    assert 'se publicó alguna vez' in out and 'solicitud de aprobación' in out and 'programado' in out
    assert 'pagos' not in out and 'verano' not in out
    assert 'Resumen: 5 se eliminarían, 4 para revisar a mano.' in out

    out = run('--apply')
    assert out.count('Eliminado: vuelve a «Diseño original»') == 5
    assert 'Resumen: 5 eliminados (un registro de auditoría cada uno), 4 para revisar a mano.' in out
    assert not Page.objects.filter(slug__in=['inicio', 'nosotros', 'admisiones', 'modelo-educativo', 'documentacion']).exists()
    assert set(Page.objects.values_list('slug', flat=True)) == {'costos', 'galeria', 'contacto', 'plataformas', 'pagos', 'verano'}
    assert Page.objects.get(slug='costos').draft_blocks[0]['props']['title'] == 'Costos y becas'
    logs = AuditLog.objects.filter(context='cms.adopt_seed_drafts')
    assert logs.count() == 5 and set(logs.values_list('action', flat=True)) == {'delete'}
    entry = logs.get(object_id=str(pages['inicio'].pk))
    assert entry.object_type == 'content.page' and entry.actor_label == 'system:cms_adopt_seed_drafts'
    assert entry.changes['slug'] == ['inicio', None] and entry.changes['draft_blocks'][0][0]['type'] == 'hero'   # restorable

    # Idempotent: the second run has nothing to adopt and lists the same pages to review.
    out = run('--apply')
    assert 'Eliminado' not in out and 'Resumen: 0 eliminados (un registro de auditoría cada uno), 4 para revisar a mano.' in out
    assert AuditLog.objects.filter(context='cms.adopt_seed_drafts').count() == 5


def test_nothing_to_do(media):
    assert 'No hay borradores antiguos. Nada que hacer.' in run('--apply')


def test_page_edited_between_plan_and_apply_is_skipped(media, monkeypatch):
    from apps.content.management.commands import cms_adopt_seed_drafts as cmd

    pages = seed(media)
    real = cmd.adopt

    def edit_then_adopt(page, nm):
        if page.slug == 'galeria':
            Page.objects.filter(pk=page.pk).update(title='Fotos')
        return real(page, nm)

    monkeypatch.setattr(cmd, 'adopt', edit_then_adopt)
    out = run('--apply')
    assert 'Omitido: cambió durante la ejecución' in out and Page.objects.filter(pk=pages['galeria'].pk).exists()
    assert Page.objects.count() == 1
