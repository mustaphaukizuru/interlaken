"""
Colegio Interlaken — Root URL Configuration
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAdminUser

from apps.core.views import ContactCreateView, HealthView

# Staff-gated API docs: session auth so a Django-admin login is enough to
# browse Swagger — the schema is never exposed anonymously.
_docs_kwargs = {
    'authentication_classes': [SessionAuthentication],
    'permission_classes': [IsAdminUser],
}

urlpatterns = [
    # Health probe at the ROOT (Render's healthCheckPath): no auth, one DB
    # SELECT 1 + a cache round-trip. /api/v1/health/ below stays for existing
    # monitors. Registered before the SPA catch-all so it never serves HTML.
    path('healthz', HealthView.as_view(), name='healthz'),

    # Admin
    path('admin/', admin.site.urls),

    # API schema + docs (staff only, via admin session)
    path('api/schema/', SpectacularAPIView.as_view(**_docs_kwargs), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema', **_docs_kwargs), name='api-docs'),

    # Auth
    path('auth/', include('apps.accounts.urls')),
    path('auth/social/', include('social_django.urls', namespace='social')),

    # API v1
    path('api/v1/accounts/',    include('apps.accounts.api_urls')),
    path('api/v1/admissions/',  include('apps.admissions.urls')),
    path('api/v1/cafeteria/',   include('apps.cafeteria.urls')),
    path('api/v1/payments/',    include('apps.payments.urls')),
    path('api/v1/portal/',      include('apps.portal.urls')),
    path('api/v1/finance/',     include('apps.finance.urls')),
    path('api/v1/bookings/',    include('apps.bookings.urls')),
    path('api/v1/whatsapp/',    include('apps.whatsapp.urls')),
    path('api/v1/legal/',       include('apps.legal.urls')),
    path('api/v1/content/',     include('apps.content.urls')),
    path('api/v1/contact/',     ContactCreateView.as_view(), name='contact-create'),
    path('api/v1/health/',      HealthView.as_view(),        name='health'),

    # React SPA catch-all (serves index.html for all unmatched routes)
    path('', include('apps.core.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
