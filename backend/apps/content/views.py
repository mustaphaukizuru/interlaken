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
from .serializers import AdminSiteSettingsSerializer, SiteSettingsSerializer

CACHE_TTL_SECONDS = 300


class _IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and getattr(u, 'role', '') == 'admin')


class AdminSiteSettingsView(APIView):
    """GET/PATCH /api/v1/content/admin/settings/ — edit the public site settings
    (contact info, WhatsApp, socials) shown on the marketing site. A save
    invalidates the public read cache (SiteSettings.save)."""
    permission_classes = [_IsAdmin]

    def get(self, request):
        return Response(AdminSiteSettingsSerializer(SiteSettings.load()).data)

    def patch(self, request):
        ser = AdminSiteSettingsSerializer(SiteSettings.load(), data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


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


class PublicPricingView(APIView):
    """GET /api/v1/content/pricing/ — the whole 2026-2027 pricing bundle for the
    Costos page: inscripción/reinscripción, colegiaturas, seguros y credenciales,
    extraescolares, estancia, y políticas. Cached; invalidated on any pricing save."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from .models import (
            PRICING_CACHE_KEY,
            DaycareRate,
            EnrollmentFee,
            ExtracurricularActivity,
            FixedConcept,
            PricingPolicy,
            TuitionCost,
        )
        from .serializers import (
            DaycareRateSerializer,
            EnrollmentFeeSerializer,
            ExtracurricularSerializer,
            FixedConceptSerializer,
            PricingPolicySerializer,
            TuitionCostSerializer,
        )
        data = cache.get(PRICING_CACHE_KEY)
        if data is None:
            active = lambda m: m.objects.filter(is_active=True)  # noqa: E731
            data = {
                'enrollment_fees': EnrollmentFeeSerializer(active(EnrollmentFee), many=True).data,
                'tuition': TuitionCostSerializer(active(TuitionCost), many=True).data,
                'fixed_concepts': FixedConceptSerializer(active(FixedConcept), many=True).data,
                'extracurriculars': ExtracurricularSerializer(active(ExtracurricularActivity), many=True).data,
                'daycare': DaycareRateSerializer(active(DaycareRate), many=True).data,
                'policies': PricingPolicySerializer(active(PricingPolicy), many=True).data,
            }
            cache.set(PRICING_CACHE_KEY, data, CACHE_TTL_SECONDS)
        return Response(data)
