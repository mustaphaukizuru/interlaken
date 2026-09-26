"""
content/media.py — CMS media library (CMS-PLAN phase 1, BACKLOG P3-1).

``MediaAsset`` stores the original in the default storage (Supabase private
bucket in prod) plus WebP variants generated with Pillow. Public delivery is
``GET /api/v1/content/media/<id>/<variant>/`` which streams from storage with
long cache headers, so the bucket never has to be public.
"""
from __future__ import annotations

import hashlib
import io
import mimetypes
from pathlib import Path

import django_filters
from django.core.files.base import ContentFile
from django.db import models
from django.http import FileResponse, Http404, HttpResponseNotModified
from django.utils import timezone
from rest_framework import generics, permissions, serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.bulk import AdminBulkView, BulkAction, BulkSkip
from apps.core.exporting import AdminExportMixin, Col, ExportSpec
from apps.core.listing import AdminListMixin, apply_date_range
from apps.core.permissions import IsAdminOrStaff

from .ops import AuditedCrudMixin, delete_action, delete_keep_pk, referenced_media_ids, tri_state

MAX_UPLOAD = 10 * 1024 * 1024
VARIANTS = {'thumb': 320, 'md': 960, 'lg': 1600}
ALLOWED_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}


def _upload_to(instance, filename):
    stamp = timezone.now().strftime('%Y/%m')
    return f'cms/{stamp}/{instance.pk or "new"}-{Path(filename).name}'


class MediaAsset(models.Model):
    file = models.FileField(upload_to=_upload_to)
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=80)
    size = models.PositiveIntegerField(default=0)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    alt = models.CharField('Texto alternativo', max_length=200, blank=True)
    caption = models.CharField('Pie de foto', max_length=300, blank=True)
    focal_x = models.FloatField(default=0.5)
    focal_y = models.FloatField(default=0.5)
    tags = models.CharField(max_length=200, blank=True, help_text='Separadas por coma')
    # {'thumb': 'cms/2026/08/12-x-thumb.webp', 'md': ..., 'lg': ...}
    variants = models.JSONField(default=dict, blank=True)
    sha256 = models.CharField(max_length=64, blank=True, db_index=True)
    uploaded_by = models.ForeignKey('accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Imagen (CMS)'
        verbose_name_plural = 'Biblioteca de medios'

    def __str__(self):
        return self.filename

    @property
    def is_image(self):
        return self.content_type.startswith('image/')

    def public_url(self, variant: str = 'original') -> str:
        return f'/api/v1/content/media/{self.pk}/{variant}/'


def build_variants(asset: MediaAsset) -> dict:
    """Generate WebP variants for images; non-images get none. Never raises."""
    if not asset.is_image or asset.content_type == 'image/gif':
        return {}
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover
        return {}
    out = {}
    try:
        asset.file.open('rb')
        img = Image.open(asset.file)
        img = ImageOps.exif_transpose(img)
        asset.width, asset.height = img.size
        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')
        base = Path(asset.file.name)
        for key, max_w in VARIANTS.items():
            if img.width <= max_w and key != 'thumb':
                continue
            v = img.copy()
            v.thumbnail((max_w, max_w * 4), Image.LANCZOS)
            buf = io.BytesIO()
            v.save(buf, format='WEBP', quality=82, method=4)
            name = f'{base.with_suffix("")}-{key}.webp'
            saved = asset.file.storage.save(name, ContentFile(buf.getvalue()))
            out[key] = saved
    except Exception:  # noqa: BLE001 - variants are best effort
        return out
    finally:
        try:
            asset.file.close()
        except Exception:  # noqa: BLE001
            pass
    return out


class MediaAssetSerializer(serializers.ModelSerializer):
    urls = serializers.SerializerMethodField()
    referenced = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = ['id', 'filename', 'content_type', 'size', 'width', 'height', 'alt', 'caption',
                  'focal_x', 'focal_y', 'tags', 'urls', 'referenced', 'uploaded_by', 'created_at', 'updated_at']
        read_only_fields = ['id', 'filename', 'content_type', 'size', 'width', 'height', 'urls',
                            'referenced', 'uploaded_by', 'created_at', 'updated_at']

    def get_urls(self, a):
        urls = {'original': a.public_url('original')}
        for k in a.variants:
            urls[k] = a.public_url(k)
        return urls

    def get_referenced(self, a):
        refs = self.context.get('referenced_ids')
        return None if refs is None else a.pk in refs


def destroy_asset(instance: MediaAsset) -> None:
    """Delete the variants, the original and the row (storage errors never block)."""
    storage = instance.file.storage
    for name in list(instance.variants.values()):
        try:
            storage.delete(name)
        except Exception:  # noqa: BLE001
            pass
    try:
        instance.file.delete(save=False)
    except Exception:  # noqa: BLE001
        pass
    delete_keep_pk(instance)


MEDIA_TYPES = {'jpeg': 'image/jpeg', 'jpg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif'}


class MediaFilterSet(django_filters.FilterSet):
    """``?type=png|jpeg|webp|gif&from=&to=&unreferenced=1&missing_alt=1``."""

    type = django_filters.CharFilter(method='filter_type')
    unreferenced = django_filters.CharFilter(method='filter_unreferenced')
    missing_alt = django_filters.CharFilter(method='filter_missing_alt')

    class Meta:
        model = MediaAsset
        fields: list[str] = []

    def filter_type(self, qs, _name, value):
        ctype = MEDIA_TYPES.get(str(value).lower(), value)
        return qs.filter(content_type=ctype) if ctype else qs

    def filter_unreferenced(self, qs, _name, value):
        flag = tri_state(value)
        if flag is None:
            return qs
        refs = referenced_media_ids()
        return qs.exclude(pk__in=refs) if flag else qs.filter(pk__in=refs)

    def filter_missing_alt(self, qs, _name, value):
        flag = tri_state(value)
        if flag is None:
            return qs
        return qs.filter(alt='') if flag else qs.exclude(alt='')

    @property
    def qs(self):
        qs = super().qs
        params = self.data or {}
        return apply_date_range(qs, 'created_at', params.get('from'), params.get('to'))


MEDIA_ORDERING = {
    'created': 'created_at',
    'filename': 'filename',
    'size': 'size',
    'type': 'content_type',
    'alt': 'alt',
}


class MediaListCreateView(AuditedCrudMixin, AdminListMixin, generics.ListCreateAPIView):
    """GET /content/admin/media/?q=&type=&from=&to=&unreferenced=&ordering=
    POST multipart {file, alt, caption, tags}; an identical file (sha256) → 409
    ``{detail, existing}`` so the uploader can reuse the asset instead."""
    permission_classes = [IsAdminOrStaff]
    serializer_class = MediaAssetSerializer
    parser_classes = [MultiPartParser, FormParser]
    search_fields = ('filename', 'alt', 'caption', 'tags')
    ordering = MEDIA_ORDERING
    default_ordering = '-created_at'
    filterset_class = MediaFilterSet
    audit_context = 'cms.media'

    def get_queryset(self):
        return MediaAsset.objects.all()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.request.method == 'GET':
            ctx['referenced_ids'] = referenced_media_ids()
        return ctx

    def create(self, request, *args, **kwargs):
        f = request.FILES.get('file')
        if not f:
            return Response({'file': ['Seleccione un archivo.']}, status=status.HTTP_400_BAD_REQUEST)
        if f.size > MAX_UPLOAD:
            return Response({'file': ['El archivo supera 10 MB.']}, status=status.HTTP_400_BAD_REQUEST)
        ctype = f.content_type or mimetypes.guess_type(f.name)[0] or 'application/octet-stream'
        if ctype not in ALLOWED_TYPES:
            return Response({'file': ['Solo imágenes JPG, PNG, WebP o GIF.']}, status=status.HTTP_400_BAD_REQUEST)
        digest = hashlib.sha256()
        for chunk in f.chunks():
            digest.update(chunk)
        f.seek(0)
        sha = digest.hexdigest()
        existing = MediaAsset.objects.filter(sha256=sha).order_by('pk').first()
        if existing is not None:
            return Response(
                {'detail': f'Ya existe en la biblioteca: {existing.filename}.',
                 'existing': MediaAssetSerializer(existing).data},
                status=status.HTTP_409_CONFLICT,
            )
        asset = MediaAsset(filename=f.name[:255], content_type=ctype, size=f.size, sha256=sha,
                           alt=(request.data.get('alt') or '').strip()[:200],
                           caption=(request.data.get('caption') or '').strip()[:300],
                           tags=(request.data.get('tags') or '').strip()[:200],
                           uploaded_by=request.user)
        asset.file.save(f.name, f, save=False)
        asset.save()
        asset.variants = build_variants(asset)
        asset.save(update_fields=['variants', 'width', 'height'])
        record('create', asset, {'filename': [None, asset.filename], 'size': [None, asset.size]},
               actor=request.user, context=self.audit_context)
        return Response(MediaAssetSerializer(asset).data, status=status.HTTP_201_CREATED)


class MediaDetailView(AuditedCrudMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdminOrStaff]
    serializer_class = MediaAssetSerializer
    queryset = MediaAsset.objects.all()
    audit_context = 'cms.media'

    def perform_destroy(self, instance):
        destroy_asset(instance)
        record('delete', instance, {'filename': [instance.filename, None]},
               actor=self.request.user, context=self.audit_context)


MEDIA_EXPORT = ExportSpec(
    filename_prefix='medios',
    title='Biblioteca de medios',
    audit_entity='content.mediaasset',
    columns=[
        Col('filename', 'Archivo', width=32),
        Col('content_type', 'Tipo', width=12),
        Col('size', 'Tamaño (bytes)', fmt='int', width=12),
        Col('dimensions', 'Dimensiones', getter=lambda a: f'{a.width}×{a.height}' if a.width else '', width=12),
        Col('alt', 'Texto alternativo', width=36),
        Col('tags', 'Etiquetas', width=24),
        Col('url', 'URL', getter=lambda a: a.public_url('original'), width=36),
        Col('created_at', 'Subida', fmt='datetime', width=18),
    ],
)


class MediaExportView(AdminExportMixin, MediaListCreateView):
    """GET /content/admin/media/export/?fmt=csv|xlsx|pdf&…list filters…"""
    http_method_names = ['get', 'head', 'options']
    export_spec = MEDIA_EXPORT


def _add_tag_plan(asset, payload):
    tag = str(payload.get('tag') or '').strip().lower()[:40]
    if not tag or ',' in tag:
        raise ValueError('Indique una etiqueta (sin comas).')
    current = [t.strip().lower() for t in asset.tags.split(',') if t.strip()]
    if tag in current:
        raise BulkSkip('ya tiene esa etiqueta')
    if len(', '.join([*current, tag])) > 200:
        raise ValueError('Las etiquetas superan 200 caracteres.')
    return current, tag


def _add_tag(asset, payload, actor):
    current, tag = _add_tag_plan(asset, payload)
    before = asset.tags
    asset.tags = ', '.join([*current, tag])
    asset.save(update_fields=['tags', 'updated_at'])
    return {'tags': [before, asset.tags]}


class MediaBulkView(AdminBulkView):
    """POST /content/admin/media/bulk/ — ``delete`` (unreferenced only) and
    ``add_tag`` (payload ``tag``). Staff manage media like admins do."""
    permission_classes = [IsAdminOrStaff]
    entity = 'content.mediaasset'
    list_view_class = MediaListCreateView
    actions = {
        'delete': delete_action(destroy=destroy_asset),
        'add_tag': BulkAction(name='add_tag', label_es='Agregar etiqueta', handler=_add_tag,
                              plan=_add_tag_plan, side_effects='none'),
    }

    def get_action(self, name):
        action = super().get_action(name)
        if name == 'delete':
            refs = referenced_media_ids()  # once per request, not once per row
            return delete_action(
                destroy=destroy_asset,
                guard=lambda a: 'se usa en una página o comunicado' if a.pk in refs else None,
            )
        return action


class MediaServeView(APIView):
    """GET /content/media/<pk>/<variant>/ — public, cached, streamed from storage."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk, variant='original'):
        try:
            asset = MediaAsset.objects.get(pk=pk)
        except MediaAsset.DoesNotExist:
            raise Http404 from None
        name = asset.file.name if variant == 'original' else asset.variants.get(variant)
        if not name:
            raise Http404
        etag = f'"{asset.sha256[:16]}-{variant}"'
        if request.headers.get('If-None-Match') == etag:
            return HttpResponseNotModified()
        storage = asset.file.storage
        try:
            fh = storage.open(name, 'rb')
        except Exception:  # noqa: BLE001
            raise Http404 from None
        ctype = 'image/webp' if name.endswith('.webp') else asset.content_type
        resp = FileResponse(fh, content_type=ctype)
        resp['Cache-Control'] = 'public, max-age=31536000, immutable'
        resp['ETag'] = etag
        return resp
