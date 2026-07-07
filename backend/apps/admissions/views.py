"""
admissions/views.py — Public forms API (no auth required)
"""
from rest_framework import generics, status, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone

from .models import PreRegistration, Registration, RegistrationDocument, OpenSchoolDay
from .serializers import (
    PreRegistrationSerializer,
    RegistrationSerializer,
    RegistrationDocumentSerializer,
    OpenSchoolDaySerializer,
    OpenSchoolDayEventSerializer,
)


class PreRegistrationCreateView(generics.CreateAPIView):
    """POST /api/v1/admissions/pre-register/ — Public, no auth."""
    serializer_class = PreRegistrationSerializer
    permission_classes = [permissions.AllowAny]

    def perform_create(self, serializer):
        instance = serializer.save()
        self._send_confirmation(instance)
        self._notify_admin(instance)

    def _send_confirmation(self, obj):
        send_mail(
            subject='Pre-registro recibido — Colegio Interlaken',
            message=(
                f'Estimado/a {obj.parent_name},\n\n'
                f'Hemos recibido su solicitud de pre-registro para {obj.child_first_name} '
                f'{obj.child_last_name}. En breve nos pondremos en contacto con usted.\n\n'
                f'Colegio Interlaken\ncolegio@interlaken.edu.mx'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[obj.parent_email],
            fail_silently=True,
        )

    def _notify_admin(self, obj):
        send_mail(
            subject=f'[Interlaken] Nuevo pre-registro: {obj.child_first_name} {obj.child_last_name}',
            message=(
                f'Nivel: {obj.level}\nGrado: {obj.grade_applying}\n'
                f'Padre/Tutor: {obj.parent_name}\nEmail: {obj.parent_email}\n'
                f'Teléfono: {obj.parent_phone}'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[settings.EMAIL_HOST_USER],
            fail_silently=True,
        )


class RegistrationCreateView(generics.CreateAPIView):
    """POST /api/v1/admissions/register/ — Start a registration (no auth)."""
    serializer_class = RegistrationSerializer
    permission_classes = [permissions.AllowAny]


class RegistrationDetailView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/v1/admissions/register/<id>/ — Retrieve or update."""
    serializer_class = RegistrationSerializer
    permission_classes = [permissions.AllowAny]
    queryset = Registration.objects.all()


class RegistrationSubmitView(APIView):
    """POST /api/v1/admissions/register/<id>/submit/ — Submit for review."""
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        try:
            reg = Registration.objects.get(pk=pk)
        except Registration.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        if reg.status != Registration.Status.DRAFT:
            return Response({'error': 'Registration already submitted'},
                            status=status.HTTP_400_BAD_REQUEST)

        reg.submit()
        # Send confirmation email
        send_mail(
            subject='Inscripción recibida — Colegio Interlaken',
            message=(
                f'Estimado/a {reg.parent1_name},\n\n'
                f'Hemos recibido la documentación de inscripción de {reg.child_first_name} '
                f'{reg.child_last_name}. La revisaremos y le informaremos en un plazo de 3-5 días hábiles.\n\n'
                f'Colegio Interlaken'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[reg.parent1_email],
            fail_silently=True,
        )
        return Response({'status': 'submitted', 'message': 'Inscripción enviada exitosamente.'})


class DocumentUploadView(APIView):
    """POST /api/v1/admissions/register/<id>/documents/ — Upload a document."""
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        try:
            reg = Registration.objects.get(pk=pk)
        except Registration.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        file = request.FILES.get('file')
        doc_type = request.data.get('doc_type')

        if not file or not doc_type:
            return Response({'error': 'file and doc_type are required'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Validate extension
        import os
        ext = os.path.splitext(file.name)[1].lower()
        if ext not in settings.ALLOWED_DOCUMENT_EXTENSIONS:
            return Response({'error': f'File type {ext} not allowed'},
                            status=status.HTTP_400_BAD_REQUEST)

        doc = RegistrationDocument.objects.create(
            registration=reg,
            doc_type=doc_type,
            file=file,
            filename=file.name,
            file_size=file.size,
        )
        return Response(RegistrationDocumentSerializer(doc).data,
                        status=status.HTTP_201_CREATED)


class OpenSchoolDayListView(generics.ListAPIView):
    """GET /api/v1/admissions/open-school/ — List upcoming events."""
    serializer_class = OpenSchoolDayEventSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        today = timezone.now().date()
        return OpenSchoolDay.objects.filter(
            event_date__gte=today,
            status=OpenSchoolDay.Status.CONFIRMED,
        ).values('event_date', 'event_time', 'event_name').distinct()


class OpenSchoolDaySignUpView(generics.CreateAPIView):
    """POST /api/v1/admissions/open-school/ — Sign up for an event."""
    serializer_class = OpenSchoolDaySerializer
    permission_classes = [permissions.AllowAny]

    def perform_create(self, serializer):
        instance = serializer.save()
        send_mail(
            subject='Confirmación — Puertas Abiertas Colegio Interlaken',
            message=(
                f'Estimado/a {instance.parent_name},\n\n'
                f'Confirmamos su registro para el evento Puertas Abiertas el '
                f'{instance.event_date} a las {instance.event_time}.\n\n'
                f'¡Esperamos verle pronto!\nColegio Interlaken'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[instance.parent_email],
            fail_silently=True,
        )
