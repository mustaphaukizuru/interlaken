"""
Colegio Interlaken — Root URL Configuration
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from apps.core.views import ContactCreateView

urlpatterns = [
    # Admin
    path('admin/', admin.site.urls),

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

    # React SPA catch-all (serves index.html for all unmatched routes)
    path('', include('apps.core.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
