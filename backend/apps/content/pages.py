"""
content/pages.py — block-based pages (CMS-PLAN phase 2, BACKLOG P3-3).

Page          slug, title, template, status, seo, published version pointer
PageVersion   immutable snapshot of blocks JSON; every publish = a new version
Blocks        [{id, type, props}] validated against BLOCK_SCHEMAS (mirrored in
              frontend/src/cms/blocks/registry.ts; keep both in sync).

Public:  GET /content/pages/<slug>/               published blocks, cached + ETag
         GET /content/pages/<id>/preview/?token=   draft, signed token (1 h)
Admin:   CRUD /content/admin/pages/, POST .../publish/, POST .../rollback/{version}
"""
from __future__ import annotations

import hashlib
import json
import uuid

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.db import models, transaction
from django.http import Http404
from django.utils import timezone
from rest_framework import generics, permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin

PAGE_CACHE = 'cms:page:{slug}'
PREVIEW_SALT = 'cms-preview'
PREVIEW_MAX_AGE = 3600

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
_PY = {'str': str, 'int': int, 'list': list, 'dict': dict}


def validate_blocks(blocks) -> list[dict]:
    if not isinstance(blocks, list):
        raise serializers.ValidationError({'blocks': 'Debe ser una lista de bloques.'})
    out = []
    for i, b in enumerate(blocks):
        if not isinstance(b, dict) or 'type' not in b:
            raise serializers.ValidationError({'blocks': f'Bloque #{i + 1} inválido.'})
        schema = BLOCK_SCHEMAS.get(b['type'])
        if schema is None:
            raise serializers.ValidationError({'blocks': f'Tipo de bloque desconocido: {b["type"]}'})
        props = b.get('props') or {}
        if not isinstance(props, dict):
            raise serializers.ValidationError({'blocks': f'Bloque #{i + 1}: props inválidas.'})
        for name, kind in schema.items():
            if name not in props or not isinstance(props[name], _PY[kind]):
                raise serializers.ValidationError({'blocks': f'Bloque #{i + 1} ({b["type"]}): falta "{name}".'})
        out.append({'id': b.get('id') or uuid.uuid4().hex[:8], 'type': b['type'], 'props': props})
    return out


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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['slug']
        verbose_name = 'Página (CMS)'
        verbose_name_plural = 'Páginas (CMS)'

    def __str__(self):
        return f'/{self.slug} ({self.get_status_display()})'

    def publish(self, user) -> PageVersion:
        number = (self.versions.aggregate(m=models.Max('number'))['m'] or 0) + 1
        with transaction.atomic():
            v = PageVersion.objects.create(page=self, number=number, blocks=self.draft_blocks, seo=self.seo, author=user)
            self.published_version = v
            self.status = self.Status.PUBLISHED
            self.published_at = timezone.now()
            self.save(update_fields=['published_version', 'status', 'published_at'])
        cache.delete(PAGE_CACHE.format(slug=self.slug))
        cache.delete('cms:sitemap')
        try:
            from apps.core.audit import record
            record('update', self, {'published_version': number}, actor=user, context='cms.publish')
        except Exception:  # noqa: BLE001
            pass
        return v

    def unpublish(self, user):
        self.status = self.Status.DRAFT
        self.save(update_fields=['status'])
        cache.delete(PAGE_CACHE.format(slug=self.slug))
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
# Serializers
# ---------------------------------------------------------------------------
class PageVersionSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source='author.full_name', read_only=True, default='')

    class Meta:
        model = PageVersion
        fields = ['id', 'number', 'blocks', 'seo', 'author_name', 'created_at']


class PageAdminSerializer(serializers.ModelSerializer):
    published_version_number = serializers.IntegerField(source='published_version.number', read_only=True, default=None)
    has_unpublished_changes = serializers.SerializerMethodField()

    class Meta:
        model = Page
        fields = ['id', 'slug', 'title', 'template', 'status', 'draft_blocks', 'seo',
                  'published_version_number', 'has_unpublished_changes', 'published_at', 'created_at', 'updated_at']
        read_only_fields = ['id', 'status', 'published_at', 'created_at', 'updated_at']

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


def _public_payload(page: Page, blocks, seo) -> dict:
    return {'slug': page.slug, 'title': page.title, 'template': page.template, 'blocks': blocks,
            'seo': seo, 'published_at': page.published_at.isoformat() if page.published_at else None}


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
            v = page.published_version
            payload = _public_payload(page, v.blocks if v else [], v.seo if v else page.seo)
            cache.set(key, payload, 300)
        etag = '"' + hashlib.md5(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16] + '"'
        if request.headers.get('If-None-Match') == etag:
            return Response(status=status.HTTP_304_NOT_MODIFIED)
        resp = Response(payload)
        resp['ETag'] = etag
        resp['Cache-Control'] = 'public, max-age=60'
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


class PageListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAdmin]
    serializer_class = PageAdminSerializer
    queryset = Page.objects.select_related('published_version')


class PageDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdmin]
    serializer_class = PageAdminSerializer
    queryset = Page.objects.select_related('published_version')

    def perform_destroy(self, instance):
        cache.delete(PAGE_CACHE.format(slug=instance.slug))
        instance.delete()


class PagePublishView(APIView):
    """POST /content/admin/pages/<pk>/publish/  {"action": "publish"|"unpublish"}"""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        page = Page.objects.filter(pk=pk).first()
        if page is None:
            raise Http404
        action = request.data.get('action', 'publish')
        if action == 'unpublish':
            page.unpublish(request.user)
            return Response(PageAdminSerializer(page).data)
        # Alt text is required on every image block before publishing (guardrail).
        from .media import MediaAsset
        ids = [b['props'].get('image') for b in page.draft_blocks if b['type'] in ('image', 'hero') and b['props'].get('image')]
        ids += [im.get('image') for b in page.draft_blocks if b['type'] == 'gallery' for im in b['props'].get('images', [])]
        missing = MediaAsset.objects.filter(pk__in=[i for i in ids if i], alt='').values_list('filename', flat=True)
        if missing:
            return Response({'detail': 'Agregue texto alternativo a: ' + ', '.join(missing)}, status=status.HTTP_400_BAD_REQUEST)
        v = page.publish(request.user)
        data = PageAdminSerializer(page).data
        data['version'] = v.number
        return Response(data)


class PageVersionsView(APIView):
    """GET versions; POST {"version": n} to roll back (copies into draft and publishes)."""
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
        v = page.versions.filter(number=request.data.get('version')).first()
        if v is None:
            return Response({'version': ['Versión no encontrada.']}, status=status.HTTP_400_BAD_REQUEST)
        page.draft_blocks, page.seo = v.blocks, v.seo
        page.save(update_fields=['draft_blocks', 'seo'])
        nv = page.publish(request.user)
        return Response({'restored_from': v.number, 'version': nv.number})


class PagePreviewTokenView(APIView):
    """POST /content/admin/pages/<pk>/preview-token/ — shareable 1 h preview link (P3-10)."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        page = Page.objects.filter(pk=pk).first()
        if page is None:
            raise Http404
        token = page.preview_token()
        return Response({'token': token, 'url': f"{(settings.FRONTEND_URL or '').rstrip('/')}/{page.slug}?preview={token}"})
