"""
Core API views: public contact form, health check + admin audit viewer.
"""
from django.conf import settings
from django.core.cache import cache
from django.core.mail import send_mail
from django.db import connection
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.ratelimit import ratelimit

from .models import AuditLog
from .serializers import AuditLogSerializer, ContactMessageSerializer


@method_decorator(ratelimit('contact', '5/m', method='POST'), name='dispatch')
class ContactCreateView(APIView):
    """POST /api/v1/contact/ — Save a public contact message and notify the school."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ContactMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = serializer.save()

        recipient = getattr(settings, 'CONTACT_EMAIL', '') or settings.DEFAULT_FROM_EMAIL
        send_mail(
            subject=f'[Contacto web] {message.subject}',
            message=(
                f'Nombre: {message.name}\n'
                f'Correo: {message.email}\n\n'
                f'{message.message}'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient],
            fail_silently=True,
        )

        return Response(serializer.data, status=status.HTTP_201_CREATED)


class HealthView(APIView):
    """GET /healthz (root, container + uptime health check) and /api/v1/health/ (legacy).

    Liveness + dependency probe for uptime monitors: one DB ``SELECT 1`` plus a
    cache set/get round-trip. Public, unauthenticated, read-only (exempt from
    audit logging like all reads). Returns 200 when both respond, 503 otherwise,
    so any HTTP monitor (UptimeRobot/BetterStack/cron curl) can alert.
    Top-level ``db``/``cache`` booleans are the documented shape; the nested
    ``checks`` object is kept for pre-existing monitors.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        checks = {'db': False, 'cache': False}

        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
                checks['db'] = cursor.fetchone() is not None
        except Exception:  # pragma: no cover — depends on a broken DB
            pass

        try:
            cache.set('health-probe', 'ok', 10)
            checks['cache'] = cache.get('health-probe') == 'ok'
        except Exception:  # pragma: no cover — depends on a broken cache
            pass

        healthy = all(checks.values())
        return Response(
            {
                'status': 'ok' if healthy else 'degraded',
                'db': checks['db'],
                'cache': checks['cache'],
                'checks': checks,
                'time': timezone.now().isoformat(),
            },
            status=status.HTTP_200_OK if healthy
            else status.HTTP_503_SERVICE_UNAVAILABLE,
        )


class IsAdminRole(permissions.BasePermission):
    """Admin-role gate (mirrors finance/cafeteria IsAdmin: 401 anon, 403 others)."""

    def has_permission(self, request, view):
        from apps.accounts.models import User
        user = request.user
        return bool(user and user.is_authenticated and user.role == User.Role.ADMIN)


class AdminAuditLogView(generics.ListAPIView):
    """GET /api/v1/core/admin/audit/ — read-only, paginated audit trail (admin).

    Filters: ``actor`` (label/email icontains), ``action`` (choice),
    ``context`` (icontains — semantic category, e.g. ``finance.mark_paid``),
    ``object_type`` + ``object_id`` (target filter, e.g. one invoice's history),
    ``from`` / ``to`` (ISO dates, inclusive). Newest first.
    """
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        qs = AuditLog.objects.select_related('actor')
        p = self.request.query_params

        actor = (p.get('actor') or '').strip()
        if actor:
            qs = qs.filter(Q(actor_label__icontains=actor) | Q(actor__email__icontains=actor))
        action = (p.get('action') or '').strip()
        if action in AuditLog.Action.values:
            qs = qs.filter(action=action)
        context = (p.get('context') or '').strip()
        if context:
            qs = qs.filter(context__icontains=context)
        object_type = (p.get('object_type') or '').strip()
        if object_type:
            qs = qs.filter(object_type=object_type)
        object_id = (p.get('object_id') or '').strip()
        if object_id:
            qs = qs.filter(object_id=object_id)
        # Invalid dates are ignored (parse_date → None) instead of 500ing.
        date_from = parse_date(p.get('from') or '')
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        date_to = parse_date(p.get('to') or '')
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        return qs.order_by('-created_at')
