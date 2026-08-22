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

from django.core.files.base import ContentFile
from django.db import models
from django.http import FileResponse, Http404, HttpResponseNotModified
from django.utils import timezone
from rest_framework import generics, permissions, serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin, IsAdminOrStaff

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

    class Meta:
        model = MediaAsset
        fields = ['id', 'filename', 'content_type', 'size', 'width', 'height', 'alt', 'caption',
                  'focal_x', 'focal_y', 'tags', 'urls', 'uploaded_by', 'created_at', 'updated_at']
        read_only_fields = ['id', 'filename', 'content_type', 'size', 'width', 'height', 'urls',
                            'uploaded_by', 'created_at', 'updated_at']

    def get_urls(self, a):
        urls = {'original': a.public_url('original')}
        for k in a.variants:
            urls[k] = a.public_url(k)
        return urls


class MediaListCreateView(generics.ListCreateAPIView):
    """GET /content/admin/media/?q=   POST multipart {file, alt, caption, tags}"""
    permission_classes = [IsAdminOrStaff]
    serializer_class = MediaAssetSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        qs = MediaAsset.objects.all()
        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(models.Q(filename__icontains=q) | models.Q(alt__icontains=q) | models.Q(tags__icontains=q))
        return qs

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
        asset = MediaAsset(filename=f.name[:255], content_type=ctype, size=f.size, sha256=digest.hexdigest(),
                           alt=(request.data.get('alt') or '').strip()[:200],
                           caption=(request.data.get('caption') or '').strip()[:300],
                           tags=(request.data.get('tags') or '').strip()[:200],
                           uploaded_by=request.user)
        asset.file.save(f.name, f, save=False)
        asset.save()
        asset.variants = build_variants(asset)
        asset.save(update_fields=['variants', 'width', 'height'])
        return Response(MediaAssetSerializer(asset).data, status=status.HTTP_201_CREATED)


class MediaDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdminOrStaff]
    serializer_class = MediaAssetSerializer
    queryset = MediaAsset.objects.all()

    def perform_destroy(self, instance):
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
        instance.delete()


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
