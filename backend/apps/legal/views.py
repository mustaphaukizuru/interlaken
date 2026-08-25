"""
legal/views.py — privacy notice + consent capture (B2) + ARCO rights (B3).
"""
from django.core.cache import cache
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProfile, User

from .models import NOTICE_CACHE_KEY, ArcoRequest, PrivacyNoticeVersion
from .serializers import (
    ArcoIntakeSerializer,
    ArcoRequestSerializer,
    ArcoStatusInputSerializer,
    ConsentInputSerializer,
    PrivacyNoticeSerializer,
)
from .services import consent_state, export_household_data, needs_acceptance, record_consent


class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == User.Role.ADMIN)


class CurrentNoticeView(APIView):
    """GET /api/v1/legal/notice/ — the current Aviso de Privacidad (public).

    Cached 5 min (content-app pattern) and invalidated on every
    ``PrivacyNoticeVersion.save``/``delete`` so a newly published version is
    served immediately. The missing-notice 404 is never cached.
    """
    permission_classes = [permissions.AllowAny]

    CACHE_TTL = 300

    def get(self, request):
        data = cache.get(NOTICE_CACHE_KEY)
        if data is None:
            notice = PrivacyNoticeVersion.current()
            if notice is None:
                return Response({'detail': 'No hay un aviso de privacidad vigente.'},
                                status=status.HTTP_404_NOT_FOUND)
            data = PrivacyNoticeSerializer(notice).data
            cache.set(NOTICE_CACHE_KEY, data, self.CACHE_TTL)
        return Response(data)


class ConsentView(APIView):
    """GET/POST /api/v1/legal/consent/ — read state / record the guardian's consent."""
    permission_classes = [permissions.IsAuthenticated]

    def _student(self, request, sid):
        if not sid:
            return None
        # A guardian may only record/read consent for their own children.
        return get_object_or_404(StudentProfile, pk=sid, parents=request.user)

    def get(self, request):
        student = self._student(request, request.query_params.get('student'))
        notice = PrivacyNoticeVersion.current()
        return Response({
            'state': consent_state(request.user, student),
            'needs_acceptance': needs_acceptance(request.user),
            'notice_version': getattr(notice, 'version', None),
        })

    def post(self, request):
        serializer = ConsentInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        student = self._student(request, serializer.validated_data.get('student'))
        ip = request.META.get('REMOTE_ADDR')
        for purpose, granted in serializer.validated_data['purposes'].items():
            record_consent(guardian=request.user, purpose=purpose, granted=granted,
                           student=student, context='portal', ip=ip)
        return Response({
            'state': consent_state(request.user, student),
            'needs_acceptance': needs_acceptance(request.user),
        }, status=status.HTTP_201_CREATED)


# ── ARCO rights (B3) ──────────────────────────────────────
class ArcoRequestView(generics.ListCreateAPIView):
    """GET/POST /api/v1/legal/arco/ — the parent's own ARCO requests."""
    serializer_class = ArcoRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return ArcoRequest.objects.filter(requester=self.request.user)

    def perform_create(self, serializer):
        serializer.save(requester=self.request.user, requester_email=self.request.user.email)


class ArcoExportView(APIView):
    """GET /api/v1/legal/arco/export/ — Acceso: export the household's own data."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(export_household_data(request.user))


class AdminArcoListView(generics.ListAPIView):
    """GET /api/v1/legal/admin/arco/?status= — staff console queue."""
    serializer_class = ArcoRequestSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs = ArcoRequest.objects.all()
        status_filter = self.request.query_params.get('status')
        # 'open' is the console's default queue (received + in review). It used
        # to be filtered client-side, which silently dropped every open request
        # that fell past the first page.
        if status_filter == 'open':
            return qs.filter(status__in=[ArcoRequest.Status.RECEIVED, ArcoRequest.Status.IN_REVIEW])
        return qs.filter(status=status_filter) if status_filter else qs


class AdminArcoStatusView(APIView):
    """POST /api/v1/legal/admin/arco/<id>/status/ — advance an ARCO request."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        arco = get_object_or_404(ArcoRequest, pk=pk)
        serializer = ArcoStatusInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data['status']
        arco.status = new_status
        arco.resolution_note = serializer.validated_data.get('resolution_note', '')
        if new_status in (ArcoRequest.Status.RESOLVED, ArcoRequest.Status.REJECTED):
            arco.resolved_at = timezone.now()
        # The status change is audit-logged automatically (register_audit + middleware).
        arco.save(update_fields=['status', 'resolution_note', 'resolved_at', 'updated_at'])
        _notify_requester(arco)
        return Response(ArcoRequestSerializer(arco).data)


def _notify_requester(arco, *, intake=False):
    """Email the requester: acknowledgement with the statutory deadline on intake, outcome on resolution."""
    from django.conf import settings as dj_settings

    from apps.portal.services import send_email
    label = arco.get_request_type_display()
    if intake:
        subject = f'Recibimos su solicitud ARCO de {label.lower()}'
        body = (f'Registramos su solicitud de {label.lower()} el {arco.created_at:%d/%m/%Y}. '
                f'Le responderemos a más tardar el {arco.statutory_deadline:%d/%m/%Y} (plazo legal de 20 días hábiles).\n\n'
                f'Si desea ampliar la solicitud, responda a este correo o escriba a {dj_settings.PRIVACY_EMAIL}.')
    elif arco.status == ArcoRequest.Status.RESOLVED:
        subject = f'Su solicitud ARCO de {label.lower()} fue atendida'
        body = f'Resolución: {arco.resolution_note or "atendida"}.\n\nGracias por ayudarnos a mantener sus datos correctos.'
    elif arco.status == ArcoRequest.Status.REJECTED:
        subject = f'Su solicitud ARCO de {label.lower()} no procedió'
        body = f'Motivo: {arco.resolution_note or "no especificado"}.\n\nPuede acudir al INAI si no está de acuerdo con esta respuesta.'
    else:
        return
    send_email(subject, body, [arco.requester_email], reply_to=dj_settings.PRIVACY_EMAIL)


class AdminArcoIntakeView(APIView):
    """POST /legal/admin/arco/intake/ — record a request that arrived via privacidad@, WhatsApp or in person (P5-5)."""
    permission_classes = [IsAdmin]

    def post(self, request):
        from apps.accounts.models import User
        ser = ArcoIntakeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        arco = ArcoRequest.objects.create(
            requester=User.objects.filter(email__iexact=d['requester_email']).first(),
            requester_email=d['requester_email'].lower(), requester_name=d['requester_name'], request_type=d['request_type'],
            channel=d['channel'], details=d['details'], intake_by=request.user,
        )
        _notify_requester(arco, intake=True)
        return Response(ArcoRequestSerializer(arco).data, status=201)
