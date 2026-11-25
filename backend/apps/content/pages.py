"""
content/pages.py — block-based pages (CMS-PLAN phase 2, BACKLOG P3-3).

Page          slug, title, template, status, seo, published version pointer
PageVersion   immutable snapshot of blocks JSON; every publish = a new version
Blocks        [{id, type, props, hidden?}] validated against BLOCK_SCHEMAS (the
              generic blocks, mirrored in frontend/src/cms/blocks/registry.ts)
              and SECTION_SCHEMAS (each public page's designed sections, read
              from block_manifest.json, generated from the frontend registry
              and checked for drift by cms/manifest.test.ts).

Public:  GET /content/pages/<slug>/               published blocks, cached + ETag
                                                  (204 for a designed page with none)
         GET /content/pages/<id>/preview/?token=   draft, signed token (1 h)
Admin:   CRUD /content/admin/pages/, POST .../publish/, POST .../rollback/{version}
"""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from functools import lru_cache
from pathlib import Path

import django_filters
from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.db import models, transaction
from django.http import Http404
from django.utils import timezone
from rest_framework import generics, permissions, serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.bulk import AdminBulkView, BulkAction, BulkSkip
from apps.core.exporting import AdminExportMixin, Col, ExportSpec
from apps.core.listing import AdminListMixin
from apps.core.permissions import IsAdmin

from .ops import AuditedCrudMixin, delete_action, delete_keep_pk, tri_state
from .table_block import table_problem

PAGE_CACHE = 'cms:page:{slug}'
HEAD_CACHE = 'cms:head:{slug}'
PREVIEW_SALT = 'cms-preview'
PREVIEW_MAX_AGE = 7 * 24 * 3600   # shareable approval links last a week (P3-10)

# ---------------------------------------------------------------------------
# Block registry: type → required props (name → python type name). Optional
# props are free-form; unknown block types are rejected so the renderer never
# meets a block it cannot draw.
# ---------------------------------------------------------------------------
BLOCK_SCHEMAS: dict[str, dict[str, str]] = {
    'hero':         {'title': 'str'},                       # subtitle, image(asset id), video, cta{label,href}
    'rich_text':    {'html': 'str'},                        # sanitized on the client (DOMPurify) and here (bleach-lite)
    'image':        {'image': 'int'},                       # caption, width
    'gallery':      {'images': 'list'},                     # [{image, caption}]
    'feature_grid': {'items': 'list'},                      # [{icon, title, text}]
    'levels_cards': {},                                     # reads lib/levels
    'stats':        {'items': 'list'},                      # [{value,label}]
    'testimonials': {},                                     # reads /content/testimonials
    'cta_band':     {'title': 'str', 'cta': 'dict'},        # cta{label,href}
    'faq':          {'items': 'list'},                      # [{q,a}]
    'video':        {'url': 'str'},
    'map_contact':  {},
    'pricing_table': {},
    'form':         {'form': 'str'},                        # FormDefinition slug (phase 5)
    'timeline':     {'items': 'list'},                      # [{year,title,text}]
    'calendar':     {},
    'sep_incorporation': {},
    'open_school_events': {},
    'table':        {'table': 'dict'},                      # {columns, rows, highlight}; limits: table_block.py
}
_PY = {'str': str, 'int': int, 'list': list, 'dict': dict, 'bool': bool, 'num': (int, float), 'image': (int, str)}

MANIFEST_PATH = Path(__file__).with_name('block_manifest.json')
MAX_DRAFT_BYTES = 512 * 1024   # a whole page of sections is ~20 KB; this only stops abuse


@lru_cache(maxsize=1)
def manifest() -> dict:
    """{type: {label, group, locked, required{name: kind}, images[paths], labels{path: label}}} for every block type."""
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))['types']
    except (OSError, ValueError, KeyError):
        return {}


def section_schema(block_type: str) -> dict[str, str] | None:
    """Required props of a block type, or None if the type does not exist."""
    if block_type in BLOCK_SCHEMAS:
        return BLOCK_SCHEMAS[block_type]
    entry = manifest().get(block_type) if '.' in block_type else None
    return None if entry is None else entry.get('required', {})


# ---------------------------------------------------------------------------
# Errors that name the section and the field the way the editor shows them
# (contract C3): «Sección 1 (Inicio · Portada), campo «Título»». Labels come from
# the manifest (`label`, `labels`), never from prop keys.
# ---------------------------------------------------------------------------
LABEL_SEP = ' › '


def block_label(block_type) -> str:
    entry = manifest().get(block_type) if isinstance(block_type, str) else None
    return (entry or {}).get('label') or 'Sección'


def _field_key(path: str) -> list[tuple[str, str]]:
    """'items.2.title' -> [('items', 'items'), ('2', 'items[]'), ('title', 'items[].title')] (segment, manifest key)."""
    out, key = [], ''
    for seg in [p for p in (path or '').split('.') if p]:
        key = f'{key}[]' if seg.isdigit() else (f'{key}.{seg}' if key else seg)
        out.append((seg, key))
    return out


def field_path(block_type, path: str) -> str:
    """The deepest part of `path` that is an editor field ('cta.href' -> 'cta': the link field)."""
    labels = (manifest().get(block_type) or {}).get('labels') or {}
    if not labels:
        return path or ''
    keep = 0
    for n, (seg, key) in enumerate(_field_key(path), start=1):
        if seg.isdigit() or key in labels:
            keep = n
        else:
            break
    parts = [p for p in (path or '').split('.') if p][:keep]
    while parts and parts[-1].isdigit():
        parts.pop()
    return '.'.join(parts)


# Props the editor does not show as fields (old drafts, nested link keys): their usual names.
FIELD_LABELS = {
    'title': 'Título', 'subtitle': 'Subtítulo', 'text': 'Texto', 'html': 'Texto', 'body': 'Texto',
    'label': 'Texto del botón', 'href': 'Enlace', 'to': 'Enlace', 'cta': 'Botón', 'primary': 'Botón principal',
    'secondary': 'Botón secundario', 'buttons': 'Botones', 'links': 'Enlaces', 'items': 'Elementos',
    'images': 'Fotos', 'photos': 'Fotos', 'image': 'Imagen', 'poster': 'Imagen de portada', 'photo': 'Foto',
    'url': 'Enlace del video', 'form': 'Formulario', 'q': 'Pregunta', 'a': 'Respuesta',
}


def field_label(block_type, path: str) -> str:
    """'items.2.title' -> 'Tarjetas › elemento 3 › Título' (the editor's labels, never a key)."""
    labels = (manifest().get(block_type) or {}).get('labels') or {}
    out = []
    for seg, key in _field_key(path):
        if seg.isdigit():
            out.append(f'elemento {int(seg) + 1}')
        elif labels.get(key) or FIELD_LABELS.get(seg):
            out.append(labels.get(key) or FIELD_LABELS[seg])
    return LABEL_SEP.join(out)


def where(block_type, index: int, path: str = '') -> str:
    """Sección 2 (Costos · Portada), campo «Título»: how the issues list names a place."""
    label = field_label(block_type, path) if path else ''
    return f'Sección {index + 1} ({block_label(block_type)})' + (f', campo «{label}»' if label else '')


def located_error(blocks, index, field: str, message: str) -> dict:
    """One structured error: {block_index, block_id, block_label, field, field_label, message}."""
    b = blocks[index] if isinstance(index, int) and 0 <= index < len(blocks) and isinstance(blocks[index], dict) else {}
    t = b.get('type')
    field = field_path(t, field) if field else ''
    return {
        'block_index': index,
        'block_id': b.get('id'),
        'block_label': block_label(t) if b else '',
        'field': field,
        'field_label': field_label(t, field) if field else '',
        'message': message,
    }


def block_errors(blocks) -> tuple[str, list[dict]]:
    """Structural problems of a draft: (first message, for `detail`; structured errors). ('', []) when valid."""
    if not isinstance(blocks, list):
        return 'Debe ser una lista de bloques.', []
    if len(json.dumps(blocks)) > MAX_DRAFT_BYTES:
        return 'La página es demasiado grande; divídala en varias páginas.', []
    errors: list[dict] = []
    messages: list[str] = []
    for i, b in enumerate(blocks):
        if not isinstance(b, dict) or 'type' not in b:
            messages.append(f'Sección {i + 1}: no es una sección válida.')
            errors.append({'block_index': i, 'block_id': b.get('id') if isinstance(b, dict) else None,
                           'block_label': '', 'field': '', 'field_label': '', 'message': 'No es una sección válida.'})
            continue
        schema = section_schema(b['type'])
        if schema is None:
            messages.append(f'Sección {i + 1}: este tipo de sección ya no existe en el sitio.')
            errors.append({'block_index': i, 'block_id': b.get('id'), 'block_label': '', 'field': '', 'field_label': '',
                           'message': 'Este tipo de sección ya no existe en el sitio.'})
            continue
        props = b.get('props') or {}
        if not isinstance(props, dict):
            messages.append(f'{where(b["type"], i)}: su contenido no es válido.')
            errors.append(located_error(blocks, i, '', 'El contenido de esta sección no es válido.'))
            continue
        for name, kind in schema.items():
            if name not in props or not isinstance(props[name], _PY[kind]):
                short = 'Falta este dato.' if name not in props else 'Este dato no tiene el formato esperado.'
                messages.append(f'{where(b["type"], i, name)}: {short[0].lower()}{short[1:]}')
                errors.append(located_error(blocks, i, name, short))
        # «Tabla» fields: the limits the editor enforces (table_block.py, read from the manifest).
        for name, limits in (manifest().get(b['type'], {}).get('tables') or {}).items():
            problem = table_problem(props.get(name), limits) if name in props else None
            if problem:
                short = problem[0].upper() + problem[1:]
                part = table_part(problem)
                err = located_error(blocks, i, name, short)
                if part:
                    err['field_label'] = f"{err['field_label']}{LABEL_SEP}{part}" if err['field_label'] else part
                messages.append(f'Sección {i + 1} ({block_label(b["type"])}), campo «{err["field_label"]}»: {problem}')
                errors.append(err)
    return (messages[0] if messages else ''), errors


def table_part(problem: str) -> str:
    """The part of a «Tabla» a table_problem() message is about: «Filas» or «Columnas» (or the whole table)."""
    text = problem.lower()
    if 'fila' in text:
        return 'Filas'
    if 'columna' in text or 'encabezado' in text:
        return 'Columnas'
    return ''


# Props whose editor field was retired: the next save of a draft drops them
# (published versions keep theirs until the next publish). Header version 3
# (2026-11-23): the home hero has no logo switch and no third button.
RETIRED_PROPS = {'home.hero': ('showLogo', 'tertiary')}


def validate_blocks(blocks) -> list[dict]:
    detail, _errors = block_errors(blocks)
    if detail:
        raise serializers.ValidationError({'blocks': detail})
    out = []
    for b in blocks:
        props = b.get('props') or {}
        retired = RETIRED_PROPS.get(b['type'])
        if retired and isinstance(props, dict):
            props = {k: v for k, v in props.items() if k not in retired}
        block = {'id': str(b.get('id') or uuid.uuid4().hex[:8])[:40], 'type': b['type'], 'props': props}
        if b.get('hidden') is True:
            block['hidden'] = True
        out.append(block)
    return out


def blocks_error_response(data):
    """400 with `detail` and structured `errors` when a save sends invalid blocks, else None.

    Runs before the serializer so the errors keep their numbers (block_index)
    and reach the editor next to each field; `draft_blocks` keeps its old shape.
    """
    if not hasattr(data, 'get') or 'draft_blocks' not in data:
        return None
    detail, errors = block_errors(data.get('draft_blocks'))
    if not detail:
        return None
    return Response({'detail': detail, 'draft_blocks': {'blocks': [detail]}, 'errors': errors}, status=status.HTTP_400_BAD_REQUEST)


def image_ref_paths(block: dict) -> list[tuple[str, int]]:
    """(field path, media id) of every library image in a block: 'poster', 'photos.3.image'..."""
    paths = manifest().get(block.get('type'), {}).get('images') or ['image', 'images[].image']
    found: list[tuple[str, int]] = []

    def walk(value, parts, at):
        if not parts:
            if isinstance(value, int) and not isinstance(value, bool) and value > 0:
                found.append(('.'.join(at), value))
            return
        head, rest = parts[0], parts[1:]
        if head.endswith('[]'):
            items = value.get(head[:-2]) if isinstance(value, dict) else None
            for n, it in enumerate(items if isinstance(items, list) else []):
                walk(it, rest, [*at, head[:-2], str(n)])
        elif isinstance(value, dict):
            walk(value.get(head), rest, [*at, head])

    for path in paths:
        walk(block.get('props') or {}, path.replace('[].', '[] ').replace('.', ' ').split(), [])
    return found


def image_refs(block: dict) -> list[int]:
    """Media-library ids a block uses, following the image paths of its type ("poster", "items[].image")."""
    return [i for _p, i in image_ref_paths(block)]


class Page(models.Model):
    class Template(models.TextChoices):
        HOME = 'home', 'Inicio'
        LEVEL = 'level', 'Nivel educativo'
        SIMPLE = 'simple', 'Página simple'
        LANDING = 'landing', 'Landing'

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Borrador'
        PUBLISHED = 'published', 'Publicada'

    slug = models.SlugField(max_length=80, unique=True)
    title = models.CharField(max_length=160)
    template = models.CharField(max_length=12, choices=Template.choices, default=Template.SIMPLE)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, db_index=True)
    draft_blocks = models.JSONField(default=list, blank=True)
    seo = models.JSONField(default=dict, blank=True)   # {title, description, og_image, noindex}
    published_version = models.ForeignKey('PageVersion', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    published_at = models.DateTimeField(null=True, blank=True)
    # Approval step (P3-10): staff request, admin publishes or rejects with a note.
    review_requested_at = models.DateTimeField(null=True, blank=True)
    review_requested_by = models.ForeignKey('accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    review_note = models.CharField(max_length=300, blank=True)
    # Scheduling (P3-11): cms_schedule publishes/unpublishes on time; the public
    # view also enforces unpublish_at lazily so expiry never depends on cron.
    publish_at = models.DateTimeField(null=True, blank=True)
    unpublish_at = models.DateTimeField(null=True, blank=True)
    # Draft conflicts (docs/cms/safe-publish.md, C2): +1 on every draft save; a
    # save that names an older revision gets 409 instead of overwriting.
    draft_revision = models.PositiveIntegerField(default=0)
    draft_updated_by = models.ForeignKey('accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    draft_updated_at = models.DateTimeField(null=True, blank=True)
    # «Revisión antes de publicar»: since when the draft differs from the
    # published version (None while they match). Kept by save(); the editor
    # shows «cambios sin publicar desde …» once it is a few days old.
    unpublished_since = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['slug']
        verbose_name = 'Página (CMS)'
        verbose_name_plural = 'Páginas (CMS)'

    def __str__(self):
        return f'/{self.slug} ({self.get_status_display()})'

    def draft_differs(self) -> bool:
        """The draft (blocks or SEO) is not what the published version holds (always True before a first publish)."""
        live = self.published_version if self.published_version_id else None
        if live is None:
            return True
        return json.dumps(self.draft_blocks, sort_keys=True) != json.dumps(live.blocks, sort_keys=True) \
            or json.dumps(self.seo, sort_keys=True) != json.dumps(live.seo, sort_keys=True)

    def save(self, *args, **kwargs):
        # Every write of the draft or of the published version keeps unpublished_since right.
        fields = kwargs.get('update_fields')
        if fields is None or {'draft_blocks', 'seo', 'published_version'} & set(fields):
            since = (self.unpublished_since or timezone.now()) if self.draft_differs() else None
            if since != self.unpublished_since:
                self.unpublished_since = since
                if fields is not None:
                    kwargs['update_fields'] = [*fields, 'unpublished_since']
        super().save(*args, **kwargs)

    def stamp_draft(self, user) -> None:
        """One more draft save: bump the revision and remember who and when (caller saves)."""
        self.draft_revision = (self.draft_revision or 0) + 1
        self.draft_updated_by = user if getattr(user, 'pk', None) else None
        self.draft_updated_at = timezone.now()

    def publish(self, user, *, legacy_confirmed: bool = False, acknowledged: list[str] | None = None) -> PageVersion:
        """A new published version of the draft, as is. The gate (publish_checks) belongs to the
        callers that need one (editor, schedule, bulk); migrations and commands publish directly.

        ``acknowledged``: keys of the warnings the person confirmed («Entiendo las advertencias»), audited.
        """
        number = (self.versions.aggregate(m=models.Max('number'))['m'] or 0) + 1
        with transaction.atomic():
            v = PageVersion.objects.create(page=self, number=number, blocks=self.draft_blocks, seo=self.seo, author=user)
            self.published_version = v
            self.status = self.Status.PUBLISHED
            self.published_at = timezone.now()
            self.review_requested_at = None
            self.review_requested_by = None
            self.review_note = ''
            self.publish_at = None
            self.save(update_fields=['published_version', 'status', 'published_at', 'review_requested_at', 'review_requested_by', 'review_note', 'publish_at'])
        cache.delete(PAGE_CACHE.format(slug=self.slug))
        cache.delete(HEAD_CACHE.format(slug=self.slug))
        cache.delete('cms:sitemap')
        try:
            from apps.core.audit import record
            changes = {'published_version': number}
            if legacy_confirmed:
                changes['legacy_seed_confirmed'] = True
            if acknowledged:
                changes['warnings_acknowledged'] = list(acknowledged)
            record('update', self, changes, actor=user, context='cms.publish')
        except Exception:  # noqa: BLE001
            pass
        return v

    def unpublish(self, user):
        self.status = self.Status.DRAFT
        self.save(update_fields=['status'])
        cache.delete(PAGE_CACHE.format(slug=self.slug))
        cache.delete(HEAD_CACHE.format(slug=self.slug))
        cache.delete('cms:sitemap')
        try:
            from apps.core.audit import record
            record('update', self, {'status': 'draft'}, actor=user, context='cms.unpublish')
        except Exception:  # noqa: BLE001
            pass

    def preview_token(self) -> str:
        return signing.dumps({'page': self.pk}, salt=PREVIEW_SALT)


class PageVersion(models.Model):
    page = models.ForeignKey(Page, on_delete=models.CASCADE, related_name='versions')
    number = models.PositiveIntegerField()
    blocks = models.JSONField(default=list)
    seo = models.JSONField(default=dict, blank=True)
    author = models.ForeignKey('accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-number']
        unique_together = [('page', 'number')]

    def __str__(self):
        return f'{self.page.slug} v{self.number}'


# ---------------------------------------------------------------------------
# Old generic drafts (docs/cms/safe-publish.md, C1)
# ---------------------------------------------------------------------------
LEGACY_SEED_CODE = 'legacy_seed_draft'
DRAFT_CONFLICT_CODE = 'draft_conflict'


def is_generic_draft(blocks) -> bool:
    """Blocks, none of them a designed section: the format the old seed_cms wrote."""
    if not isinstance(blocks, list) or not blocks:
        return False
    return not any(isinstance(b, dict) and '.' in str(b.get('type') or '') for b in blocks)


def is_legacy_seed(page: Page) -> bool:
    """Publishing this draft would replace a designed public page with generic blocks.

    True when the slug has a designed template and the draft holds only generic
    blocks, unless the site already shows a generic version of it (then
    publishing changes the content, not the design).
    """
    from .page_templates import has_template

    if not has_template(page.slug) or not is_generic_draft(page.draft_blocks):
        return False
    live = page.published_version if page.status == Page.Status.PUBLISHED and page.published_version_id else None
    return not (live is not None and is_generic_draft(live.blocks))


def legacy_seed_detail(page: Page) -> str:
    from .navigation import page_path

    return (f'Este borrador usa el formato antiguo de bloques genéricos. Si lo publica, la página '
            f'{page_path(page.slug)} dejará de verse con su diseño actual. En el editor, use «Cargar el '
            f'diseño actual» para editar la página tal como se ve hoy, o confirme si de verdad quiere publicarlo así.')


def legacy_seed_response(page: Page) -> Response:
    return Response({'code': LEGACY_SEED_CODE, 'detail': legacy_seed_detail(page)}, status=status.HTTP_409_CONFLICT)


def confirmed(value) -> bool:
    """``{"confirm_legacy": true}`` (also "true"/"1" from a form)."""
    return value is True or str(value).strip().lower() in ('true', '1', 'si', 'sí', 'yes')


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------
class PageVersionSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source='author.full_name', read_only=True, default='')

    class Meta:
        model = PageVersion
        fields = ['id', 'number', 'blocks', 'seo', 'author_name', 'created_at']


class PageAdminSerializer(serializers.ModelSerializer):
    published_version_number = serializers.IntegerField(source='published_version.number', read_only=True, default=None)
    review_requested_by_name = serializers.CharField(source='review_requested_by.full_name', read_only=True, default='')
    has_unpublished_changes = serializers.SerializerMethodField()
    # C1: the draft is still the old generic format; publishing needs {"confirm_legacy": true}.
    legacy_seed = serializers.SerializerMethodField()
    # SEO fields that still hold the old seed values; «Diseño original» clears them.
    seed_seo = serializers.SerializerMethodField()
    # C2: send draft_revision back with the next save to detect a concurrent edit.
    draft_updated_by = serializers.CharField(source='draft_updated_by.full_name', read_only=True, default='')

    class Meta:
        model = Page
        fields = ['id', 'slug', 'title', 'template', 'status', 'draft_blocks', 'seo',
                  'published_version_number', 'has_unpublished_changes', 'published_at',
                  'review_requested_at', 'review_requested_by_name', 'review_note', 'publish_at', 'unpublish_at',
                  'legacy_seed', 'seed_seo', 'draft_revision', 'draft_updated_by', 'draft_updated_at',
                  'unpublished_since', 'created_at', 'updated_at']
        read_only_fields = ['id', 'status', 'published_at', 'review_requested_at', 'review_requested_by_name', 'review_note',
                            'draft_revision', 'draft_updated_at', 'unpublished_since', 'created_at', 'updated_at']

    # Staff edit drafts and ask Dirección for approval; only an admin decides
    # WHEN a page goes live or comes down (the cms_schedule cron acts on these
    # dates with no further approval) or moves its public address.
    ADMIN_ONLY_FIELDS = ('slug', 'publish_at', 'unpublish_at')

    def validate(self, attrs):
        request = self.context.get('request')
        if request is not None and getattr(request.user, 'role', None) != 'admin':
            inst = self.instance
            blocked = []
            for field in self.ADMIN_ONLY_FIELDS:
                if field not in attrs:
                    continue
                if inst is None:
                    # Creating: staff name the new page (slug) but cannot schedule it.
                    if field != 'slug' and attrs[field] is not None:
                        blocked.append(field)
                elif attrs[field] != getattr(inst, field):
                    blocked.append(field)
            if blocked:
                raise PermissionDenied(
                    'Solo Dirección puede cambiar la dirección (slug) de una página o programar '
                    'su publicación o retiro. Solicite aprobación desde el editor.'
                )
        return attrs

    def validate_draft_blocks(self, value):
        return validate_blocks(value)

    def validate_slug(self, value):
        value = value.strip().lower()
        if value in ('admin', 'api', 'portal', 'login', 'staff'):
            raise serializers.ValidationError('Slug reservado.')
        return value

    def get_has_unpublished_changes(self, p):
        if not p.published_version:
            return True
        return json.dumps(p.draft_blocks, sort_keys=True) != json.dumps(p.published_version.blocks, sort_keys=True) \
            or json.dumps(p.seo, sort_keys=True) != json.dumps(p.published_version.seo, sort_keys=True)

    def get_legacy_seed(self, p) -> bool:
        return is_legacy_seed(p)

    def get_seed_seo(self, p) -> dict:
        from .legacy_seed import seed_seo_fields

        return seed_seo_fields(p.slug, p.seo)

    def _actor(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def create(self, validated_data):
        page = Page(**validated_data)
        page.stamp_draft(self._actor())
        page.save()
        return page

    def update(self, instance, validated_data):
        # Every save through the console is a draft save (the editor autosaves the whole draft).
        instance.stamp_draft(self._actor())
        return super().update(instance, validated_data)


# Built-in hero photos ship -480/-960 variants (frontend/src/lib/images.ts
# assetSrcSet); these originals are narrower than 960 px and have none.
_NO_960 = {'/assets/hopscotch', '/assets/primaria-gate', '/assets/secundaria'}
_ASSET_WEBP = re.compile(r'^/assets/[^/]+\.webp$')
# The home hero poster's `sizes` (frontend HeroVideo): it covers a tall box on a portrait phone.
HOME_HERO_SIZES = '(orientation: portrait) 165vh, 100vw'


def hero_preload(blocks) -> dict | None:
    """A preload for the published home hero's poster, so the browser fetches the
    LCP image while it parses the HTML (the published page skips the first-paint
    shell that would otherwise carry it). Only built-in /assets photos, whose
    candidates are known; a library image is left to the page itself."""
    for b in blocks if isinstance(blocks, list) else []:
        if not isinstance(b, dict) or b.get('type') != 'home.hero':
            continue
        src = (b.get('props') or {}).get('poster')
        if not isinstance(src, str) or not _ASSET_WEBP.match(src) or re.search(r'-(480|960)\.webp$', src):
            return None
        base = src[:-len('.webp')]
        # A space separates srcset candidates: «interlaken-image (1).webp» must be encoded.
        u = lambda path: path.replace(' ', '%20')  # noqa: E731
        srcset = (f'{u(base)}-480.webp 480w, {u(src)} 960w' if base in _NO_960
                  else f'{u(base)}-480.webp 480w, {u(base)}-960.webp 960w, {u(src)} 1600w')
        return {'href': u(src), 'srcset': srcset, 'sizes': HOME_HERO_SIZES}
    return None


def published_head(path: str) -> dict | None:
    """SEO of the published CMS page served at `path`, for the server-rendered <head>.

    None when no published page lives there. Cached 5 min and busted on
    publish/unpublish, so the SPA catch-all costs no query per request.
    """
    from .navigation import SITE, SLUG_PATHS

    path = '/' + path.strip('/') if path.strip('/') else '/'
    by_path = {p: s for s, p in SLUG_PATHS.items()}
    slug = by_path.get(path) or (path[1:] if path.count('/') == 1 and len(path) > 1 else None)
    if not slug:
        return None
    key = HEAD_CACHE.format(slug=slug)
    head = cache.get(key)
    if head is None:
        page = Page.objects.select_related('published_version').filter(slug=slug, status=Page.Status.PUBLISHED).first()
        if page is None or (page.unpublish_at and page.unpublish_at <= timezone.now()):
            head = {}
        else:
            from .page_templates import template_seo

            seo = (page.published_version.seo if page.published_version else page.seo) or {}
            og = seo.get('og_image')
            # A designed page without SEO of its own keeps the template's (the yearly «Costos» title),
            # exactly as the browser does (TemplatePage), so crawlers see the same head.
            # Tokens stay ({{ciclo}}): the server head expands them on each request, so a cached head never goes stale.
            defaults = template_seo(slug, expand=False)
            head = {
                'title': (seo.get('title') or '').strip() or defaults['title'],
                'description': (seo.get('description') or '').strip() or defaults['description'],
                'image': f'{SITE}/api/v1/content/media/{og}/lg/' if isinstance(og, int) and not isinstance(og, bool) else '',
                'noindex': bool(seo.get('noindex')),
                'preload': hero_preload(page.published_version.blocks if page.published_version else []),
            }
        cache.set(key, head, 300)
    return head or None


def _media_meta(blocks) -> dict:
    """Alt text, size and existing variants of the library images on the page.

    ``variants`` lets the site request only sizes that exist (a photo 1600 px
    wide or less has no ``lg``, see media.VARIANTS), so srcset never lists a
    file that is really the next size up.
    """
    from .media import VARIANTS, MediaAsset

    ids = {i for b in blocks for i in image_refs(b)}
    if not ids:
        return {}
    return {str(a.pk): {'alt': a.alt, 'width': a.width, 'height': a.height,
                        'variants': [k for k in VARIANTS if k in (a.variants or {})]}
            for a in MediaAsset.objects.filter(pk__in=ids).only('pk', 'alt', 'width', 'height', 'variants')}


def _public_payload(page: Page, blocks, seo) -> dict:
    # Hidden blocks stay in drafts and versions (to show them again later) but never leave the server.
    visible = [b for b in blocks or [] if not b.get('hidden')]
    return {'slug': page.slug, 'title': page.title, 'template': page.template, 'blocks': visible,
            'seo': seo, 'media': _media_meta(visible),
            'published_at': page.published_at.isoformat() if page.published_at else None}


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------
def _not_published(slug: str) -> Response:
    """A designed page of the site with no published version: 204, the browser
    renders it from code (the normal state of most pages, not an error; it used
    to be a 404 for every visit, hundreds a day in the logs and red in the
    console). An unknown slug is still a 404."""
    from .page_templates import has_template

    if not has_template(slug):
        raise Http404
    resp = Response(status=status.HTTP_204_NO_CONTENT)
    resp['Cache-Control'] = 'public, no-cache'
    return resp


class PublicPageView(APIView):
    """GET /content/pages/<slug>/: the published version of a page (cached, ETag).

    204 No Content for a designed page that has none (``_not_published``),
    404 for a slug the site does not know."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, slug):
        key = PAGE_CACHE.format(slug=slug)
        payload = cache.get(key)
        if payload is None:
            try:
                page = Page.objects.select_related('published_version').get(slug=slug, status=Page.Status.PUBLISHED)
            except Page.DoesNotExist:
                return _not_published(slug)
            if page.unpublish_at and page.unpublish_at <= timezone.now():
                page.unpublish(None)
                return _not_published(slug)
            v = page.published_version
            payload = _public_payload(page, v.blocks if v else [], v.seo if v else page.seo)
            cache.set(key, payload, 300)
        etag = '"' + hashlib.md5(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16] + '"'
        if request.headers.get('If-None-Match') == etag:
            return Response(status=status.HTTP_304_NOT_MODIFIED)
        resp = Response(payload)
        resp['ETag'] = etag
        # Revalidate every time (a 304 costs nothing thanks to the ETag and the
        # server cache): a page Dirección just published shows up immediately.
        resp['Cache-Control'] = 'public, no-cache'
        return resp


class PagePreviewView(APIView):
    """Draft blocks for the visual editor iframe. Staff JWT or a signed token (1 h)."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        page = Page.objects.filter(pk=pk).first()
        if page is None:
            raise Http404
        user = getattr(request, 'user', None)
        if not (user and user.is_authenticated and getattr(user, 'role', '') == 'admin'):
            token = request.query_params.get('token', '')
            try:
                data = signing.loads(token, salt=PREVIEW_SALT, max_age=PREVIEW_MAX_AGE)
            except signing.BadSignature:
                return Response({'detail': 'Vista previa inválida o caducada.'}, status=status.HTTP_403_FORBIDDEN)
            if data.get('page') != page.pk:
                return Response({'detail': 'Vista previa inválida.'}, status=status.HTTP_403_FORBIDDEN)
        resp = Response(_public_payload(page, page.draft_blocks, page.seo))
        resp['Cache-Control'] = 'no-store'
        return resp


class PagePreviewByTokenView(APIView):
    """GET /content/pages/preview/?token= — resolves the page from the signed token."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        try:
            data = signing.loads(request.query_params.get('token', ''), salt=PREVIEW_SALT, max_age=PREVIEW_MAX_AGE)
        except signing.BadSignature:
            return Response({'detail': 'Vista previa inválida o caducada.'}, status=status.HTTP_403_FORBIDDEN)
        page = Page.objects.filter(pk=data.get('page')).first()
        if page is None:
            raise Http404
        resp = Response(_public_payload(page, page.draft_blocks, page.seo))
        resp['Cache-Control'] = 'no-store'
        return resp


class PageFilterSet(django_filters.FilterSet):
    """``?status=draft|published&template=&review=1`` (review = approval requested)."""

    status = django_filters.ChoiceFilter(choices=Page.Status.choices)
    template = django_filters.ChoiceFilter(choices=Page.Template.choices)
    review = django_filters.CharFilter(method="filter_review")

    class Meta:
        model = Page
        fields: list[str] = []

    def filter_review(self, qs, _name, value):
        flag = tri_state(value)
        return qs if flag is None else qs.filter(review_requested_at__isnull=not flag)


PAGE_ORDERING = {
    "title": "title",
    "slug": "slug",
    "status": "status",
    "template": "template",
    "updated": "updated_at",
    "published": "published_at",
    "created": "created_at",
}


class PageListCreateView(AuditedCrudMixin, AdminListMixin, generics.ListCreateAPIView):
    """GET/POST /content/admin/pages/ — Data Ops list contract (``q`` title/slug,
    ``status``, ``template``, ``review``; ordering keys in ``PAGE_ORDERING``)."""

    permission_classes = [IsAdmin]  # site content: admin-only (QA 2026-11-24)
    serializer_class = PageAdminSerializer
    search_fields = ("title", "slug")
    ordering = PAGE_ORDERING
    default_ordering = "slug"
    filterset_class = PageFilterSet
    audit_context = "cms.page"

    def get_queryset(self):
        return Page.objects.select_related("published_version", "review_requested_by", "draft_updated_by")

    def create(self, request, *args, **kwargs):
        return blocks_error_response(request.data) or super().create(request, *args, **kwargs)


def draft_conflict_payload(page: Page) -> dict:
    """409 body when a save names an older draft_revision (C2)."""
    who = page.draft_updated_by.full_name if page.draft_updated_by_id and page.draft_updated_by else ''
    when = serializers.DateTimeField().to_representation(page.draft_updated_at) if page.draft_updated_at else None
    detail = (f'{who or "Otra persona"} guardó cambios en esta página mientras usted la editaba. '
              'Recargue para ver la versión más reciente antes de seguir; sus cambios no se guardaron.')
    return {'code': DRAFT_CONFLICT_CODE, 'detail': detail, 'draft_revision': page.draft_revision,
            'draft_updated_by': who, 'draft_updated_at': when}


class PageDetailView(AuditedCrudMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdmin]  # site content: admin-only (QA 2026-11-24)

    serializer_class = PageAdminSerializer
    queryset = Page.objects.select_related("published_version", "draft_updated_by")
    audit_context = "cms.page"

    def update(self, request, *args, **kwargs):
        """A save that names ``draft_revision`` is refused (409) when someone else saved in between.

        The row stays locked from the check to the write, so two saves of the
        same revision cannot both win. Without ``draft_revision`` the save works
        exactly as before (last write wins), and still bumps the revision.
        A conflict is answered first: a stale draft is not worth validating.
        """
        raw = request.data.get('draft_revision') if hasattr(request.data, 'get') else None
        with transaction.atomic():
            page = (Page.objects.select_for_update().select_related(None)
                    .filter(pk=kwargs.get(self.lookup_url_kwarg or self.lookup_field)).first())
            if page is None:
                raise Http404
            if raw is not None and raw != '':
                try:
                    expected = int(raw)
                except (TypeError, ValueError):
                    return Response({'draft_revision': ['Debe ser un número entero.']}, status=status.HTTP_400_BAD_REQUEST)
                if expected != page.draft_revision:
                    page = Page.objects.select_related('draft_updated_by').get(pk=page.pk)
                    return Response(draft_conflict_payload(page), status=status.HTTP_409_CONFLICT)
            # Invalid blocks answer 400 with structured errors (C3) before the serializer.
            return blocks_error_response(request.data) or super().update(request, *args, **kwargs)

    def perform_destroy(self, instance):
        if getattr(self.request.user, "role", None) != "admin":
            raise PermissionDenied("Solo Dirección puede eliminar páginas.")
        cache.delete(PAGE_CACHE.format(slug=instance.slug))
        super().perform_destroy(instance)


def _public_path(page: Page) -> str:
    from .navigation import page_path

    return page_path(page.slug)


PAGE_EXPORT = ExportSpec(
    filename_prefix="paginas",
    title="Páginas del sitio",
    audit_entity="content.page",
    columns=[
        Col("title", "Título", width=32),
        Col("slug", "Dirección", getter=_public_path, width=28),
        Col("template", "Plantilla", getter=lambda p: p.get_template_display(), width=16),
        Col("status", "Estado", getter=lambda p: p.get_status_display(), width=12),
        Col(
            "version",
            "Versión publicada",
            getter=lambda p: p.published_version.number if p.published_version else None,
            fmt="int",
            width=10,
        ),
        Col("published_at", "Publicada", fmt="datetime", width=18),
        Col("review_requested_at", "Aprobación solicitada", fmt="datetime", width=18),
        Col("updated_at", "Actualizada", fmt="datetime", width=18),
    ],
)


class PageExportView(AdminExportMixin, PageListCreateView):
    """GET /content/admin/pages/export/?fmt=csv|xlsx|pdf&…list filters… (admin)."""

    permission_classes = [IsAdmin]
    http_method_names = ["get", "head", "options"]
    export_spec = PAGE_EXPORT


def _page_delete_guard(page: Page) -> str | None:
    if page.status != Page.Status.DRAFT or page.published_version_id or page.versions.exists():
        return "ya se publicó alguna vez; despublíquela en lugar de eliminarla"
    return None


def _page_destroy(page: Page) -> None:
    cache.delete(PAGE_CACHE.format(slug=page.slug))
    delete_keep_pk(page)


def _page_publish_plan(page: Page, payload) -> None:
    from .publish_checks import review

    if page.status == Page.Status.PUBLISHED and page.published_version_id:
        if not PageAdminSerializer().get_has_unpublished_changes(page):
            raise BulkSkip("ya está publicada sin cambios pendientes")
    if is_legacy_seed(page):
        # Never in bulk: publishing it replaces the designed page, so it needs the editor's confirmation.
        raise BulkSkip("borrador antiguo con bloques genéricos: publíquelo desde el editor para confirmar")
    report = review(page)
    if report["errors"]:
        raise ValueError("Corrija antes de publicar: " + " · ".join(e["message"] for e in report["errors"][:3]))
    if report["warnings"]:
        # Warnings need someone to read them («Entiendo las advertencias»), which a bulk action cannot ask.
        n = len(report["warnings"])
        raise BulkSkip(f"{'tiene una advertencia' if n == 1 else f'tiene {n} advertencias'}: publíquela desde el editor para revisarlas")


def _page_publish(page: Page, payload, actor) -> dict:
    _page_publish_plan(page, payload)
    version = page.publish(actor)
    return {"status": ["draft", "published"], "published_version": version.number}


def _page_unpublish_plan(page: Page, payload) -> None:
    if page.status != Page.Status.PUBLISHED:
        raise BulkSkip("ya es borrador")


def _page_unpublish(page: Page, payload, actor) -> dict:
    _page_unpublish_plan(page, payload)
    page.unpublish(actor)
    return {"status": ["published", "draft"]}


class PageBulkView(AdminBulkView):
    """POST /content/admin/pages/bulk/ — publish (checks per row), unpublish,
    delete (drafts never published only). Admin only, like single publish."""

    entity = "content.page"
    list_view_class = PageListCreateView

    def get_queryset(self):
        return Page.objects.select_related("published_version")

    actions = {
        "publish": BulkAction(
            name="publish",
            label_es="Publicar",
            handler=_page_publish,
            plan=_page_publish_plan,
            side_effects="none",
        ),
        "unpublish": BulkAction(
            name="unpublish",
            label_es="Despublicar",
            handler=_page_unpublish,
            plan=_page_unpublish_plan,
            side_effects="none",
        ),
        "delete": delete_action(guard=_page_delete_guard, destroy=_page_destroy),
    }


class PagePublishView(APIView):
    """POST /content/admin/pages/<pk>/publish/
    {"action": "publish"|"unpublish", "confirm_legacy"?: true, "acknowledge_warnings"?: true, "acknowledged_warnings"?: [key]}

    A draft still in the old generic format (``legacy_seed``) answers 409
    ``{"code": "legacy_seed_draft", "detail"}`` unless ``confirm_legacy`` is true.
    Then «Revisión antes de publicar» (publish_checks.review): any error answers
    409 ``publish_blocked``; warnings answer 409 ``publish_warnings`` until the
    request acknowledges them. Both bodies carry ``errors``, ``warnings``,
    ``issues`` and ``changes``.
    """
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        page = Page.objects.select_related('published_version').filter(pk=pk).first()
        if page is None:
            raise Http404
        action = request.data.get('action', 'publish')
        if action == 'unpublish':
            page.unpublish(request.user)
            return Response(PageAdminSerializer(page).data)
        legacy = is_legacy_seed(page)
        if legacy and not confirmed(request.data.get('confirm_legacy')):
            return legacy_seed_response(page)
        from .publish_checks import publish_refusal, review
        report = review(page)
        refusal = publish_refusal(report, request.data)
        if refusal:
            return Response(refusal, status=status.HTTP_409_CONFLICT)
        v = page.publish(request.user, legacy_confirmed=legacy, acknowledged=[w['key'] for w in report['warnings']])
        data = PageAdminSerializer(page).data
        data['version'] = v.number
        return Response(data)


class PageVersionsView(APIView):
    """GET versions; POST {"version": n} restores that version INTO THE DRAFT.

    Restoring never publishes: the admin reviews the restored draft and publishes
    it through ``PagePublishView``, so a rollback goes through the same
    pre-publish checks as any other publication. The public page keeps showing
    the current published version until then."""
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        page = Page.objects.filter(pk=pk).first()
        if page is None:
            raise Http404
        return Response(PageVersionSerializer(page.versions.all()[:50], many=True).data)

    def post(self, request, pk):
        page = Page.objects.filter(pk=pk).first()
        if page is None:
            raise Http404
        try:
            number = int(request.data.get('version'))
        except (TypeError, ValueError):
            return Response({'version': ['Versión no encontrada.']}, status=status.HTTP_400_BAD_REQUEST)
        v = page.versions.filter(number=number).first()
        if v is None:
            return Response({'version': ['Versión no encontrada.']}, status=status.HTTP_400_BAD_REQUEST)
        page.draft_blocks, page.seo = v.blocks, v.seo
        page.stamp_draft(request.user)
        page.save(update_fields=['draft_blocks', 'seo', 'draft_revision', 'draft_updated_by', 'draft_updated_at', 'updated_at'])
        try:
            from apps.core.audit import record
            record('update', page, {'draft_restored_from': v.number}, actor=request.user,
                   context='cms.restore_version')
        except Exception:  # noqa: BLE001
            pass
        return Response({'restored_from': v.number, 'page': PageAdminSerializer(page).data})


class PageChecksView(APIView):
    """«Revisión antes de publicar» (publish_checks.review) of a page's draft.

    GET  /content/admin/pages/<pk>/checks/   the saved draft
    POST /content/admin/pages/<pk>/checks/   {"draft_blocks"?, "seo"?}: the editor's draft as it is on screen,
                                             saved or not (nothing is stored)

    Answers ``{ok, errors, warnings, issues, changes, baseline}``.
    """
    permission_classes = [IsAdmin]  # site content: admin-only (QA 2026-11-24)

    def _report(self, page, blocks=None, seo=None):
        from .publish_checks import review
        return Response(review(page, blocks=blocks, seo=seo))

    def get(self, request, pk):
        page = Page.objects.select_related('published_version').filter(pk=pk).first()
        if page is None:
            raise Http404
        return self._report(page)

    def post(self, request, pk):
        page = Page.objects.select_related('published_version').filter(pk=pk).first()
        if page is None:
            raise Http404
        blocks = seo = None
        if hasattr(request.data, 'get') and 'draft_blocks' in request.data:
            invalid = blocks_error_response(request.data)
            if invalid is not None:
                return invalid
            blocks = validate_blocks(request.data.get('draft_blocks'))
        if hasattr(request.data, 'get') and isinstance(request.data.get('seo'), dict):
            seo = request.data.get('seo')
        return self._report(page, blocks, seo)


class PagesChecksSummaryView(APIView):
    """GET /content/admin/pages/checks-summary/: the «Contenido» chips of every CMS page.

    Per page: ``draft`` (errors and warnings of the draft), ``live`` (errors of
    what the site shows), ``unpublished_since``. One context for all pages,
    so the queries do not grow with the number of pages.
    """
    permission_classes = [IsAdmin]  # site content: admin-only (QA 2026-11-24)

    def get(self, request):
        from .publish_checks import pages_context, review, summarize

        pages = list(Page.objects.select_related('published_version'))
        ctx = pages_context(pages)
        results = []
        for page in pages:
            live_version = page.status == Page.Status.PUBLISHED and page.published_version_id and page.published_version
            differs = page.draft_differs()
            draft = summarize(review(page, ctx=ctx)) if (differs or not live_version) else None
            live = summarize(review(page, ctx=ctx, live=True)) if live_version else None
            if draft is None and live is not None:
                draft = {**live, 'warnings': 0, 'first_warning': None}
            results.append({
                'id': page.pk, 'slug': page.slug, 'has_unpublished_changes': bool(differs),
                'unpublished_since': serializers.DateTimeField().to_representation(page.unpublished_since) if page.unpublished_since else None,
                'draft': draft, 'live': live,
            })
        return Response({'results': results})


class PageDiscardView(APIView):
    """POST /content/admin/pages/<pk>/discard/ {"draft_revision"?}: «Descartar cambios».

    The draft goes back to the published version (blocks and SEO). Like any
    draft save it bumps the revision; with ``draft_revision`` it answers 409
    ``draft_conflict`` when someone saved in between. Nothing is published.
    """
    permission_classes = [IsAdmin]  # site content: admin-only (QA 2026-11-24)

    def post(self, request, pk):
        with transaction.atomic():
            page = Page.objects.select_for_update().filter(pk=pk).first()
            if page is None:
                raise Http404
            live = page.published_version if page.published_version_id else None
            if page.status != Page.Status.PUBLISHED or live is None:
                return Response({'detail': 'Esta página no tiene una versión publicada a la cual volver.'},
                                status=status.HTTP_400_BAD_REQUEST)
            raw = request.data.get('draft_revision') if hasattr(request.data, 'get') else None
            if raw not in (None, ''):
                try:
                    expected = int(raw)
                except (TypeError, ValueError):
                    return Response({'draft_revision': ['Debe ser un número entero.']}, status=status.HTTP_400_BAD_REQUEST)
                if expected != page.draft_revision:
                    page = Page.objects.select_related('draft_updated_by').get(pk=page.pk)
                    return Response(draft_conflict_payload(page), status=status.HTTP_409_CONFLICT)
            page.draft_blocks, page.seo = live.blocks, live.seo
            page.stamp_draft(request.user)
            page.save(update_fields=['draft_blocks', 'seo', 'draft_revision', 'draft_updated_by', 'draft_updated_at', 'updated_at'])
        try:
            from apps.core.audit import record
            record('update', page, {'draft_discarded_to': live.number}, actor=request.user, context='cms.discard')
        except Exception:  # noqa: BLE001
            pass
        page = Page.objects.select_related('published_version', 'draft_updated_by').get(pk=page.pk)
        return Response(PageAdminSerializer(page).data)


class PageReviewView(APIView):
    """POST /content/admin/pages/<pk>/review/ {"action": "request"|"reject", "note"?}.
    An editor requests approval (Dirección gets an in-app + email notice with the
    preview link); Dirección rejects with a note (requester is notified).
    Publishing clears it. Admin-only since 2026-11-24, like all site content."""
    permission_classes = [IsAdmin]  # site content: admin-only (QA 2026-11-24)

    def post(self, request, pk):
        page = Page.objects.filter(pk=pk).first()
        if page is None:
            raise Http404
        action = request.data.get('action')
        note = str(request.data.get('note') or '')[:300]
        from apps.portal.services import notify
        if action == 'request':
            # An old generic draft is never sent for approval unnoticed: the requester
            # confirms first, and Dirección's notice says what publishing it does.
            legacy = is_legacy_seed(page)
            if legacy and not confirmed(request.data.get('confirm_legacy')):
                return legacy_seed_response(page)
            page.review_requested_at = timezone.now()
            page.review_requested_by = request.user
            page.review_note = ''
            page.save(update_fields=['review_requested_at', 'review_requested_by', 'review_note'])
            from apps.accounts.models import User

            from .navigation import page_path
            url = f"{(settings.FRONTEND_URL or '').rstrip('/')}/p/{page.slug}?preview={page.preview_token()}"
            warning = (' Atención: el borrador usa el formato antiguo de bloques genéricos; al publicarlo, '
                       'la página dejará de verse con su diseño actual.') if legacy else ''
            for admin in User.objects.filter(role='admin', is_active=True):
                notify(admin, 'info', f'Página lista para aprobar: {page.title}',
                       f'{request.user.full_name} solicita publicar {page_path(page.slug)}. Vista previa: {url}{warning}', fanout=False)
            return Response(PageAdminSerializer(page).data)
        if action == 'reject':
            if getattr(request.user, 'role', None) != 'admin':
                raise PermissionDenied('Solo Dirección puede rechazar.')
            requester = page.review_requested_by
            page.review_requested_at = None
            page.review_note = note or 'Cambios solicitados.'
            page.save(update_fields=['review_requested_at', 'review_note'])
            if requester:
                notify(requester, 'info', f'Cambios solicitados en {page.title}', page.review_note, fanout=False)
            return Response(PageAdminSerializer(page).data)
        return Response({'action': ['Use request o reject.']}, status=status.HTTP_400_BAD_REQUEST)


class PagePreviewTokenView(APIView):
    """POST /content/admin/pages/<pk>/preview-token/ — shareable 7-day preview link (P3-10)."""
    permission_classes = [IsAdmin]  # site content: admin-only (QA 2026-11-24)

    def post(self, request, pk):
        page = Page.objects.filter(pk=pk).first()
        if page is None:
            raise Http404
        token = page.preview_token()
        return Response({'token': token, 'url': f"{(settings.FRONTEND_URL or '').rstrip('/')}/p/{page.slug}?preview={token}"})
