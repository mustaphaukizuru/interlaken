"""
admissions/views.py — Public forms API (no auth required)
"""
from django.conf import settings
from django.core.mail import send_mail
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.bookings.models import AvailabilitySlot, Booking, VisitType
from apps.bookings.serializers import BookingSerializer, OpenClassEventSerializer
from apps.bookings.services import SlotUnavailable, create_booking

from .models import Registration, RegistrationDocument


def _is_staff(request):
    """True for authenticated staff/admin users (JWT), who bypass the token gate."""
    user = getattr(request, 'user', None)
    return bool(
        user and user.is_authenticated
        and (user.is_staff or getattr(user, 'role', '') == 'admin')
    )


def _require_registration_access(request, reg):
    """Gate a Registration behind its access_token for anonymous applicants.

    Staff pass through. Everyone else must present the correct ``access_token``
    (query param or ``X-Access-Token`` header). On failure we raise NotFound so
    the endpoint leaks nothing about which sequential PKs exist.
    """
    if _is_staff(request):
        return
    provided = (
        request.query_params.get('access_token')
        or request.headers.get('X-Access-Token', '')
    )
    if provided and str(provided) == str(reg.access_token):
        return
    raise NotFound('No encontrado.')
from .serializers import (
    PreRegistrationSerializer,
    RegistrationDocumentSerializer,
    RegistrationSerializer,
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

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        # Hand the capability token back exactly once, to the creating applicant.
        data = dict(serializer.data)
        data['access_token'] = str(serializer.instance.access_token)
        return Response(data, status=status.HTTP_201_CREATED, headers=headers)


class RegistrationDetailView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/v1/admissions/register/<id>/ — Retrieve or update.

    Anonymous applicants must present the registration's ``access_token``;
    staff (JWT) may access without it.
    """
    serializer_class = RegistrationSerializer
    permission_classes = [permissions.AllowAny]
    queryset = Registration.objects.all()

    def get_object(self):
        reg = get_object_or_404(Registration, pk=self.kwargs['pk'])
        _require_registration_access(self.request, reg)
        return reg


class RegistrationSubmitView(APIView):
    """POST /api/v1/admissions/register/<id>/submit/ — Submit for review."""
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        try:
            reg = Registration.objects.get(pk=pk)
        except Registration.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        _require_registration_access(request, reg)

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

        _require_registration_access(request, reg)

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


class OpenSchoolDayListView(APIView):
    """GET /api/v1/admissions/open-school/ — upcoming open-class events.

    Backward-compatible route. Data now comes from the unified bookings model
    (``AvailabilitySlot`` with ``visit_type=open_class``); see
    BOOKING_CALENDAR_SPEC §4.2. The response keeps the public event shape
    (``id, date, title, location, spots_remaining, is_active``).
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        today = timezone.now().date()
        slots = [
            s for s in AvailabilitySlot.objects.filter(
                visit_type=VisitType.OPEN_CLASS, is_active=True, date__gte=today,
            ).order_by('date', 'start_time')
            if not s.is_full
        ]
        return Response(OpenClassEventSerializer(slots, many=True).data)


class OpenSchoolDaySignUpView(APIView):
    """POST /api/v1/admissions/open-school/signup/ — book an open-class event.

    Backward-compatible route. Creates a ``bookings.Booking`` (source=web) against
    the chosen open_class slot, capacity-safe, with Google Calendar sync +
    confirmation email (fail-soft). Accepts either the unified field names
    (``slot/parent_name/parent_email/parent_phone/num_attendees``) or the legacy
    frontend names (``event/name/email/phone/children_count``).
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        d = request.data
        slot_id = d.get('slot') or d.get('event')
        if not slot_id:
            return Response({'detail': 'Seleccione un evento.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            num = int(d.get('num_attendees') or d.get('children_count') or 1)
        except (TypeError, ValueError):
            num = 1
        try:
            booking = create_booking(
                slot_id=slot_id,
                parent_name=d.get('parent_name') or d.get('name') or '',
                parent_email=d.get('parent_email') or d.get('email') or '',
                parent_phone=d.get('parent_phone') or d.get('phone') or '',
                num_attendees=max(1, num),
                source=Booking.Source.WEB,
            )
        except SlotUnavailable as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)
