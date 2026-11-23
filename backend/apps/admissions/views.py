"""
admissions/views.py — Public forms API (no auth required)
"""
import logging
from datetime import datetime

from django.conf import settings
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions, status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.bookings.models import AvailabilitySlot, Booking, VisitType
from apps.bookings.serializers import BookingSerializer, OpenClassEventSerializer
from apps.bookings.services import SlotUnavailable, create_booking
from apps.core.audit import record
from apps.core.exceptions import error_body
from apps.core.listing import AdminListMixin
from apps.core.permissions import IsAdmin, is_admin_or_django_staff
from apps.core.ratelimit import ratelimit
from apps.portal.services import send_email

from . import ficha
from .filters import PreRegistrationFilter, RegistrationFilter
from .models import PreRegistration, Registration, RegistrationDocument
from .serializers import (
    DocumentVerifySerializer,
    PreRegistrationAdminSerializer,
    PreRegistrationStatusSerializer,
    PublicPreRegistrationSerializer,
    RegistrationAdminListSerializer,
    RegistrationParentStatusSerializer,
    RegistrationSerializer,
    RegistrationStatusSerializer,
)
from .services import (
    OUTCOME_STATES,
    PREREG_ENTITY,
    REG_ENTITY,
    change_status,
    email_registration_outcome,
    email_rejected_documents,
    invite_preregistration,
    invite_url_for,
)
from .tokens import issue_invite, issue_session, redeem_invite, session_valid

logger = logging.getLogger(__name__)

FICHA_BY_SECTIONS = ('Esta ficha de inscripción se guarda por secciones. Actualice la página '
                     'para continuarla.')
PUBLIC_START_OFF = ('La ficha de inscripción es personal: el colegio envía el enlace a cada familia '
                    'cuando su hijo/a es admitido, después del examen de valoración. Para empezar, '
                    'agende una visita o escríbanos.')


def _is_staff(request):
    """True for authenticated staff/admin users (JWT), who bypass the token gate.

    The rule lives in ``apps.core.permissions.is_admin_or_django_staff``; a
    staff account with the ``admisiones`` console area counts too.
    """
    from apps.core.areas import has_area

    user = getattr(request, 'user', None)
    return is_admin_or_django_staff(user) or has_area(user, 'admisiones')


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


# Columns the pre-registros table can sort by (public key → ORM field(s)).
PREREGISTRATION_ORDERING = {
    'created_at': 'created_at',
    'child': ('child_last_name', 'child_first_name'),
    'level': 'level',
    'grade': 'grade_applying',
    'status': 'status',
    'parent': 'parent_name',
}


class PreRegistrationListConfig(AdminListMixin):
    """The pre-registros list contract, shared by the list, its export sibling
    and the bulk ``all_matching`` resolver (Data Ops C1): ``q`` over child
    names, parent name, email and phone (the ``search`` alias is gone since Phase 10),
    whitelisted ``ordering``, FilterSet ``status/level/cycle/wants_visit`` +
    ``from/to`` on ``created_at``, ``page_size`` ≤ 100."""
    queryset = PreRegistration.objects.all()
    serializer_class = PreRegistrationAdminSerializer
    search_fields = (
        'child_first_name',
        'child_last_name',
        'parent_name',
        'parent_email',
        'parent_phone',
    )
    ordering = PREREGISTRATION_ORDERING
    default_ordering = '-created_at'
    filterset_class = PreRegistrationFilter


class PreRegistrationAdminListView(PreRegistrationListConfig, generics.ListAPIView):
    """GET-only twin of the list (not routed): the export view subclasses it and
    the bulk view resolves ``all_matching`` through it, so neither can inherit
    the public POST of ``PreRegistrationListCreateView``."""


@method_decorator(ratelimit('admissions-submit', '5/m', method='POST'), name='dispatch')
class PreRegistrationListCreateView(PreRegistrationListConfig, generics.ListCreateAPIView):
    """POST /api/v1/admissions/pre-register/ — Public, no auth.
    GET — Admin-only paginated list for the Admisiones console."""
    admin_area = 'admisiones'

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
        subject, content = pre_registration_received_email(obj)
        send_email(subject, '', [obj.parent_email],
                   reply_to=settings.ADMISSIONS_EMAIL, content=content)

    def _notify_admin(self, obj):
        # Deliver to the school's contact inbox (NOT EMAIL_HOST_USER, which is the
        # SMTP auth user and is empty by default), mirroring the contact form.
        recipient = settings.ADMISSIONS_EMAIL or settings.CONTACT_EMAIL or settings.DEFAULT_FROM_EMAIL
        subject, content = pre_registration_office_email(obj)
        send_email(subject, '', [recipient], reply_to=obj.parent_email, content=content)


# ── email builders: pure ``(subject, EmailContent)``, previewed by render_emails ──
# D13: subjects carry no person's name; family bodies name the child «Ana P.».
def pre_registration_received_email(obj):
    from apps.portal.emailing import EmailContent, name_initial

    content = EmailContent(
        category='Admisiones', tone='success',
        title=f'Recibimos el pre-registro de {obj.child_first_name}',
        intro=(f'Estimado/a {obj.parent_name}: gracias por su interés en el Colegio Interlaken. '
               f'Recibimos su pre-registro y en breve nos pondremos en contacto con usted.'),
        details=[('Alumno', name_initial(obj.child_first_name, obj.child_last_name)),
                 ('Nivel', obj.get_level_display()),
                 ('Grado', obj.grade_applying),
                 ('Visita al colegio', 'Solicitada' if obj.wants_visit else 'No solicitada')],
        note='Si algún dato no es correcto, responda a este correo y lo corregimos.',
        signoff='Equipo de Admisiones',
        reason='Recibe este correo porque llenó el formulario de pre-registro en interlaken.edu.mx.',
    )
    return 'Pre-registro recibido', content


def pre_registration_office_email(obj):
    from apps.portal.emailing import EmailContent, portal_url

    child = f'{obj.child_first_name} {obj.child_last_name}'.strip()
    content = EmailContent(
        category='Admisiones · aviso interno',
        title=f'Nuevo pre-registro: {child}',
        intro='Llegó un pre-registro desde el sitio. Responda a este correo para escribirle directamente a la familia.',
        details=[('Nivel', obj.get_level_display()), ('Grado', obj.grade_applying), ('Padre/Tutor', obj.parent_name),
                 ('Correo', obj.parent_email), ('Teléfono', obj.parent_phone),
                 ('Desea visita', 'Sí' if obj.wants_visit else 'No')],
        cta_label='Abrir en Admisiones', cta_url=portal_url('/admin/admisiones'), link_fallback=False,
        reason='Aviso interno del sitio del Colegio Interlaken.',
    )
    return 'Nuevo pre-registro', content


def documents_request_email(reg, url: str, missing):
    from apps.portal.emailing import EmailContent, name_initial

    content = EmailContent(
        category='Admisiones', tone='warning',
        title=f'Documentos para la inscripción de {reg.child_first_name}',
        intro=(f'Estimado/a {reg.parent1_name}: para continuar la inscripción de '
               f'{name_initial(reg.child_first_name, reg.child_last_name)}, suba los siguientes documentos:'),
        items=list(missing),
        cta_label='Subir documentos', cta_url=url,
        note='El enlace es personal, de un solo uso y válido por tiempo limitado.',
        signoff='Equipo de Admisiones',
        reason='Recibe este correo porque inició un proceso de admisión en el Colegio Interlaken.',
    )
    return 'Documentos de inscripción', content


def registration_received_email(reg):
    from apps.portal.emailing import EmailContent, name_initial

    child = name_initial(reg.child_first_name, reg.child_last_name)
    content = EmailContent(
        category='Admisiones', tone='success',
        title=f'Recibimos la inscripción de {reg.child_first_name}',
        intro=(f'Estimado/a {reg.parent1_name}: recibimos la documentación de inscripción de {child}. '
               f'La revisaremos y le informaremos el resultado en un plazo de 3 a 5 días hábiles.'),
        details=[('Alumno', child), ('Grado', reg.grade_applying), ('Ciclo escolar', reg.cycle)],
        note='No necesita hacer nada más por ahora. Si tiene dudas, responda a este correo.',
        signoff='Equipo de Admisiones',
        reason='Recibe este correo porque envió una inscripción al Colegio Interlaken.',
    )
    return 'Inscripción recibida', content


class PreRegistrationDetailView(generics.UpdateAPIView):
    """PATCH /api/v1/admissions/pre-register/<pk>/ — admin: update status/notes.

    A status change obeys the same transition table as the bulk action
    (``apps.core.transitions``); undoing a decision (contacted/rejected →
    pending) needs ``note`` in the body. Every change is audited.
    """
    admin_area = 'admisiones'
    queryset = PreRegistration.objects.all()
    serializer_class = PreRegistrationStatusSerializer
    permission_classes = [IsAdmin]
    http_method_names = ['patch']

    def perform_update(self, serializer):
        pre = serializer.instance
        data = serializer.validated_data
        target = data.get('status', pre.status)
        note = str(self.request.data.get('note') or '').strip()
        if target != pre.status:
            change_status(pre, target, entity=PREREG_ENTITY, actor=self.request.user,
                          note=note, context='admissions: pre-registro')
        if 'notes' in data and data['notes'] != pre.notes:
            pre.notes = data['notes']
            pre.save(update_fields=['notes', 'updated_at'])
            record('update', pre, {'notes': 'editadas'}, actor=self.request.user,
                   context='admissions: pre-registro')


class PreRegistrationInviteView(APIView):
    """POST /api/v1/admissions/pre-register/<pk>/invite/ — admin issues an
    enrollment invite for a pre-registration.

    Creates (or reuses) a DRAFT Registration pre-filled from the pre-registration,
    mints a fresh single-use invite token, and returns a ready-to-share link
    (``/pre-registro?rid=&token=``, the ficha). The invite is also emailed to the applicant
    (fail-soft). Idempotent: re-inviting the same pre-registration refreshes the
    token on the existing draft rather than spawning duplicates.

    Same rule as the Expediente: only once the exam result is «Aceptado» (409
    ``not_admitted`` before), unless an administrator sends ``override`` with
    an ``override_reason`` (audited).
    """
    admin_area = 'admisiones'
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from .process import CaseConflict
        from .services import AlreadyApplied

        pre = get_object_or_404(PreRegistration, pk=pk)
        override = str(request.data.get('override', '')).strip().lower() in ('1', 'true', 'on', 'si', 'sí')
        try:
            out = invite_preregistration(pre, request.user, override=override,
                                         override_reason=request.data.get('override_reason', ''))
        except CaseConflict as exc:
            return Response(error_body(exc.message, code=exc.code, **exc.extra),
                            status=status.HTTP_409_CONFLICT)
        except AlreadyApplied as exc:
            return Response({'detail': f'La familia {exc}.'}, status=status.HTTP_409_CONFLICT)
        reg = out['registration']
        return Response({
            'registration_id': reg.id,
            'invite_token': out['raw'],
            'invite_url': out['url'],
            'expires_at': reg.invite_expires_at,
        }, status=status.HTTP_201_CREATED)


# Columns the inscripciones table can sort by (public key → ORM field(s)).
REGISTRATION_ORDERING = {
    'created_at': 'created_at',
    'updated_at': 'updated_at',
    'submitted_at': 'submitted_at',
    'child': ('child_last_name', 'child_first_name'),
    'level': 'level',
    'status': 'status',
}


class RegistrationListConfig(AdminListMixin):
    """The inscripciones list contract (Data Ops C1): ``q`` over child names,
    CURP, parent names, emails and phones; FilterSet ``status/level/cycle/
    documents_pending`` + ``from/to``; whitelisted ``ordering``."""
    queryset = Registration.objects.all().prefetch_related('documents')
    serializer_class = RegistrationAdminListSerializer
    search_fields = (
        'child_first_name',
        'child_last_name',
        'child_curp',
        'parent1_name',
        'parent1_email',
        'parent2_email',
        'parent1_phone',
        'parent2_phone',
    )
    ordering = REGISTRATION_ORDERING
    default_ordering = '-created_at'
    filterset_class = RegistrationFilter


class RegistrationAdminListView(RegistrationListConfig, generics.ListAPIView):
    """GET-only twin (not routed) for the export sibling and bulk ``all_matching``."""


@method_decorator(ratelimit('admissions-submit', '5/m', method='POST'), name='dispatch')
class RegistrationListCreateView(RegistrationListConfig, generics.ListCreateAPIView):
    """POST /api/v1/admissions/register/ — Start a registration (no auth).
    GET — Admin-only paginated list for the Inscripciones console."""
    admin_area = 'admisiones'

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAdmin()]
        return [permissions.AllowAny()]

    def get_serializer_class(self):
        if self.request.method == 'GET':
            return RegistrationAdminListSerializer
        return RegistrationSerializer

    def create(self, request, *args, **kwargs):
        # «Permitir iniciar la ficha sin enlace» (Ajustes), off by default since
        # the ficha is private (2026-11-21): only the link the office sends once
        # the exam is «Aceptado» opens a ficha (that path never comes through here).
        if not _is_staff(request) and not ficha.public_start_enabled():
            return Response(error_body(PUBLIC_START_OFF, code='public_start_disabled'),
                            status=status.HTTP_403_FORBIDDEN)
        if 'contact_email' in request.data:
            return self._start_ficha(request)
        # The old /inscripcion wizard's payload (version-1 records; no screen sends it since Fase 2).
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        # Hand the one-time INVITE token back exactly once, in the body (never a
        # URL). It is exchanged (POST) for a session token to continue the flow.
        data = dict(serializer.data)
        data['invite_token'] = issue_invite(serializer.instance)
        return Response(data, status=status.HTTP_201_CREATED, headers=headers)

    def _start_ficha(self, request):
        """Step 0 «Antes de empezar»: lead + DRAFT ficha + session (continue now)
        + a single-use link by email (continue later) + the office notice."""
        reg, session, invite = ficha.start_ficha(request.data)
        url = invite_url_for(reg, invite)
        ficha.email_ficha_started(reg, url)
        ficha.notify_office_ficha_started(reg)
        return Response({
            'id': reg.id,
            'session_token': session,
            'session_expires_at': reg.session_expires_at,
            'status': reg.status,
            'cycle': reg.cycle,
            'pre_registration': reg.pre_registration_id,
            'ficha': ficha.ficha_payload(reg, is_staff=False, medical_ok=True),
        }, status=status.HTTP_201_CREATED)


# Re-applications accumulate per cycle and are never purged; a family only ever
# needs its recent ones on the portal card.
MY_REGISTRATIONS_LIMIT = 50


class MyRegistrationsView(APIView):
    """GET /api/v1/admissions/my-registrations/ — parent application status.

    Lists registrations linked to the authenticated user's email
    (``parent1_email`` or ``parent2_email``). Minimal status tracking for the
    parent portal — no medical fields, no session-token dance.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        email = (request.user.email or '').strip()
        if not email:
            return Response([])
        regs = (
            Registration.objects
            .filter(Q(parent1_email__iexact=email) | Q(parent2_email__iexact=email))
            .order_by('-updated_at')[:MY_REGISTRATIONS_LIMIT]
        )
        return Response(RegistrationParentStatusSerializer(regs, many=True).data)


class RegistrationStatusView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/v1/admissions/register/<pk>/status/: admin review action.

    GET returns ``{id, status, admin_notes}``: the review modal seeds «Notas
    internas» from it (the applicant-facing detail never carries them), so
    saving a decision no longer blanks the previous reviewer's notes.

    Moves a registration through review under the transition table shared
    with the bulk actions (``apps.core.transitions``): a reverse move needs
    ``note``; ``complete`` is reserved for the convert path. Records admin
    notes; every change is audited. On an approve/reject the applicant is
    emailed the outcome (fail-soft) unless ``notify`` is false.
    """
    admin_area = 'admisiones'
    queryset = Registration.objects.all()
    serializer_class = RegistrationStatusSerializer
    permission_classes = [IsAdmin]
    http_method_names = ['get', 'patch']

    def perform_update(self, serializer):
        reg = serializer.instance
        data = serializer.validated_data
        target = data.get('status', reg.status)
        note = str(self.request.data.get('note') or '').strip()
        notify = str(self.request.data.get('notify', True)).lower() not in ('0', 'false', 'no')
        changed = False
        if target != reg.status:
            change_status(reg, target, entity=REG_ENTITY, actor=self.request.user,
                          note=note, context='admissions: inscripción')
            changed = True
        if 'admin_notes' in data and data['admin_notes'] != reg.admin_notes:
            reg.admin_notes = data['admin_notes']
            reg.save(update_fields=['admin_notes', 'updated_at'])
            record('update', reg, {'admin_notes': 'editadas'}, actor=self.request.user,
                   context='admissions: inscripción')
        if changed and notify and reg.status in OUTCOME_STATES:
            email_registration_outcome(reg)


# The family's document list and the upload live in required_docs_views (Fase 4).


class DocumentsLinkView(APIView):
    """POST /api/v1/admissions/register/<pk>/documents-link/ — admin issues a
    fresh single-use link to the standalone documents page and emails it."""
    admin_area = 'admisiones'
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from .services import FichaPending, ensure_ficha_sent
        reg = get_object_or_404(Registration, pk=pk)
        try:
            ensure_ficha_sent(reg)
        except FichaPending as exc:
            return Response(error_body(exc.message, code=exc.code), status=status.HTTP_409_CONFLICT)
        raw = issue_invite(reg)
        url = f'{settings.FRONTEND_URL}/inscripcion/documentos?rid={reg.id}&token={raw}'
        from .pipeline import checklist

        # The documents of the student's level still missing or to correct (Fase 4).
        missing = checklist(reg)['missing']
        subject, content = documents_request_email(reg, url, missing)
        send_email(subject, '',
                   [reg.parent1_email], reply_to=settings.ADMISSIONS_EMAIL, content=content)
        return Response({'url': url, 'missing': missing})


class DocumentVerifyView(generics.UpdateAPIView):
    """PATCH /api/v1/admissions/documents/<pk>/verify/ — admin approves/rejects
    (with note) or clears verification. A rejection emails the family (fail-soft)."""
    admin_area = 'admisiones'
    queryset = RegistrationDocument.objects.all()
    serializer_class = DocumentVerifySerializer
    permission_classes = [IsAdmin]
    http_method_names = ['patch']

    def perform_update(self, serializer):
        before = serializer.instance.status
        doc = serializer.save()
        if doc.status != before:
            changes = {'status': [before, doc.status]}
            if doc.review_note:
                changes['note'] = doc.review_note
            record('update', doc, changes, actor=self.request.user, context='admissions: documento')
        if doc.status == RegistrationDocument.Review.REJECTED:
            email_rejected_documents(doc.registration, [doc])


class DocumentDownloadView(APIView):
    """GET /api/v1/admissions/documents/<pk>/download/ — stream an uploaded
    registration document to an authorized caller.

    Production serves no ``/media/`` path (Django serves it only under DEBUG,
    and Caddy proxies everything to gunicorn, which serves no static /media —
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
        except (FileNotFoundError, ValueError) as exc:
            logger.error(
                'Document download missing file doc=%s registration=%s: %s',
                doc.pk, doc.registration_id, exc,
            )
            raise Http404('Archivo no disponible.') from None
        return FileResponse(fh, as_attachment=True,
                            filename=doc.filename or 'documento')


# Invite tokens are the only thing standing between the public internet and a
# family's inscription draft: cap the guess rate per IP.
@method_decorator(ratelimit('registration-access', '10/m', key='ip', method='POST'), name='dispatch')
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
    header); staff (JWT) may access without it. PATCH is the old wizard's save
    and only edits version-1 records: a ficha (version 2) is saved section by
    section (``PATCH …/ficha/<section>/``), where its rules live.
    """
    serializer_class = RegistrationSerializer
    permission_classes = [permissions.AllowAny]
    queryset = Registration.objects.all()

    def get_object(self):
        return authorize_registration(self.request, self.kwargs['pk'])

    def update(self, request, *args, **kwargs):
        if self.get_object().ficha_version != Registration.FichaVersion.LEGACY:
            return Response(error_body(FICHA_BY_SECTIONS, code='ficha_by_sections'),
                            status=status.HTTP_409_CONFLICT)
        return super().update(request, *args, **kwargs)


@method_decorator(ratelimit('registration-submit', '10/m', key='ip', method='POST'), name='dispatch')
class RegistrationSubmitView(APIView):
    """POST /api/v1/admissions/register/<id>/submit/ — Submit for review."""
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        reg = authorize_registration(request, pk)

        if reg.status != Registration.Status.DRAFT:
            return Response(
                error_body('Esta inscripción ya fue enviada.'),
                status=status.HTTP_400_BAD_REQUEST)

        if reg.ficha_version == Registration.FichaVersion.FICHA:
            return self._submit_ficha(request, reg)

        # LFPDPPP (IK-LEGAL B2): Stage B requires acceptance of the current notice.
        if reg.privacy_accepted_at is None:
            from apps.legal.models import PrivacyNoticeVersion
            if not request.data.get('accept_privacy'):
                return Response(
                    error_body('Debe aceptar el Aviso de Privacidad para enviar la inscripción.'),
                    status=status.HTTP_400_BAD_REQUEST)
            reg.privacy_notice_version = PrivacyNoticeVersion.current()
            reg.privacy_accepted_at = timezone.now()
            reg.save(update_fields=['privacy_notice_version', 'privacy_accepted_at'])

        # Medical data may only be submitted with explicit MEDICAL_DATA consent.
        # Include estatura/peso — they are EncryptedTextField medical fields in
        # MEDICAL_FIELDS and must not bypass the consent gate.
        if ficha.has_medical_data(reg) and not reg.consent_medical_data:
            return Response(
                error_body('Se requiere consentimiento de datos de salud para enviar información médica.'),
                status=status.HTTP_400_BAD_REQUEST)

        reg.submit()
        subject, content = registration_received_email(reg)
        send_email(subject, '', [reg.parent1_email],
                   reply_to=settings.ADMISSIONS_EMAIL, content=content)
        return Response({'status': 'submitted', 'message': 'Inscripción enviada exitosamente.'})

    def _submit_ficha(self, request, reg):
        """The ficha: full required rules, privacy acceptance + typed signature
        (stored with the notice version, time and IP), the medical-consent gate.
        Documents are NOT required here: they have their own page."""
        problems, guardians = ficha.submit_problems(reg, request.data, is_staff=_is_staff(request))
        if problems:
            return Response(
                error_body('Faltan datos o hay datos por corregir en la ficha. '
                           'Revise las secciones marcadas.', code='incomplete', sections=problems),
                status=status.HTTP_400_BAD_REQUEST)
        if ficha.has_medical_data(reg) and not reg.consent_medical_data:
            return Response(
                error_body('Se requiere consentimiento de datos de salud para enviar información médica.'),
                status=status.HTTP_400_BAD_REQUEST)
        ficha.sign_and_submit(reg, request.data, guardians, request)
        ficha.email_ficha_submitted(reg)
        return Response({'status': 'submitted', 'message': 'Ficha de inscripción enviada.',
                         'submitted_at': reg.submitted_at})


class OpenSchoolDayListView(APIView):
    """GET /api/v1/admissions/open-school/ — upcoming open-class events.

    Backward-compatible route. Data now comes from the unified bookings model
    (``AvailabilitySlot`` with ``visit_type=open_class``); see
    BOOKING_CALENDAR_SPEC §4.2. The response keeps the public event shape
    (``id, date, title, location, spots_remaining, is_active``).
    """
    permission_classes = [permissions.AllowAny]

    # TTL-only public micro-cache (P7b) — same rationale as bookings
    # AvailabilityView: 1-query already, ≤60s staleness is capacity-safe.
    CACHE_KEY = 'admissions:open-school-list'
    CACHE_TTL = 60

    def get(self, request):
        from django.core.cache import cache

        data = cache.get(self.CACHE_KEY)
        if data is None:
            today = timezone.localdate()  # school-local day, not the UTC date
            now = timezone.now()
            slots = [
                s for s in AvailabilitySlot.annotate_booked(
                    AvailabilitySlot.objects.filter(
                        visit_type=VisitType.OPEN_CLASS, is_active=True, date__gte=today,
                    ).order_by('date', 'start_time'))
                if not s.is_full
                and timezone.make_aware(datetime.combine(s.date, s.start_time)) >= now
            ]
            data = OpenClassEventSerializer(slots, many=True).data
            cache.set(self.CACHE_KEY, data, self.CACHE_TTL)
        return Response(data)


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
