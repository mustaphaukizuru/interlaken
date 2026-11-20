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
         GET /content/pages/<id>/preview/?token=   draft, signed token (1 h)
Admin:   CRUD /content/admin/pages/, POST .../publish/, POST .../rollback/{version}
"""
from __future__ import annotations

import hashlib
import json
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
from apps.core.permissions import IsAdmin, IsAdminOrStaff

from .ops import AuditedCrudMixin, delete_action, delete_keep_pk, tri_state

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
}
_PY = {'str': str, 'int': int, 'list': list, 'dict': dict, 'bool': bool, 'num': (int, float), 'image': (int, str)}

MANIFEST_PATH = Path(__file__).with_name('block_manifest.json')
MAX_DRAFT_BYTES = 512 * 1024   # a whole page of sections is ~20 KB; this only stops abuse


@lru_cache(maxsize=1)
def manifest() -> dict:
    """{type: {label, group, locked, required{name: kind}, images[paths]}} for every block type."""
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


def validate_blocks(blocks) -> list[dict]:
    if not isinstance(blocks, list):
        raise serializers.ValidationError({'blocks': 'Debe ser una lista de bloques.'})
    if len(json.dumps(blocks)) > MAX_DRAFT_BYTES:
        raise serializers.ValidationError({'blocks': 'La página es demasiado grande; divídala en varias páginas.'})
    out = []
    for i, b in enumerate(blocks):
        if not isinstance(b, dict) or 'type' not in b:
            raise serializers.ValidationError({'blocks': f'Bloque #{i + 1} inválido.'})
        schema = section_schema(b['type'])
        if schema is None:
            raise serializers.ValidationError({'blocks': f'Tipo de bloque desconocido: {b["type"]}'})
        props = b.get('props') or {}
        if not isinstance(props, dict):
            raise serializers.ValidationError({'blocks': f'Bloque #{i + 1}: props inválidas.'})
        for name, kind in schema.items():
            if name not in props or not isinstance(props[name], _PY[kind]):
                raise serializers.ValidationError({'blocks': f'Bloque #{i + 1} ({b["type"]}): falta "{name}".'})
        block = {'id': str(b.get('id') or uuid.uuid4().hex[:8])[:40], 'type': b['type'], 'props': props}
        if b.get('hidden') is True:
            block['hidden'] = True
        out.append(block)
    return out


def image_refs(block: dict) -> list[int]:
    """Media-library ids a block uses, following the image paths of its type ("poster", "items[].image")."""
    paths = manifest().get(block.get('type'), {}).get('images') or ['image', 'images[].image']
    found: list[int] = []

    def walk(value, parts):
        if not parts:
            if isinstance(value, int) and not isinstance(value, bool) and value > 0:
                found.append(value)
            return
        head, rest = parts[0], parts[1:]
        if head.endswith('[]'):
            items = value.get(head[:-2]) if isinstance(value, dict) else None
            for it in items if isinstance(items, list) else []:
                walk(it, rest)
        elif isinstance(value, dict):
            walk(value.get(head), rest)

    for path in paths:
        walk(block.get('props') or {}, path.replace('[].', '[] ').replace('.', ' ').split())
    return found


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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['slug']
        verbose_name = 'Página (CMS)'
        verbose_name_plural = 'Páginas (CMS)'

    def __str__(self):
        return f'/{self.slug} ({self.get_status_display()})'

    def stamp_draft(self, user) -> None:
        """One more draft save: bump the revision and remember who and when (caller saves)."""
        self.draft_revision = (self.draft_revision or 0) + 1
        self.draft_updated_by = user if getattr(user, 'pk', None) else None
        self.draft_updated_at = timezone.now()

    def publish(self, user, *, legacy_confirmed: bool = False) -> PageVersion:
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
                  'created_at', 'updated_at']
        read_only_fields = ['id', 'status', 'published_at', 'review_requested_at', 'review_requested_by_name', 'review_note',
                            'draft_revision', 'draft_updated_at', 'created_at', 'updated_at']

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
            # A designed page without SEO of its own keeps the template's («Costos 2026–2027»),
            # exactly as the browser does (TemplatePage), so crawlers see the same head.
            defaults = template_seo(slug)
            head = {
                'title': (seo.get('title') or '').strip() or defaults['title'],
                'description': (seo.get('description') or '').strip() or defaults['description'],
                'image': f'{SITE}/api/v1/content/media/{og}/lg/' if isinstance(og, int) and not isinstance(og, bool) else '',
                'noindex': bool(seo.get('noindex')),
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
class PublicPageView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, slug):
        key = PAGE_CACHE.format(slug=slug)
        payload = cache.get(key)
        if payload is None:
            try:
                page = Page.objects.select_related('published_version').get(slug=slug, status=Page.Status.PUBLISHED)
            except Page.DoesNotExist:
                raise Http404 from None
            if page.unpublish_at and page.unpublish_at <= timezone.now():
                page.unpublish(None)
                raise Http404
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

    permission_classes = [IsAdminOrStaff]
    serializer_class = PageAdminSerializer
    search_fields = ("title", "slug")
    ordering = PAGE_ORDERING
    default_ordering = "slug"
    filterset_class = PageFilterSet
    audit_context = "cms.page"

    def get_queryset(self):
        return Page.objects.select_related("published_version", "review_requested_by", "draft_updated_by")


def draft_conflict_payload(page: Page) -> dict:
    """409 body when a save names an older draft_revision (C2)."""
    who = page.draft_updated_by.full_name if page.draft_updated_by_id and page.draft_updated_by else ''
    when = serializers.DateTimeField().to_representation(page.draft_updated_at) if page.draft_updated_at else None
    detail = (f'{who or "Otra persona"} guardó cambios en esta página mientras usted la editaba. '
              'Recargue para ver la versión más reciente antes de seguir; sus cambios no se guardaron.')
    return {'code': DRAFT_CONFLICT_CODE, 'detail': detail, 'draft_revision': page.draft_revision,
            'draft_updated_by': who, 'draft_updated_at': when}


class PageDetailView(AuditedCrudMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdminOrStaff]

    serializer_class = PageAdminSerializer
    queryset = Page.objects.select_related("published_version", "draft_updated_by")
    audit_context = "cms.page"

    def update(self, request, *args, **kwargs):
        """A save that names ``draft_revision`` is refused (409) when someone else saved in between.

        The row stays locked from the check to the write, so two saves of the
        same revision cannot both win. Without ``draft_revision`` the save works
        exactly as before (last write wins), and still bumps the revision.
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
            return super().update(request, *args, **kwargs)

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
    from .checks import run_checks

    if page.status == Page.Status.PUBLISHED and page.published_version_id:
        if not PageAdminSerializer().get_has_unpublished_changes(page):
            raise BulkSkip("ya está publicada sin cambios pendientes")
    if is_legacy_seed(page):
        # Never in bulk: publishing it replaces the designed page, so it needs the editor's confirmation.
        raise BulkSkip("borrador antiguo con bloques genéricos: publíquelo desde el editor para confirmar")
    errors = [i for i in run_checks(page) if i["level"] == "error"]
    if errors:
        raise ValueError("Corrija antes de publicar: " + " · ".join(e["message"] for e in errors[:3]))


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
    """POST /content/admin/pages/<pk>/publish/  {"action": "publish"|"unpublish", "confirm_legacy"?: true}

    A draft still in the old generic format (``legacy_seed``) answers 409
    ``{"code": "legacy_seed_draft", "detail"}`` unless ``confirm_legacy`` is true.
    """
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        page = Page.objects.filter(pk=pk).first()
        if page is None:
            raise Http404
        action = request.data.get('action', 'publish')
        if action == 'unpublish':
            page.unpublish(request.user)
            return Response(PageAdminSerializer(page).data)
        legacy = is_legacy_seed(page)
        if legacy and not confirmed(request.data.get('confirm_legacy')):
            return legacy_seed_response(page)
        # Pre-publish checks (P3-12): errors block, warnings are informative.
        from .checks import run_checks
        issues = run_checks(page)
        errors = [i for i in issues if i['level'] == 'error']
        if errors:
            return Response({'detail': 'Corrija antes de publicar: ' + ' · '.join(e['message'] for e in errors[:5]), 'issues': issues},
                            status=status.HTTP_400_BAD_REQUEST)
        v = page.publish(request.user, legacy_confirmed=legacy)
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
    """GET /content/admin/pages/<pk>/checks/ — pre-publish checklist (P3-12)."""
    permission_classes = [IsAdminOrStaff]

    def get(self, request, pk):
        page = Page.objects.filter(pk=pk).first()
        if page is None:
            raise Http404
        from .checks import run_checks
        issues = run_checks(page)
        return Response({'issues': issues, 'ok': not any(i['level'] == 'error' for i in issues)})


class PageReviewView(APIView):
    """POST /content/admin/pages/<pk>/review/ {"action": "request"|"reject", "note"?}.
    Staff request approval (Dirección gets an in-app + email notice with the preview
    link); admins reject with a note (requester is notified). Publishing clears it."""
    permission_classes = [IsAdminOrStaff]

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
    permission_classes = [IsAdminOrStaff]

    def post(self, request, pk):
        page = Page.objects.filter(pk=pk).first()
        if page is None:
            raise Http404
        token = page.preview_token()
        return Response({'token': token, 'url': f"{(settings.FRONTEND_URL or '').rstrip('/')}/p/{page.slug}?preview={token}"})
