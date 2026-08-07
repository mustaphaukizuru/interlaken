"""
Core API views: public contact form + health check.
"""
from django.conf import settings
from django.core.cache import cache
from django.core.mail import send_mail
from django.db import connection
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.ratelimit import ratelimit

from .serializers import ContactMessageSerializer


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
    """GET /api/v1/health/ — liveness + dependency probe for uptime monitors.

    Public, unauthenticated, read-only (exempt from audit logging like all
    reads). Returns 200 when DB and cache respond, 503 otherwise, so any
    HTTP monitor (UptimeRobot/BetterStack/cron curl) can alert on it.
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
                'checks': checks,
                'time': timezone.now().isoformat(),
            },
            status=status.HTTP_200_OK if healthy
            else status.HTTP_503_SERVICE_UNAVAILABLE,
        )
