"""
content/views.py — public, cached read endpoint for site settings.

Read-only public content: no auth, no audit logging, 5-minute LocMem cache
invalidated on every SiteSettings save (see models.SiteSettings.save).
"""
from datetime import timedelta

import django_filters
from django.core.cache import cache
from django.db import models
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.bulk import AdminBulkView
from apps.core.exporting import AdminExportMixin, Col, ExportSpec
from apps.core.importing import (
    ImportCol,
    ImportSpec,
    ImportTemplateView,
    ImportView,
    parse_bool,
    parse_choice,
    parse_date_es,
)
from apps.core.listing import AdminListMixin
from apps.core.permissions import IsAdmin

from .models import SETTINGS_CACHE_KEY, SchoolEvent, SiteSettings, Testimonial
from .ops import (
    ICS_CACHE_KEY,
    AuditedCrudMixin,
    bool_filter,
    delete_action,
    flag_action,
    invalidate_calendar,
    invalidate_testimonials,
)
from .serializers import (
    AdminSiteSettingsSerializer,
    SchoolEventSerializer,
    SiteSettingsSerializer,
    TestimonialSerializer,
)

CACHE_TTL_SECONDS = 300


class AdminSiteSettingsView(APIView):
    """GET/PATCH /api/v1/content/admin/settings/ — edit the public site settings
    (contact info, WhatsApp, socials) shown on the marketing site. A save
    invalidates the public read cache (SiteSettings.save)."""
    permission_classes = [IsAdmin]

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


# ── Calendario escolar: admin list contract, export, bulk, import, .ics ──
class SchoolEventFilterSet(django_filters.FilterSet):
    """``?kind=&level=&published=&from=&to=`` (dates: events that overlap the range)."""

    kind = django_filters.ChoiceFilter(choices=SchoolEvent.Kind.choices)
    level = django_filters.CharFilter(method="filter_level")
    published = bool_filter("is_published")
    date_from = django_filters.DateFilter(method="filter_from")
    date_to = django_filters.DateFilter(method="filter_to")

    class Meta:
        model = SchoolEvent
        fields: list[str] = []

    def __init__(self, data=None, *args, **kwargs):
        # ``from``/``to`` are Python keywords: map them onto the filter names.
        if data is not None:
            data = data.copy()
            for src, dst in (("from", "date_from"), ("to", "date_to")):
                if src in data and dst not in data:
                    data[dst] = data[src]
        super().__init__(data, *args, **kwargs)

    def filter_level(self, qs, _name, value):
        if value in ("todos", "all"):
            return qs.filter(level="")
        return qs.filter(level=value) if value else qs

    def filter_from(self, qs, _name, value):
        # Ends on/after ``from`` (single-day events end on their start date).
        return qs.filter(Q(end_date__gte=value) | Q(end_date__isnull=True, start_date__gte=value))

    def filter_to(self, qs, _name, value):
        return qs.filter(start_date__lte=value)


CALENDAR_ORDERING = {
    "start": "start_date",
    "end": "end_date",
    "title": "title",
    "kind": "kind",
    "level": "level",
    "published": "is_published",
    "updated": "updated_at",
}


class AdminCalendarView(AuditedCrudMixin, AdminListMixin, generics.ListCreateAPIView):
    """GET/POST /api/v1/content/admin/calendar/ (admin, Data Ops list contract)."""

    serializer_class = SchoolEventSerializer
    search_fields = ("title", "description")
    ordering = CALENDAR_ORDERING
    default_ordering = ("start_date", "title")
    filterset_class = SchoolEventFilterSet
    audit_context = "cms.calendar"

    def get_queryset(self):
        return SchoolEvent.objects.all()

    def after_write(self, instance):
        invalidate_calendar()


class AdminCalendarDetailView(AuditedCrudMixin, generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE /api/v1/content/admin/calendar/<pk>/ (admin)."""

    permission_classes = [IsAdmin]
    serializer_class = SchoolEventSerializer
    queryset = SchoolEvent.objects.all()
    audit_context = "cms.calendar"

    def after_write(self, instance):
        invalidate_calendar()


CALENDAR_EXPORT = ExportSpec(
    filename_prefix="calendario",
    title="Calendario escolar",
    audit_entity="content.schoolevent",
    columns=[
        Col("title", "Título", width=36),
        Col("kind", "Tipo", getter=lambda e: e.get_kind_display(), width=20),
        Col("start_date", "Inicio", fmt="date", width=12),
        Col("end_date", "Fin", fmt="date", width=12),
        Col("level", "Nivel", getter=lambda e: e.level or "Todos", width=12),
        Col("description", "Descripción", width=40),
        Col("is_published", "Publicado", fmt="bool", width=10),
    ],
)


class AdminCalendarExportView(AdminExportMixin, AdminCalendarView):
    """GET /api/v1/content/admin/calendar/export/?fmt=csv|xlsx|pdf&…list filters…"""

    http_method_names = ["get", "head", "options"]

    export_spec = CALENDAR_EXPORT


def _calendar_changed(*_args):
    invalidate_calendar()


class AdminCalendarBulkView(AdminBulkView):
    """POST /api/v1/content/admin/calendar/bulk/ — publish, unpublish, delete."""

    entity = "content.schoolevent"
    list_view_class = AdminCalendarView
    actions = {
        a.name: a
        for a in (
            flag_action(
                "publish",
                "Publicar",
                "is_published",
                True,
                skip_reason="ya está publicado",
                after=_calendar_changed,
            ),
            flag_action(
                "unpublish",
                "Despublicar",
                "is_published",
                False,
                skip_reason="ya es borrador",
                after=_calendar_changed,
            ),
            delete_action(after=_calendar_changed),
        )
    }


_LEVEL_CHOICES = [
    ("", "Todos"),
    ("preescolar", "Preescolar"),
    ("primaria", "Primaria"),
    ("secundaria", "Secundaria"),
]
_KIND_ALIASES = {
    "suspension": "holiday",
    "vacaciones": "vacation",
    "examen": "exam",
    "evaluacion": "exam",
    "evento": "event",
    "junta": "meeting",
    "fecha_limite": "deadline",
}


def _max_len(limit):
    def check(value, _data):
        return f"máximo {limit} caracteres" if value and len(str(value)) > limit else None

    return check


def _calendar_row(data, row):
    start, end = data.get("inicio"), data.get("fin")
    if start and end and end < start:
        row.error("fin: no puede ser anterior al inicio.")


def _calendar_fields(data) -> dict:
    published = data.get("publicado")
    return {
        "title": data["titulo"],
        "kind": data.get("tipo") or SchoolEvent.Kind.EVENT,
        "start_date": data["inicio"],
        "end_date": data.get("fin"),
        "level": data.get("nivel") or "",
        "description": data.get("descripcion") or "",
        "is_published": True if published is None else published,
    }


def _calendar_match(data):
    if not data.get("titulo") or not data.get("inicio"):
        return None
    return SchoolEvent.objects.filter(
        title__iexact=data["titulo"], start_date=data["inicio"]
    ).first()


def _calendar_create(data, actor):
    event = SchoolEvent.objects.create(**_calendar_fields(data))
    invalidate_calendar()
    return event


def _calendar_update(event, data, actor):
    for key, value in _calendar_fields(data).items():
        setattr(event, key, value)
    event.save()
    invalidate_calendar()
    return event


CALENDAR_IMPORT = ImportSpec(
    entity="content.schoolevent",
    label="Calendario escolar",
    columns=[
        ImportCol(
            "titulo",
            ("title", "evento", "nombre"),
            required=True,
            validators=(_max_len(160),),
            example="Suspensión de clases",
        ),
        ImportCol(
            "tipo",
            ("kind", "categoria"),
            parse=parse_choice(SchoolEvent.Kind.choices, aliases=_KIND_ALIASES),
            example="holiday",
        ),
        ImportCol(
            "inicio",
            ("fecha", "fecha_inicio", "start", "start_date"),
            required=True,
            parse=parse_date_es,
            example="16/11/2026",
        ),
        ImportCol("fin", ("fecha_fin", "end", "end_date"), parse=parse_date_es, example=""),
        ImportCol(
            "nivel",
            ("level",),
            parse=parse_choice(_LEVEL_CHOICES, aliases={"all": ""}),
            example="todos",
        ),
        ImportCol(
            "descripcion",
            ("description", "detalle"),
            validators=(_max_len(300),),
            example="Día de la Revolución",
        ),
        ImportCol("publicado", ("published", "visible"), parse=parse_bool, example="sí"),
    ],
    dedupe_keys=[("titulo", "inicio")],
    db_match=_calendar_match,
    create=_calendar_create,
    update=_calendar_update,
    validate_row=_calendar_row,
)


class AdminCalendarImportTemplateView(ImportTemplateView):
    """GET /api/v1/content/admin/calendar/import/template/?fmt=csv|xlsx"""

    spec = CALENDAR_IMPORT


class AdminCalendarImportView(ImportView):
    """POST /api/v1/content/admin/calendar/import/ (dry_run, report, valid_only)."""

    spec = CALENDAR_IMPORT
    template_url = "/api/v1/content/admin/calendar/import/template/"


ICS_TTL_SECONDS = 600
ICS_LOOKBACK_DAYS = 365


def build_calendar_ics(events) -> str:
    """RFC 5545 VCALENDAR of all-day VEVENTs (DTEND exclusive), folded to 75 octets."""
    from apps.bookings.services.ics import _escape, _fold, _utc

    stamp = _utc(timezone.now())
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Colegio Interlaken//Calendario escolar//ES",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Calendario escolar Interlaken",
        "X-WR-TIMEZONE:America/Mexico_City",
    ]
    for event in events:
        end = (event.end_date or event.start_date) + timedelta(days=1)
        summary = event.title if not event.level else f"{event.title} ({event.level.capitalize()})"
        description = " · ".join(p for p in (event.get_kind_display(), event.description) if p)
        lines += [
            "BEGIN:VEVENT",
            f"UID:school-event-{event.pk}@interlaken.edu.mx",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{event.start_date:%Y%m%d}",
            f"DTEND;VALUE=DATE:{end:%Y%m%d}",
            f"SUMMARY:{_escape(summary)}",
            f"DESCRIPTION:{_escape(description)}",
            f"CATEGORIES:{_escape(event.get_kind_display())}",
            "TRANSP:TRANSPARENT",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


class PublicCalendarIcsView(APIView):
    """GET /api/v1/content/calendar.ics — published events as an iCalendar feed.

    Families subscribe once (Google/Apple/Outlook) and the school's dates stay
    current. Cached 10 minutes; any admin write to the calendar clears it.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        body = cache.get(ICS_CACHE_KEY)
        if body is None:
            since = timezone.localdate() - timedelta(days=ICS_LOOKBACK_DAYS)
            events = (
                SchoolEvent.objects.filter(is_published=True)
                .filter(Q(end_date__gte=since) | Q(end_date__isnull=True, start_date__gte=since))
                .order_by("start_date", "pk")
            )
            body = build_calendar_ics(events)
            cache.set(ICS_CACHE_KEY, body, ICS_TTL_SECONDS)
        response = HttpResponse(body, content_type="text/calendar; charset=utf-8")
        response["Content-Disposition"] = 'inline; filename="calendario-interlaken.ics"'
        response["Cache-Control"] = f"public, max-age={ICS_TTL_SECONDS}"
        return response


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




# ── Testimonios: admin list contract, export, bulk ────────
class TestimonialFilterSet(django_filters.FilterSet):
    published = bool_filter("is_published")
    level = django_filters.CharFilter(method="filter_level")

    class Meta:
        model = Testimonial
        fields: list[str] = []

    def filter_level(self, qs, _name, value):
        if value in ("general", "todos"):
            return qs.filter(level="")
        return qs.filter(level=value) if value else qs


TESTIMONIAL_ORDERING = {
    "order": "order",
    "author": "author",
    "level": "level",
    "published": "is_published",
    "created": "created_at",
}


def _testimonials_changed(*_args):
    invalidate_testimonials()


class AdminTestimonialsView(AuditedCrudMixin, AdminListMixin, generics.ListCreateAPIView):
    """GET/POST /api/v1/content/admin/testimonials/ (admin, Data Ops list contract)."""

    serializer_class = TestimonialSerializer
    search_fields = ("quote", "author", "role")
    ordering = TESTIMONIAL_ORDERING
    default_ordering = ("order", "-created_at")
    filterset_class = TestimonialFilterSet
    audit_context = "cms.testimonial"

    def get_queryset(self):
        return Testimonial.objects.all()

    def after_write(self, instance):
        invalidate_testimonials()


class AdminTestimonialDetailView(AuditedCrudMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdmin]
    serializer_class = TestimonialSerializer
    queryset = Testimonial.objects.all()
    audit_context = "cms.testimonial"

    def after_write(self, instance):
        invalidate_testimonials()


TESTIMONIAL_EXPORT = ExportSpec(
    filename_prefix="testimonios",
    title="Testimonios",
    audit_entity="content.testimonial",
    columns=[
        Col("order", "Orden", fmt="int", width=8),
        Col("author", "Nombre", width=24),
        Col("role", "Relación", width=28),
        Col("level", "Nivel", getter=lambda t: t.level or "General", width=12),
        Col("quote", "Testimonio", width=60),
        Col("is_published", "Publicado", fmt="bool", width=10),
        Col("created_at", "Creado", fmt="datetime", width=18),
    ],
)


class AdminTestimonialsExportView(AdminExportMixin, AdminTestimonialsView):
    """GET /api/v1/content/admin/testimonials/export/?fmt=csv|xlsx|pdf"""

    http_method_names = ["get", "head", "options"]

    export_spec = TESTIMONIAL_EXPORT


class AdminTestimonialsBulkView(AdminBulkView):
    """POST /api/v1/content/admin/testimonials/bulk/ — publish, unpublish, delete."""

    entity = "content.testimonial"
    list_view_class = AdminTestimonialsView
    actions = {
        a.name: a
        for a in (
            flag_action(
                "publish",
                "Publicar",
                "is_published",
                True,
                skip_reason="ya está publicado",
                after=_testimonials_changed,
            ),
            flag_action(
                "unpublish",
                "Despublicar",
                "is_published",
                False,
                skip_reason="ya es borrador",
                after=_testimonials_changed,
            ),
            delete_action(after=_testimonials_changed),
        )
    }
