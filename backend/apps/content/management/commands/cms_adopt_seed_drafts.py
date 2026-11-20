"""
cms_adopt_seed_drafts: return the old seed_cms drafts to «Diseño original».

The old ``seed_cms`` (2026-08-22 to 2026-10-20) left draft pages made of
generic blocks for nine public pages. They were never published, but they look
like normal drafts and publishing one replaces the designed page with plain
generic blocks (docs/cms/safe-publish.md). This command finds every such draft
that nobody touched and deletes its row, so the console shows the page as
«Diseño original» with «Personalizar» again, exactly like a page never
customised.

Why delete instead of resetting the draft: the console decides «Diseño
original / Personalizar» by the absence of a Page row, and the design itself
lives in the frontend templates, not in the database, so the backend cannot
rebuild a designed draft. A never-published, unedited seed row holds nothing a
person wrote (no versions, content identical to the seed), and «Personalizar»
recreates the draft from today's design whenever someone wants to edit. The
deleted row (title, SEO and blocks) is kept in its audit record.

Never touched, listed as «revisar a mano»: drafts whose title, blocks or SEO
differ from what the seed wrote, pages published at some point, pages waiting
for approval or scheduled. Only pages of designed templates whose draft is in
the old generic format are listed.

    python manage.py cms_adopt_seed_drafts            # simulation: prints what it would do
    python manage.py cms_adopt_seed_drafts --apply    # does it (one audit record per page)

Idempotent: a second run finds nothing left to do.
"""
from __future__ import annotations

from dataclasses import dataclass

from django.core.cache import cache
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.content.legacy_seed import SEED_PAGES, compare_to_seed
from apps.content.media import MediaAsset
from apps.content.navigation import page_path
from apps.content.page_templates import has_template
from apps.content.pages import HEAD_CACHE, PAGE_CACHE, Page, is_generic_draft

ACTOR = 'system:cms_adopt_seed_drafts'
CONTEXT = 'cms.adopt_seed_drafts'

ADOPT = 'adopt'
REVIEW = 'review'


@dataclass
class Row:
    page: Page
    kind: str            # ADOPT | REVIEW
    detail: str


def _asset_names() -> dict[int, str]:
    return dict(MediaAsset.objects.values_list('pk', 'filename'))


def classify(page: Page, names: dict[int, str]) -> Row | None:
    """What to do with one page; None when it is not an old generic draft of a designed page."""
    if not has_template(page.slug) or not is_generic_draft(page.draft_blocks):
        return None
    if page.status == Page.Status.PUBLISHED or page.published_version_id or page.versions.exists():
        return Row(page, REVIEW, 'se publicó alguna vez; quedan sus versiones')
    if page.review_requested_at:
        return Row(page, REVIEW, 'tiene una solicitud de aprobación pendiente')
    if page.publish_at or page.unpublish_at:
        return Row(page, REVIEW, 'tiene una publicación o retiro programado')
    if page.slug not in SEED_PAGES:
        return Row(page, REVIEW, 'bloques genéricos que no vienen de la semilla')
    cmp = compare_to_seed(page.slug, page.title, page.draft_blocks, page.seo, names.get)
    if not cmp.matches:
        return Row(page, REVIEW, '; '.join(cmp.differences))
    return Row(page, ADOPT, 'igual a la semilla antigua (sin ediciones)')


def adopt(page: Page, names: dict[int, str]) -> bool:
    """Delete one seed draft after re-checking it under a row lock. False when it changed meanwhile."""
    with transaction.atomic():
        locked = Page.objects.select_for_update().filter(pk=page.pk).first()
        if locked is None:
            return False
        row = classify(locked, names)
        if row is None or row.kind != ADOPT:
            return False
        from apps.core.audit import record

        record('delete', locked, {
            'slug': [locked.slug, None],
            'title': [locked.title, None],
            'status': [locked.status, None],
            'seo': [locked.seo, None],
            'draft_blocks': [locked.draft_blocks, None],
            'reason': 'borrador antiguo de seed_cms sin ediciones: la página vuelve a «Diseño original»',
        }, actor_label=ACTOR, context=CONTEXT)
        pk = locked.pk
        locked.delete()
        locked.pk = pk
    cache.delete(PAGE_CACHE.format(slug=page.slug))
    cache.delete(HEAD_CACHE.format(slug=page.slug))
    return True


def _table(rows: list[list[str]]) -> str:
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    lines = ['  '.join(c.ljust(w) for c, w in zip(r, widths, strict=True)).rstrip() for r in rows]
    lines.insert(1, '  '.join('-' * w for w in widths))
    return '\n'.join(lines)


class Command(BaseCommand):
    help = 'Return untouched old seed_cms drafts to «Diseño original» (simulation unless --apply).'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Delete the untouched seed drafts (default: only show what would happen).')

    def handle(self, *args, **opts):
        apply = opts['apply']
        names = _asset_names()
        rows = [r for r in (classify(p, names) for p in Page.objects.order_by('slug')) if r is not None]
        mode = 'APLICANDO' if apply else 'SIMULACIÓN (no se modifica nada; use --apply para aplicar)'
        self.stdout.write(f'Borradores antiguos (seed_cms) en páginas con diseño: {mode}')
        if not rows:
            self.stdout.write(self.style.SUCCESS('No hay borradores antiguos. Nada que hacer.'))
            return

        adopted = skipped = 0
        table = [['Página', 'Dirección', 'Acción', 'Detalle']]
        for r in rows:
            if r.kind == ADOPT:
                if apply:
                    if adopt(r.page, names):
                        adopted += 1
                        action = 'Eliminado: vuelve a «Diseño original»'
                    else:
                        skipped += 1
                        action = 'Omitido: cambió durante la ejecución'
                else:
                    action = 'Se eliminará: vuelve a «Diseño original»'
            else:
                action = 'Revisar a mano (no se toca)'
            table.append([r.page.slug, page_path(r.page.slug), action, r.detail])
        self.stdout.write(_table(table))

        pending = sum(1 for r in rows if r.kind == ADOPT)
        review = sum(1 for r in rows if r.kind == REVIEW)
        if apply:
            summary = f'Resumen: {adopted} eliminados (un registro de auditoría cada uno), {review} para revisar a mano'
            summary += f', {skipped} omitidos.' if skipped else '.'
        else:
            summary = f'Resumen: {pending} se eliminarían, {review} para revisar a mano.'
        self.stdout.write(self.style.SUCCESS(summary))
        if review:
            self.stdout.write('Revisar a mano: abra la página en Contenido; «Cargar el diseño actual» o «Diseño original» '
                              'la pasa al diseño (también limpia el SEO antiguo). Publicarla tal cual pide confirmación.')
