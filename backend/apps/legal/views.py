"""
legal/views.py — public privacy notice + authenticated consent capture (B2).
"""
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProfile

from .models import PrivacyNoticeVersion
from .serializers import ConsentInputSerializer, PrivacyNoticeSerializer
from .services import consent_state, needs_acceptance, record_consent


class CurrentNoticeView(APIView):
    """GET /api/v1/legal/notice/ — the current Aviso de Privacidad (public)."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        notice = PrivacyNoticeVersion.current()
        if notice is None:
            return Response({'detail': 'No hay un aviso de privacidad vigente.'},
                            status=status.HTTP_404_NOT_FOUND)
        return Response(PrivacyNoticeSerializer(notice).data)


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
