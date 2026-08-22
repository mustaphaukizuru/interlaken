"""
Site navigation, redirects and sitemap (CMS-PLAN phase 6, BACKLOG P3-7).

menu      SiteSettings.menu JSON: [{label, items:[{label, to, icon?}]}].
          Empty list = the frontend keeps its built-in menu. The footer and
          the mobile drawer mirror the same groups, so one edit updates all.
Redirect  from_path -> to_path (301/302). Resolved by the SPA before it shows
          a 404 (GET /content/redirects/) and by the sitemap exclusions.
Sitemap   /sitemap.xml: static routes + published CMS pages, cached 1 h.
"""
from __future__ import annotations

import re

from django.core.cache import cache
from django.db import models
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, permissions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin

PATH_RE = re.compile(r'^/[A-Za-z0-9\-._~/]*$')
SITEMAP_CACHE_KEY = 'cms:sitemap'
REDIRECTS_CACHE_KEY = 'cms:redirects'
SITE = 'https://interlaken.edu.mx'

# Routes that live in code (App.tsx). Slugs of published CMS pages are added.
STATIC_ROUTES = [
    ('/', 'weekly', '1.0'), ('/nosotros', 'monthly', '0.8'), ('/modelo-educativo', 'monthly', '0.7'),
    ('/galeria', 'monthly', '0.5'), ('/niveles/preescolar', 'monthly', '0.8'), ('/niveles/primaria', 'monthly', '0.8'),
    ('/niveles/secundaria', 'monthly', '0.8'), ('/admisiones', 'weekly', '0.9'), ('/admisiones/documentacion', 'monthly', '0.6'),
    ('/admisiones/costos', 'monthly', '0.7'), ('/pre-registro', 'monthly', '0.8'), ('/agendar-visita', 'weekly', '0.7'),
    ('/contacto', 'monthly', '0.6'), ('/calendario', 'weekly', '0.6'), ('/comunidad/plataformas', 'monthly', '0.4'),
    ('/comunidad/facturacion', 'monthly', '0.3'), ('/aviso-de-privacidad', 'yearly', '0.2'),
]


def validate_menu(menu) -> list[dict]:
    if not isinstance(menu, list):
        raise serializers.ValidationError({'menu': 'Debe ser una lista de grupos.'})
    if len(menu) > 8:
        raise serializers.ValidationError({'menu': 'Máximo 8 grupos.'})
    out = []
    for gi, g in enumerate(menu):
        if not isinstance(g, dict) or not str(g.get('label', '')).strip():
            raise serializers.ValidationError({'menu': f'Grupo #{gi + 1}: falta el nombre.'})
        items = g.get('items')
        if not isinstance(items, list) or not items or len(items) > 10:
            raise serializers.ValidationError({'menu': f'Grupo "{g["label"]}": entre 1 y 10 enlaces.'})
        clean_items = []
        for it in items:
            label, to = (it or {}).get('label', ''), (it or {}).get('to', '')
            if not str(label).strip():
                raise serializers.ValidationError({'menu': f'Grupo "{g["label"]}": un enlace no tiene texto.'})
            if not isinstance(to, str) or not (PATH_RE.match(to) or to.startswith('https://')):
                raise serializers.ValidationError({'menu': f'Enlace "{label}": la ruta debe empezar con / o https://.'})
            clean_items.append({'label': str(label).strip()[:60], 'to': to[:200], 'icon': str((it or {}).get('icon') or '')[:40]})
        out.append({'label': str(g['label']).strip()[:40], 'items': clean_items})
    return out


class Redirect(models.Model):
    from_path = models.CharField(max_length=200, unique=True, help_text='Ruta antigua, p. ej. /inscripciones')
    to_path = models.CharField(max_length=500, help_text='Ruta nueva o URL completa')
    permanent = models.BooleanField(default=True, help_text='301 (permanente) o 302 (temporal)')
    hits = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['from_path']
        verbose_name = 'Redirección'
        verbose_name_plural = 'Redirecciones'

    def __str__(self):
        return f'{self.from_path} → {self.to_path}'

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        cache.delete(REDIRECTS_CACHE_KEY)
        cache.delete(SITEMAP_CACHE_KEY)

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        cache.delete(REDIRECTS_CACHE_KEY)


class RedirectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Redirect
        fields = ['id', 'from_path', 'to_path', 'permanent', 'hits', 'created_at']
        read_only_fields = ['hits', 'created_at']

    def validate_from_path(self, v):
        v = v.strip().rstrip('/') or '/'
        if not PATH_RE.match(v) or v.startswith('/api/') or v.startswith('/admin'):
            raise serializers.ValidationError('Ruta no válida (debe empezar con / y no puede ser /api o /admin).')
        return v

    def validate_to_path(self, v):
        v = v.strip()
        if not (PATH_RE.match(v) or v.startswith('https://')):
            raise serializers.ValidationError('Debe ser una ruta (/…) o una URL https://.')
        return v

    def validate(self, attrs):
        if attrs.get('from_path') and attrs.get('from_path') == attrs.get('to_path'):
            raise serializers.ValidationError({'to_path': 'El destino es igual al origen.'})
        return attrs


class PublicRedirectsView(APIView):
    """GET /content/redirects/ — {from: {to, permanent}} map, cached; the SPA consults it before a 404."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        data = cache.get(REDIRECTS_CACHE_KEY)
        if data is None:
            data = {r.from_path: {'to': r.to_path, 'permanent': r.permanent} for r in Redirect.objects.all()}
            cache.set(REDIRECTS_CACHE_KEY, data, 3600)
        resp = Response(data)
        resp['Cache-Control'] = 'public, max-age=300'
        return resp


class RedirectHitView(APIView):
    """POST /content/redirects/hit/ {from} — counts usage so stale redirects can be retired."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        Redirect.objects.filter(from_path=str(request.data.get('from', ''))[:200]).update(hits=models.F('hits') + 1)
        return Response({'ok': True})


class AdminRedirectsView(generics.ListCreateAPIView):
    permission_classes = [IsAdmin]
    serializer_class = RedirectSerializer
    pagination_class = None
    queryset = Redirect.objects.all()


class AdminRedirectDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdmin]
    serializer_class = RedirectSerializer
    queryset = Redirect.objects.all()


def build_sitemap() -> str:
    from .pages import Page

    redirected = set(Redirect.objects.values_list('from_path', flat=True))
    rows = [(p, f, pr, None) for p, f, pr in STATIC_ROUTES if p not in redirected]
    for page in Page.objects.filter(status=Page.Status.PUBLISHED):
        if (page.seo or {}).get('noindex') or (page.unpublish_at and page.unpublish_at <= timezone.now()):
            continue
        path = f'/{page.slug}' if page.slug != 'inicio' else '/'
        if any(r[0] == path for r in rows) or path in redirected:
            continue
        rows.append((path, 'weekly', '0.6', page.published_at))
    body = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for path, freq, prio, lastmod in rows:
        body.append('  <url>')
        body.append(f'    <loc>{SITE}{path}</loc>')
        if lastmod:
            body.append(f'    <lastmod>{lastmod.date().isoformat()}</lastmod>')
        body.append(f'    <changefreq>{freq}</changefreq>')
        body.append(f'    <priority>{prio}</priority>')
        body.append('  </url>')
    body.append('</urlset>')
    return '\n'.join(body) + '\n'


def sitemap_view(request):
    xml = cache.get(SITEMAP_CACHE_KEY)
    if xml is None:
        xml = build_sitemap()
        cache.set(SITEMAP_CACHE_KEY, xml, 3600)
    resp = HttpResponse(xml, content_type='application/xml; charset=utf-8')
    resp['Cache-Control'] = 'public, max-age=3600'
    resp['Last-Modified'] = timezone.now().strftime('%a, %d %b %Y %H:%M:%S GMT')
    return resp
