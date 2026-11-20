"""Safe publishing (docs/cms/safe-publish.md): C1 old generic drafts need a confirmation to be
published by any path, C2 draft saves detect a concurrent edit."""
import datetime as dt
from io import StringIO

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import User
from apps.content.pages import Page, is_legacy_seed
from apps.core.models import AuditLog
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db

GENERIC = [{'id': 'a', 'type': 'hero', 'props': {'title': 'Costos'}},
           {'id': 'b', 'type': 'rich_text', 'props': {'html': '<p>Cifras informativas.</p>'}}]
# A designed page as «Personalizar» creates it: designed sections, built-in photos, internal links.
DESIGNED = [
    {'id': 'costos-1', 'type': 'costos.hero', 'props': {'title': 'Costos {{ciclo}}', 'image': '/assets/facade.webp',
                                                        'subtitle': 'Inscripción y colegiaturas'}},
    {'id': 'costos-2', 'type': 'costos.prices', 'props': {'note': 'Cifras informativas.',
                                                          'cta': {'label': 'Pre-registro', 'href': '/pre-registro'},
                                                          'links': [{'label': 'WhatsApp', 'href': 'https://wa.me/5215555555555'},
                                                                    {'label': 'Llamar', 'href': 'tel:+525553791188'},
                                                                    {'label': 'Documentos', 'href': '/admisiones/documentacion'},
                                                                    {'label': 'Arriba', 'href': '#precios'}]}},
]


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()


@pytest.fixture
def staff_user(db):
    return User.objects.create_user(email='staff@test.mx', password='x-pass-1234', first_name='Sol', last_name='Staff', role=User.Role.STAFF)


# ── C1: old generic drafts ──────────────────────────────────────────────────
def test_legacy_seed_flag_in_list_and_detail(admin_client):
    legacy = Page.objects.create(slug='costos', title='Costos', draft_blocks=GENERIC)
    designed = Page.objects.create(slug='pagos', title='Pagos', draft_blocks=[{'id': 'p', 'type': 'pagos.hero', 'props': {'title': 'Pagos'}}])
    custom = Page.objects.create(slug='verano', title='Verano', draft_blocks=GENERIC)
    empty = Page.objects.create(slug='galeria', title='Galería', draft_blocks=[])
    rows = {r['slug']: r for r in admin_client.get(reverse('admin-pages')).data['results']}
    assert rows['costos']['legacy_seed'] is True
    assert rows['pagos']['legacy_seed'] is False and rows['verano']['legacy_seed'] is False and rows['galeria']['legacy_seed'] is False
    assert admin_client.get(reverse('admin-page-detail', args=[legacy.pk])).data['legacy_seed'] is True
    assert not any(is_legacy_seed(p) for p in (designed, custom, empty))


def test_publish_legacy_needs_confirmation(admin_client, admin_user):
    page = Page.objects.create(slug='costos', title='Costos', draft_blocks=GENERIC)
    url = reverse('admin-page-publish', args=[page.pk])
    r = admin_client.post(url, {'action': 'publish'}, format='json')
    assert r.status_code == 409 and r.data['code'] == 'legacy_seed_draft'
    assert '/admisiones/costos' in r.data['detail'] and 'Cargar el diseño actual' in r.data['detail']
    page.refresh_from_db()
    assert page.status == 'draft' and not page.versions.exists()
    assert admin_client.post(url, {'action': 'publish', 'confirm_legacy': False}, format='json').status_code == 409
    r = admin_client.post(url, {'action': 'publish', 'confirm_legacy': True}, format='json')
    assert r.status_code == 200 and r.data['version'] == 1
    log = AuditLog.objects.filter(context='cms.publish', object_id=str(page.pk)).latest('pk')
    assert log.changes == {'published_version': 1, 'legacy_seed_confirmed': True}
    # Live with generic blocks already: republishing changes content, not the design → no 409.
    page.refresh_from_db()
    assert not is_legacy_seed(page)
    page.draft_blocks = [GENERIC[0]]
    page.save()
    assert admin_client.post(url, {'action': 'publish'}, format='json').status_code == 200
    # Unpublished again: the design shows, so the generic draft is legacy again.
    page.unpublish(admin_user)
    assert admin_client.post(url, {'action': 'publish'}, format='json').status_code == 409


def test_designed_and_custom_pages_publish_without_confirmation(admin_client):
    designed = Page.objects.create(slug='costos', title='Costos', draft_blocks=DESIGNED)
    custom = Page.objects.create(slug='verano', title='Verano', draft_blocks=GENERIC)
    for p in (designed, custom):
        assert admin_client.post(reverse('admin-page-publish', args=[p.pk]), {'action': 'publish'}, format='json').status_code == 200


def test_bulk_publish_skips_legacy(admin_client):
    legacy = Page.objects.create(slug='costos', title='Costos', draft_blocks=GENERIC)
    ok = Page.objects.create(slug='verano', title='Verano', draft_blocks=GENERIC)
    r = admin_client.post(reverse('admin-pages-bulk'), {'action': 'publish', 'ids': [legacy.pk, ok.pk]}, format='json')
    assert r.status_code == 200, r.data
    assert [s['id'] for s in r.data['skipped']] == [legacy.pk] and 'publíquelo desde el editor' in r.data['skipped'][0]['reason']
    legacy.refresh_from_db()
    assert legacy.status == 'draft'


def test_schedule_never_publishes_legacy(admin_user):
    past = timezone.now() - dt.timedelta(minutes=1)
    legacy = Page.objects.create(slug='costos', title='Costos', draft_blocks=GENERIC, publish_at=past)
    designed = Page.objects.create(slug='pagos', title='Pagos', draft_blocks=[{'id': 'p', 'type': 'pagos.hero', 'props': {'title': 'Pagos'}}], publish_at=past)
    out = StringIO()
    call_command('cms_schedule', stdout=out)
    legacy.refresh_from_db()
    designed.refresh_from_db()
    assert legacy.status == 'draft' and legacy.publish_at is not None   # stays overdue in the editor
    assert designed.status == 'published'
    assert 'Publicadas 1, bloqueadas por revisión 1' in out.getvalue()


def test_review_request_of_legacy_needs_confirmation_and_warns_direction(api_client, staff_user, admin_user):
    page = Page.objects.create(slug='costos', title='Costos', draft_blocks=GENERIC)
    api_client.force_authenticate(staff_user)
    url = reverse('admin-page-review', args=[page.pk])
    r = api_client.post(url, {'action': 'request'}, format='json')
    assert r.status_code == 409 and r.data['code'] == 'legacy_seed_draft'
    assert not Notification.objects.exists()
    r = api_client.post(url, {'action': 'request', 'confirm_legacy': True}, format='json')
    assert r.status_code == 200 and r.data['review_requested_at']
    assert 'formato antiguo' in Notification.objects.get(user=admin_user).message
    # Approving = publishing, which still asks Dirección to confirm.
    api_client.force_authenticate(admin_user)
    assert api_client.post(reverse('admin-page-publish', args=[page.pk]), {'action': 'publish'}, format='json').status_code == 409


# ── C2: draft conflicts ─────────────────────────────────────────────────────
def test_draft_revision_bumps_on_every_save(admin_client, admin_user):
    r = admin_client.post(reverse('admin-pages'), {'slug': 'verano', 'title': 'Verano', 'draft_blocks': GENERIC}, format='json')
    assert r.status_code == 201 and r.data['draft_revision'] == 1
    assert r.data['draft_updated_by'] == 'Ada Admin' and r.data['draft_updated_at']
    url = reverse('admin-page-detail', args=[r.data['id']])
    assert admin_client.get(url).data['draft_revision'] == 1
    r = admin_client.patch(url, {'title': 'Curso de verano'}, format='json')           # no draft_revision: as before
    assert r.status_code == 200 and r.data['draft_revision'] == 2
    r = admin_client.patch(url, {'title': 'Curso', 'draft_revision': 2}, format='json')
    assert r.status_code == 200 and r.data['draft_revision'] == 3 and r.data['title'] == 'Curso'
    # Restoring a version into the draft is a draft save too.
    Page.objects.get(pk=r.data['id']).publish(admin_user)
    r = admin_client.post(reverse('admin-page-versions', args=[r.data['id']]), {'version': 1}, format='json')
    assert r.data['page']['draft_revision'] == 4


def test_stale_save_gets_409_with_who_and_when(api_client, admin_user, staff_user):
    page = Page.objects.create(slug='verano', title='Verano', draft_blocks=GENERIC)
    url = reverse('admin-page-detail', args=[page.pk])
    api_client.force_authenticate(staff_user)
    rev = api_client.get(url).data['draft_revision']
    assert api_client.patch(url, {'title': 'Sol escribió', 'draft_revision': rev}, format='json').status_code == 200
    # Dirección still holds the old revision: refused, nothing overwritten.
    api_client.force_authenticate(admin_user)
    r = api_client.patch(url, {'title': 'Ada escribió', 'draft_revision': rev}, format='json')
    assert r.status_code == 409
    assert r.data['code'] == 'draft_conflict' and r.data['draft_revision'] == rev + 1
    assert r.data['draft_updated_by'] == 'Sol Staff' and r.data['draft_updated_at']
    assert 'Sol Staff guardó cambios' in r.data['detail']
    page.refresh_from_db()
    assert page.title == 'Sol escribió' and page.draft_revision == rev + 1
    assert api_client.patch(url, {'title': 'x', 'draft_revision': 'abc'}, format='json').status_code == 400
    # Without draft_revision the last save wins, exactly as before.
    assert api_client.patch(url, {'title': 'Ada escribió'}, format='json').status_code == 200


def test_migration_0028_backfills_draft_updated_at():
    from importlib import import_module

    from django.apps import apps

    page = Page.objects.create(slug='verano', title='Verano', draft_blocks=GENERIC)
    Page.objects.filter(pk=page.pk).update(draft_updated_at=None)
    import_module('apps.content.migrations.0028_page_draft_revision').backfill_draft_updated_at(apps, None)
    page.refresh_from_db()
    assert page.draft_updated_at == page.updated_at and page.draft_revision == 0
