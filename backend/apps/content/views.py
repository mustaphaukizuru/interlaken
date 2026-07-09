"""
content/views.py — public, cached read endpoint for site settings.

Read-only public content: no auth, no audit logging, 5-minute LocMem cache
invalidated on every SiteSettings save (see models.SiteSettings.save).
"""
from django.core.cache import cache
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SETTINGS_CACHE_KEY, SiteSettings
from .serializers import SiteSettingsSerializer

CACHE_TTL_SECONDS = 300


class PublicSiteSettingsView(APIView):
    """GET /api/v1/content/settings/ — contact + social data for the SPA."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        data = cache.get(SETTINGS_CACHE_KEY)
        if data is None:
            data = SiteSettingsSerializer(SiteSettings.load()).data
            cache.set(SETTINGS_CACHE_KEY, data, CACHE_TTL_SECONDS)
        return Response(data)


class PublicTuitionCostsView(APIView):
    """GET /api/v1/content/costs/ — costos por sección (editables en el admin)."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from .models import COSTS_CACHE_KEY, TuitionCost
        from .serializers import TuitionCostSerializer
        data = cache.get(COSTS_CACHE_KEY)
        if data is None:
            rows = TuitionCost.objects.filter(is_active=True)
            data = TuitionCostSerializer(rows, many=True).data
            cache.set(COSTS_CACHE_KEY, data, CACHE_TTL_SECONDS)
        return Response(data)
