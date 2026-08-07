"""
admissions/views.py — Public forms API (no auth required)
"""
from datetime import datetime

from django.conf import settings
from django.core.mail import send_mail
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions, status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.bookings.models import AvailabilitySlot, Booking, VisitType
from apps.bookings.serializers import BookingSerializer, OpenClassEventSerializer
from apps.bookings.services import SlotUnavailable, create_booking
from apps.core.ratelimit import ratelimit

from .models import PreRegistration, Registration, RegistrationDocument
from .serializers import (
    DocumentVerifySerializer,
    PreRegistrationAdminSerializer,
    PreRegistrationStatusSerializer,
    PublicPreRegistrationSerializer,
    RegistrationAdminListSerializer,
    RegistrationDocumentSerializer,
    RegistrationSerializer,
    RegistrationStatusSerializer,
    current_school_cycle,
)
from .tokens import issue_invite, issue_session, redeem_invite, session_valid


class IsAdmin(permissions.BasePermission):
    """Authenticated admin users only (matches bookings/cafeteria convention)."""
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == User.Role.ADMIN)


def _is_staff(request):
    """True for authenticated staff/admin users (JWT), who bypass the token gate."""
    user = getattr(request, 'user', None)
    return bool(
        user and user.is_authenticated
        and (user.is_staff or getattr(user, 'role', '') == 'admin')
    )


def _session_token(request):
    """Read the working session token from the header or POST body (never a URL)."""
    return request.headers.get('X-Session-Token') or request.data.get('session_token', '')


def authorize_registration(request, pk):
    """Return the Registration if the caller may act on it, else raise 401.

    Staff (JWT) may act on any registration. Anonymous applicants must present a
    valid, unexpired SESSION token (header/body). Anonymous callers get a uniform
    401 whether or not the PK exists, so sequential PKs can't be enumerated.
    """
    if _is_staff(request):
        return get_object_or_404(Registration, pk=pk)
    try:
        reg = Registration.objects.get(pk=pk)
    except Registration.DoesNotExist:
        raise AuthenticationFailed('Sesión de inscripción inválida.') from None
    if not session_valid(reg, _session_token(request)):
        raise AuthenticationFailed('Sesión de inscripción inválida.')
    return reg


@method_decorator(ratelimit('admissions-submit', '5/m', method='POST'), name='dispatch')
class PreRegistrationListCreateView(generics.ListCreateAPIView):
    """POST /api/v1/admissions/pre-register/ — Public, no auth.
    GET — Admin-only paginated list for the Admisiones console."""
    queryset = PreRegistration.objects.all()

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAdmin()]
        return [permissions.AllowAny()]

    def get_serializer_class(self):
        if self.request.method == 'GET':
            return PreRegistrationAdminSerializer
        # POST is the public form — accept its payload and map it internally.
        return PublicPreRegistrationSerializer

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
        # Deliver to the school's contact inbox (NOT EMAIL_HOST_USER, which is the
        # SMTP auth user and is empty by default), mirroring the contact form.
        recipient = getattr(settings, 'CONTACT_EMAIL', '') or settings.DEFAULT_FROM_EMAIL
        send_mail(
            subject=f'[Interlaken] Nuevo pre-registro: {obj.child_first_name} {obj.child_last_name}',
            message=(
                f'Nivel: {obj.level}\nGrado: {obj.grade_applying}\n'
                f'Padre/Tutor: {obj.parent_name}\nEmail: {obj.parent_email}\n'
                f'Teléfono: {obj.parent_phone}'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient],
            fail_silently=True,
        )


class PreRegistrationDetailView(generics.UpdateAPIView):
    """PATCH /api/v1/admissions/pre-register/<pk>/ — admin: update status/notes.

    Lets staff move a pre-registration through the pipeline
    (pending → contacted → enrolled/rejected) straight from the console.
    """
    queryset = PreRegistration.objects.all()
    serializer_class = PreRegistrationStatusSerializer
    permission_classes = [IsAdmin]
    http_method_names = ['patch']


class PreRegistrationInviteView(APIView):
    """POST /api/v1/admissions/pre-register/<pk>/invite/ — admin issues an
    enrollment invite for a pre-registration.

    Creates (or reuses) a DRAFT Registration pre-filled from the pre-registration,
    mints a fresh single-use invite token, and returns a ready-to-share link
    (``/inscripcion?rid=&token=``). The invite is also emailed to the applicant
    (fail-soft). Idempotent: re-inviting the same pre-registration refreshes the
    token on the existing draft rather than spawning duplicates.
    """
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        pre = get_object_or_404(PreRegistration, pk=pk)

        reg = pre.registrations.filter(status=Registration.Status.DRAFT).first()
        if reg is None:
            reg = Registration(pre_registration=pre)
        # (Re)seed the draft from the pre-registration so the applicant lands on a
        # pre-filled form. Only overwrite while still a fresh draft.
        reg.child_first_name = pre.child_first_name
        reg.child_last_name = pre.child_last_name
        reg.child_dob = pre.child_dob
        reg.level = pre.level
        reg.grade_applying = pre.grade_applying
        reg.cycle = pre.cycle or current_school_cycle()
        reg.parent1_name = pre.parent_name
        reg.parent1_email = pre.parent_email
        reg.parent1_phone = pre.parent_phone
        reg.save()

        raw = issue_invite(reg)
        invite_url = f'{settings.FRONTEND_URL}/inscripcion?rid={reg.id}&token={raw}'

        # Issuing an invite means admissions has engaged the family — advance the
        # pre-registration out of "pending" so the pipeline reflects reality.
        if pre.status == PreRegistration.Status.PENDING:
            pre.status = PreRegistration.Status.CONTACTED
            pre.save(update_fields=['status'])

        self._email_invite(reg, invite_url)
        return Response({
            'registration_id': reg.id,
            'invite_token': raw,
            'invite_url': invite_url,
            'expires_at': reg.invite_expires_at,
        }, status=status.HTTP_201_CREATED)

    def _email_invite(self, reg, invite_url):
        send_mail(
            subject='Invitación de inscripción — Colegio Interlaken',
            message=(
                f'Estimado/a {reg.parent1_name},\n\n'
                f'Le invitamos a completar la inscripción de {reg.child_first_name} '
                f'{reg.child_last_name} para el ciclo {reg.cycle}.\n\n'
                f'Ingrese al siguiente enlace para continuar:\n{invite_url}\n\n'
                f'El enlace es personal y expira en 14 días.\n\n'
                f'Colegio Interlaken'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[reg.parent1_email],
            fail_silently=True,
        )


@method_decorator(ratelimit('admissions-submit', '5/m', method='POST'), name='dispatch')
class RegistrationListCreateView(generics.ListCreateAPIView):
    """POST /api/v1/admissions/register/ — Start a registration (no auth).
    GET — Admin-only paginated list for the Inscripciones console."""
    queryset = Registration.objects.all().prefetch_related('documents')

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAdmin()]
        return [permissions.AllowAny()]

    def get_serializer_class(self):
        if self.request.method == 'GET':
            return RegistrationAdminListSerializer
        return RegistrationSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        # Hand the one-time INVITE token back exactly once, in the body (never a
        # URL). It is exchanged (POST) for a session token to continue the flow.
        data = dict(serializer.data)
        data['invite_token'] = issue_invite(serializer.instance)
        return Response(data, status=status.HTTP_201_CREATED, headers=headers)


class RegistrationStatusView(generics.UpdateAPIView):
    """PATCH /api/v1/admissions/register/<pk>/status/ — admin review action.

    Moves a registration through review (reviewing → approved / rejected /
    complete) and records admin notes. On an approve/reject the applicant is
    emailed the outcome (fail-soft).
    """
    queryset = Registration.objects.all()
    serializer_class = RegistrationStatusSerializer
    permission_classes = [IsAdmin]
    http_method_names = ['patch']

    def perform_update(self, serializer):
        before = serializer.instance.status
        reg = serializer.save()
        if reg.status != before and reg.status in (
                Registration.Status.APPROVED, Registration.Status.REJECTED):
            self._email_outcome(reg)

    def _email_outcome(self, reg):
        approved = reg.status == Registration.Status.APPROVED
        subject = ('Inscripción aprobada' if approved else
                   'Actualización de su inscripción') + ' — Colegio Interlaken'
        body = (
            f'Estimado/a {reg.parent1_name},\n\n'
            + (f'Nos complace informarle que la inscripción de {reg.child_first_name} '
               f'{reg.child_last_name} ha sido APROBADA. En breve le compartiremos los '
               f'siguientes pasos.\n\n'
               if approved else
               f'Hemos revisado la solicitud de inscripción de {reg.child_first_name} '
               f'{reg.child_last_name}. Un asesor de admisiones se pondrá en contacto con '
               f'usted para darle más información.\n\n')
            + 'Colegio Interlaken'
        )
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL,
                  [reg.parent1_email], fail_silently=True)


class DocumentVerifyView(generics.UpdateAPIView):
    """PATCH /api/v1/admissions/documents/<pk>/verify/ — admin marks a document
    verified (or clears verification)."""
    queryset = RegistrationDocument.objects.all()
    serializer_class = DocumentVerifySerializer
    permission_classes = [IsAdmin]
    http_method_names = ['patch']


class DocumentDownloadView(APIView):
    """GET /api/v1/admissions/documents/<pk>/download/ — stream an uploaded
    registration document to an authorized caller.

    Production serves no ``/media/`` path (Django serves it only under DEBUG,
    and the deploy fronts /api,/auth,/admin,/static via Passenger — never
    /media), so this authenticated view IS the download path. That keeps
    minors' documents (birth certificates, CURP, photos) off any guessable,
    unauthenticated URL — do NOT "fix" the download gap by aliasing /media/ in
    Apache, which would expose them publicly.

    Authorization mirrors the upload/act gate (``authorize_registration``):
    staff (JWT) may fetch any document; an anonymous applicant may fetch only
    their own registration's documents with a valid session token. The file is
    always sent as an attachment, never rendered inline.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        doc = (RegistrationDocument.objects
               .select_related('registration')
               .filter(pk=pk).first())
        # Don't reveal document existence to anonymous callers — mirror
        # authorize_registration's uniform 401 (anti-enumeration). Staff, being
        # authenticated, get a plain 404 for a genuinely missing document.
        if doc is None:
            if _is_staff(request):
                raise Http404('Documento no encontrado.')
            raise AuthenticationFailed('Sesión de inscripción inválida.')

        # Staff bypass, or the owning applicant's session token for THIS
        # registration; anyone else gets a uniform 401.
        authorize_registration(request, doc.registration_id)

        try:
            fh = doc.file.open('rb')
        except (FileNotFoundError, ValueError):
            raise Http404('Archivo no disponible.') from None
        return FileResponse(fh, as_attachment=True,
                            filename=doc.filename or 'documento')


class RegistrationAccessView(APIView):
    """POST /api/v1/admissions/register/<id>/access/ — exchange invite → session.

    Body ``{token}``. Single-use: a valid, unexpired invite is consumed and a
    short-lived session token is returned (used via the X-Session-Token header on
    subsequent steps). Reuse or an expired/invalid token → 401.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        try:
            reg = Registration.objects.get(pk=pk)
        except Registration.DoesNotExist:
            raise AuthenticationFailed('Invitación inválida o expirada.') from None
        token = request.data.get('token', '')
        if not redeem_invite(reg, token):
            raise AuthenticationFailed('Invitación inválida o expirada.')
        session = issue_session(reg)
        return Response({
            'session_token': session,
            'expires_at': reg.session_expires_at,
            'registration': RegistrationSerializer(reg).data,
        })


class RegistrationDetailView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/v1/admissions/register/<id>/ — Retrieve or update.

    Anonymous applicants must present a valid SESSION token (X-Session-Token
    header); staff (JWT) may access without it.
    """
    serializer_class = RegistrationSerializer
    permission_classes = [permissions.AllowAny]
    queryset = Registration.objects.all()

    def get_object(self):
        return authorize_registration(self.request, self.kwargs['pk'])


class RegistrationSubmitView(APIView):
    """POST /api/v1/admissions/register/<id>/submit/ — Submit for review."""
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        reg = authorize_registration(request, pk)

        if reg.status != Registration.Status.DRAFT:
            return Response({'error': 'Registration already submitted'},
                            status=status.HTTP_400_BAD_REQUEST)

        # LFPDPPP (IK-LEGAL B2): Stage B requires acceptance of the current notice.
        if reg.privacy_accepted_at is None:
            from apps.legal.models import PrivacyNoticeVersion
            if not request.data.get('accept_privacy'):
                return Response(
                    {'error': 'Debe aceptar el Aviso de Privacidad para enviar la inscripción.'},
                    status=status.HTTP_400_BAD_REQUEST)
            reg.privacy_notice_version = PrivacyNoticeVersion.current()
            reg.privacy_accepted_at = timezone.now()
            reg.save(update_fields=['privacy_notice_version', 'privacy_accepted_at'])

        # Medical data may only be submitted with explicit MEDICAL_DATA consent.
        has_medical = any([reg.blood_type, reg.allergies, reg.medical_notes])
        if has_medical and not reg.consent_medical_data:
            return Response(
                {'error': 'Se requiere consentimiento de datos de salud para enviar información médica.'},
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
        reg = authorize_registration(request, pk)

        file = request.FILES.get('file')
        doc_type = request.data.get('doc_type')

        if not file or not doc_type:
            return Response({'error': 'file and doc_type are required'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Validate doc_type against the model's choices — create() skips
        # full_clean(), so without this any string is stored.
        if doc_type not in RegistrationDocument.DocType.values:
            return Response({'error': 'doc_type no válido.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Validate extension
        import os
        ext = os.path.splitext(file.name)[1].lower()
        if ext not in settings.ALLOWED_DOCUMENT_EXTENSIONS:
            return Response({'error': f'File type {ext} not allowed'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Cap the size — the *_MAX_MEMORY_SIZE settings don't bound uploads, so
        # without this an invited session-holder could fill the disk (DoS).
        max_size = getattr(settings, 'MAX_DOCUMENT_UPLOAD_SIZE', 10 * 1024 * 1024)
        if file.size > max_size:
            return Response(
                {'error': f'El archivo excede el tamaño máximo de '
                          f'{max_size // (1024 * 1024)} MB.'},
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
        today = timezone.localdate()  # school-local day, not the UTC date
        now = timezone.now()
        slots = [
            s for s in AvailabilitySlot.objects.filter(
                visit_type=VisitType.OPEN_CLASS, is_active=True, date__gte=today,
            ).order_by('date', 'start_time')
            if not s.is_full
            and timezone.make_aware(datetime.combine(s.date, s.start_time)) >= now
        ]
        return Response(OpenClassEventSerializer(slots, many=True).data)


@method_decorator(ratelimit('booking-create', '10/m', method='POST'), name='dispatch')
class OpenSchoolDaySignUpView(APIView):
    """POST /api/v1/admissions/open-school/signup/ — book an open-class event.

    Backward-compatible route. Creates a ``bookings.Booking`` (source=web) against
    the chosen open_class slot, capacity-safe, with Google Calendar sync +
    confirmation email (fail-soft). Accepts either the unified field names
    (``slot/parent_name/parent_email/parent_phone/num_attendees``) or the legacy
    frontend names (``event/name/email/phone/children_count``).

    Shares the ``booking-create`` rate-limit bucket with the main booking
    endpoint: without it this parallel public route defeated that limit and let
    an unauthenticated caller exhaust slot capacity.
    """
    permission_classes = [permissions.AllowAny]
    MAX_ATTENDEES = 20  # a family signup, not a bulk reservation

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
        num = min(max(1, num), self.MAX_ATTENDEES)

        # This route is for open-class events only — don't let it be used to
        # consume individual (1:1) visit slots.
        slot = AvailabilitySlot.objects.filter(pk=slot_id).first()
        if slot is None or slot.visit_type != VisitType.OPEN_CLASS:
            return Response({'detail': 'Evento no válido.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            booking = create_booking(
                slot_id=slot_id,
                parent_name=d.get('parent_name') or d.get('name') or '',
                parent_email=d.get('parent_email') or d.get('email') or '',
                parent_phone=d.get('parent_phone') or d.get('phone') or '',
                num_attendees=num,
                source=Booking.Source.WEB,
            )
        except SlotUnavailable as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)
