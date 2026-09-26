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

import django_filters
from django.core.cache import cache
from django.db import models
from django.http import HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.bulk import AdminBulkView
from apps.core.exporting import AdminExportMixin, Col, ExportSpec
from apps.core.importing import ImportCol, ImportSpec, ImportTemplateView, ImportView, parse_bool
from apps.core.listing import AdminListMixin
from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit

from .ops import AuditedCrudMixin, bool_filter, delete_action

PATH_RE = re.compile(r'^/[A-Za-z0-9\-._~/]*$')
SITEMAP_CACHE_KEY = 'cms:sitemap'
REDIRECTS_CACHE_KEY = 'cms:redirects'
SITE = 'https://interlaken.edu.mx'

# CMS slugs that CmsOverride (frontend/src/App.tsx) binds to a nested public
# route. Every other published page is served at /<slug>. Keep in sync with
# frontend/src/cms/slugPaths.ts.
SLUG_PATHS = {
    'inicio': '/',
    'documentacion': '/admisiones/documentacion',
    'costos': '/admisiones/costos',
    'plataformas': '/comunidad/plataformas',
}


def page_path(slug: str) -> str:
    """Public URL path of a CMS page."""
    return SLUG_PATHS.get(slug, f'/{slug}')

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
        cache.delete(SITEMAP_CACHE_KEY)


class RedirectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Redirect
        fields = ['id', 'from_path', 'to_path', 'permanent', 'hits', 'created_at']
        read_only_fields = ['hits', 'created_at']

    def validate_from_path(self, v):
        v = v.strip().rstrip('/') or '/'
        reserved = ('/api', '/admin', '/django-admin', '/auth', '/static', '/media', '/portal', '/staff')
        if not PATH_RE.match(v) or v == '/healthz' or any(v == r or v.startswith(f'{r}/') for r in reserved):
            raise serializers.ValidationError('Ruta no válida (debe empezar con / y no puede ser una ruta reservada como /api, /admin o /portal).')
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


@method_decorator(ratelimit('cms-redirect-hit', '30/m', method='POST'), name='dispatch')
class RedirectHitView(APIView):
    """POST /content/redirects/hit/ {from} — counts usage so stale redirects can be retired."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        Redirect.objects.filter(from_path=str(request.data.get('from', ''))[:200]).update(hits=models.F('hits') + 1)
        return Response({'ok': True})


class RedirectFilterSet(django_filters.FilterSet):
    permanent = bool_filter('permanent')

    class Meta:
        model = Redirect
        fields: list[str] = []


REDIRECT_ORDERING = {
    'from': 'from_path',
    'to': 'to_path',
    'permanent': 'permanent',
    'hits': 'hits',
    'created': 'created_at',
}


class AdminRedirectsView(AuditedCrudMixin, AdminListMixin, generics.ListCreateAPIView):
    """GET/POST /content/admin/redirects/ — Data Ops list contract (``q`` over
    both paths, ``permanent``, ordering keys in ``REDIRECT_ORDERING``)."""
    serializer_class = RedirectSerializer
    search_fields = ('from_path', 'to_path')
    ordering = REDIRECT_ORDERING
    default_ordering = 'from_path'
    filterset_class = RedirectFilterSet
    audit_context = 'cms.redirect'

    def get_queryset(self):
        return Redirect.objects.all()


class AdminRedirectDetailView(AuditedCrudMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdmin]
    serializer_class = RedirectSerializer
    queryset = Redirect.objects.all()
    audit_context = 'cms.redirect'


REDIRECT_EXPORT = ExportSpec(
    filename_prefix='redirecciones',
    title='Redirecciones',
    audit_entity='content.redirect',
    columns=[
        Col('from_path', 'de', width=36),
        Col('to_path', 'a', width=48),
        Col('permanent', 'permanente', fmt='bool', width=12),
        Col('hits', 'Visitas', fmt='int', width=10),
        Col('created_at', 'Creada', fmt='datetime', width=18),
    ],
)


class AdminRedirectsExportView(AdminExportMixin, AdminRedirectsView):
    """GET /content/admin/redirects/export/?fmt=csv|xlsx|pdf (headers match the import)."""
    http_method_names = ['get', 'head', 'options']
    export_spec = REDIRECT_EXPORT


class AdminRedirectsBulkView(AdminBulkView):
    """POST /content/admin/redirects/bulk/ — ``delete``."""
    entity = 'content.redirect'
    list_view_class = AdminRedirectsView
    actions = {'delete': delete_action()}


def _serializer_check(method):
    """Run a RedirectSerializer field validator as an import parser (ValueError on failure)."""
    def parse(value):
        try:
            return getattr(RedirectSerializer(), method)(str(value))
        except serializers.ValidationError as exc:
            detail = exc.detail[0] if isinstance(exc.detail, list) and exc.detail else exc.detail
            raise ValueError(str(detail).rstrip('.')) from None
    return parse


def _redirect_row(data, row):
    if data.get('de') and data.get('de') == data.get('a'):
        row.error('a: el destino es igual al origen.')


def _redirect_create(data, actor):
    return Redirect.objects.create(
        from_path=data['de'], to_path=data['a'],
        permanent=True if data.get('permanente') is None else data['permanente'])


def _redirect_update(redirect, data, actor):
    redirect.to_path = data['a']
    if data.get('permanente') is not None:
        redirect.permanent = data['permanente']
    redirect.save()
    return redirect


def _redirect_skip(data, instance):
    if instance is None:
        return None
    same_perm = data.get('permanente') is None or data['permanente'] == instance.permanent
    if instance.to_path == data.get('a') and same_perm:
        return 'Sin cambios: la redirección ya existe igual.'
    return None


REDIRECT_IMPORT = ImportSpec(
    entity='content.redirect',
    label='Redirecciones',
    columns=[
        ImportCol('de', ('from', 'from_path', 'origen', 'ruta_antigua'), required=True,
                  parse=_serializer_check('validate_from_path'), example='/inscripciones'),
        ImportCol('a', ('to', 'to_path', 'destino', 'enviar_a'), required=True,
                  parse=_serializer_check('validate_to_path'), example='/admisiones'),
        ImportCol('permanente', ('permanent', '301'), parse=parse_bool, example='sí'),
    ],
    dedupe_keys=[('de',)],
    db_match=lambda d: Redirect.objects.filter(from_path=d['de']).first() if d.get('de') else None,
    create=_redirect_create,
    update=_redirect_update,
    validate_row=_redirect_row,
    skip_reason=_redirect_skip,
)


class AdminRedirectsImportTemplateView(ImportTemplateView):
    """GET /content/admin/redirects/import/template/?fmt=csv|xlsx"""
    spec = REDIRECT_IMPORT


class AdminRedirectsImportView(ImportView):
    """POST /content/admin/redirects/import/ (``de, a, permanente``; dedupe by ``de``)."""
    spec = REDIRECT_IMPORT
    template_url = '/api/v1/content/admin/redirects/import/template/'


def build_sitemap() -> str:
    from .pages import Page

    redirected = set(Redirect.objects.values_list('from_path', flat=True))
    rows = [(p, f, pr, None) for p, f, pr in STATIC_ROUTES if p not in redirected]
    for page in Page.objects.filter(status=Page.Status.PUBLISHED):
        if (page.seo or {}).get('noindex') or (page.unpublish_at and page.unpublish_at <= timezone.now()):
            continue
        path = page_path(page.slug)
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
