"""
legal/views.py — privacy notice + consent capture (B2) + ARCO rights (B3).
"""
from django.core.cache import cache
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProfile, User
from apps.core.audit import record
from apps.core.bulk import AdminBulkView, status_action
from apps.core.exporting import AdminExportMixin
from apps.core.listing import AdminListMixin
from apps.core.permissions import IsAdmin
from apps.core.transitions import assert_transition

from .filters import (
    ARCO_EXPORT_SPEC,
    ARCO_ORDERING,
    ARCO_SEARCH_FIELDS,
    ArcoFilterSet,
    annotate_overdue,
)
from .models import NOTICE_CACHE_KEY, ArcoRequest, PrivacyNoticeVersion
from .serializers import (
    ArcoIntakeSerializer,
    ArcoRequestSerializer,
    ArcoStatusInputSerializer,
    ConsentInputSerializer,
    PrivacyNoticeSerializer,
)
from .services import consent_state, export_household_data, needs_acceptance, record_consent


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


class AdminArcoListView(AdminListMixin, generics.ListAPIView):
    """GET /api/v1/legal/admin/arco/ — staff console queue (Data Ops Phase 7).

    ``?q=`` requester email / name / details; ``?status=`` (``open`` = received
    + in review, or a status, or a comma list), ``type``, ``channel``,
    ``overdue=1|0``, ``from`` / ``to``; ordering ``date``, ``deadline``,
    ``status``, ``type``, ``requester``. ``is_overdue`` is computed in SQL and
    the response carries ``overdue_count`` for the whole filtered set (not
    just the page), so the banner can never undercount.
    """
    serializer_class = ArcoRequestSerializer
    search_fields = ARCO_SEARCH_FIELDS
    ordering = ARCO_ORDERING
    default_ordering = '-created_at'
    filterset_class = ArcoFilterSet

    def get_queryset(self):
        return annotate_overdue(ArcoRequest.objects.all())

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        if isinstance(response.data, dict):
            qs = self.filter_queryset(self.get_queryset())
            response.data['overdue_count'] = qs.filter(is_overdue_ann=True).count()
        return response


class AdminArcoExportView(AdminExportMixin, AdminArcoListView):
    """GET /api/v1/legal/admin/arco/export/?fmt=csv|xlsx|pdf — the filtered queue (audited)."""
    export_spec = ARCO_EXPORT_SPEC


CLOSED = (ArcoRequest.Status.RESOLVED, ArcoRequest.Status.REJECTED)


class AdminArcoStatusView(APIView):
    """POST /api/v1/legal/admin/arco/<id>/status/ — advance an ARCO request.

    Guarded by the ``legal.arcorequest`` transition table (received → in_review
    | resolved | rejected; in_review → resolved | rejected; resolved | rejected
    → in_review with a note). Resolving or rejecting requires the
    ``resolution_note`` the requester receives by email; reopening requires a
    note that is kept in the audit entry. Every change is audited with the note.
    """
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        serializer = ArcoStatusInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = serializer.validated_data['status']
        note = (serializer.validated_data.get('resolution_note') or '').strip()
        with transaction.atomic():
            arco = get_object_or_404(ArcoRequest.objects.select_for_update(), pk=pk)
            current = arco.status
            assert_transition('legal.arcorequest', current, target, note=note)
            if target in CLOSED and not note:
                raise ValidationError({'resolution_note': ['Indique la resolución o el motivo.']})
            arco.status = target
            if target in CLOSED:
                arco.resolution_note = note
                arco.resolved_at = timezone.now()
            else:
                # Reopened (or first review): the case is live again.
                arco.resolved_at = None
            arco.save(update_fields=['status', 'resolution_note', 'resolved_at', 'updated_at'])
            changes = {'status': [current, target]}
            if note:
                changes['note'] = note[:500]
            record('update', arco, changes, actor=request.user, context='legal.arco.status')
        _notify_requester(arco)
        return Response(ArcoRequestSerializer(arco).data)


ARCO_IN_REVIEW = status_action(
    'in_review', 'Marcar en revisión', entity='legal.arcorequest', target='in_review',
)
# Bulk only moves new requests into review; reopening a closed one is a
# single-row decision with its own note.
ARCO_IN_REVIEW.allowed_from = frozenset({ArcoRequest.Status.RECEIVED})


class AdminArcoBulkView(AdminBulkView):
    """POST /api/v1/legal/admin/arco/bulk/ — ``in_review`` only (C5); resolve and
    reject stay single-row because each needs its own resolution note."""
    entity = 'legal.arcorequest'
    list_view_class = AdminArcoListView
    actions = {ARCO_IN_REVIEW.name: ARCO_IN_REVIEW}


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
