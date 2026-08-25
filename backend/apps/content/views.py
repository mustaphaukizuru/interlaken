"""
content/views.py — public, cached read endpoint for site settings.

Read-only public content: no auth, no audit logging, 5-minute LocMem cache
invalidated on every SiteSettings save (see models.SiteSettings.save).
"""
from django.core.cache import cache
from django.db import models
from rest_framework import generics, permissions
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


CALENDAR_CACHE_KEY = 'content:calendar:{key}'


class PublicCalendarView(APIView):
    """GET /api/v1/content/calendar/?from=&to=&level= — published events (cached 5 min)."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from django.utils import timezone
        from django.utils.dateparse import parse_date

        from .models import SchoolEvent
        from .serializers import SchoolEventSerializer

        today = timezone.localdate()
        start = parse_date(request.query_params.get('from') or '') or today.replace(day=1)
        end = parse_date(request.query_params.get('to') or '') or (start.replace(year=start.year + 1))
        qs = SchoolEvent.objects.filter(is_published=True, start_date__lte=end).filter(
            models.Q(end_date__gte=start) | models.Q(end_date__isnull=True, start_date__gte=start))
        level = request.query_params.get('level')
        if level:
            qs = qs.filter(models.Q(level='') | models.Q(level=level))
        key = CALENDAR_CACHE_KEY.format(key=f'{start}:{end}:{level or "all"}')
        data = cache.get(key)
        if data is None:
            data = SchoolEventSerializer(qs, many=True).data
            cache.set(key, data, CACHE_TTL_SECONDS)
        resp = Response(data)
        resp['Cache-Control'] = 'public, max-age=300'
        return resp


class AdminCalendarView(generics.ListCreateAPIView):
    """GET/POST /api/v1/content/admin/calendar/ (admin)."""
    permission_classes = [_IsAdmin]

    def get_serializer_class(self):
        from .serializers import SchoolEventSerializer
        return SchoolEventSerializer

    def get_queryset(self):
        from .models import SchoolEvent
        return SchoolEvent.objects.all()


class AdminCalendarDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE /api/v1/content/admin/calendar/<pk>/ (admin)."""
    permission_classes = [_IsAdmin]

    def get_serializer_class(self):
        from .serializers import SchoolEventSerializer
        return SchoolEventSerializer

    def get_queryset(self):
        from .models import SchoolEvent
        return SchoolEvent.objects.all()


class PublicTestimonialsView(APIView):
    """GET /api/v1/content/testimonials/ — published quotes (cached 5 min)."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from .models import Testimonial
        from .serializers import TestimonialSerializer

        data = cache.get('content:testimonials')
        if data is None:
            data = TestimonialSerializer(Testimonial.objects.filter(is_published=True), many=True).data
            cache.set('content:testimonials', data, 300)
        return Response(data)


class AdminTestimonialsView(generics.ListCreateAPIView):
    permission_classes = [_IsAdmin]

    def get_serializer_class(self):
        from .serializers import TestimonialSerializer
        return TestimonialSerializer

    def get_queryset(self):
        from .models import Testimonial
        return Testimonial.objects.all()

    def perform_create(self, serializer):
        serializer.save()
        cache.delete('content:testimonials')


class AdminTestimonialDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [_IsAdmin]

    def get_serializer_class(self):
        from .serializers import TestimonialSerializer
        return TestimonialSerializer

    def get_queryset(self):
        from .models import Testimonial
        return Testimonial.objects.all()

    def perform_update(self, serializer):
        serializer.save()
        cache.delete('content:testimonials')

    def perform_destroy(self, instance):
        instance.delete()
        cache.delete('content:testimonials')
