"""
Core API views: public contact form, health check + admin audit viewer.
"""
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit

from .audit import record
from .bulk import AdminBulkView, BulkAction, BulkSkip
from .exporting import AdminExportMixin
from .filters import (
    AUDIT_EXPORT_SPEC,
    AUDIT_ORDERING,
    AUDIT_SEARCH_FIELDS,
    CONTACT_EXPORT_SPEC,
    CONTACT_ORDERING,
    CONTACT_SEARCH_FIELDS,
    AuditLogFilterSet,
    ContactMessageFilterSet,
)
from .filtersets import parse_bool_param
from .listing import AdminListMixin
from .models import AuditLog, ContactMessage
from .serializers import AuditLogSerializer, ContactMessageAdminSerializer, ContactMessageSerializer


@method_decorator(ratelimit('contact', '5/m', method='POST'), name='dispatch')
class ContactCreateView(APIView):
    """POST /api/v1/contact/ — Save a public contact message and notify the school."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ContactMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = serializer.save()

        recipient = (getattr(settings, 'CONTACT_FORM_EMAIL', '') or settings.CONTACT_EMAIL
                     or settings.DEFAULT_FROM_EMAIL)
        # Reply-To is the visitor, so staff answer them with one click.
        # (lazy import: apps.portal.services imports from apps.core at module load)
        from apps.portal.services import send_email

        send_email(
            f'[Contacto web] {message.subject}',
            (
                f'Nombre: {message.name}\n'
                f'Correo: {message.email}\n\n'
                f'{message.message}'
            ),
            [recipient],
            reply_to=message.email,
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


class AdminAuditLogView(AdminListMixin, generics.ListAPIView):
    """GET /api/v1/core/admin/audit/ — read-only, paginated audit trail (admin).

    Data Ops list contract (Phase 7): ``?q=`` over actor label, context and
    object id; filters ``action``, ``actor`` (label/email contains),
    ``object_type`` + ``object_id`` (one record's history), ``context``
    (contains), ``from`` / ``to``; ordering ``date``, ``action``, ``actor``
    (actor email), ``object``, ``context`` with the ``-pk`` tiebreak.
    """
    serializer_class = AuditLogSerializer
    search_fields = AUDIT_SEARCH_FIELDS
    ordering = AUDIT_ORDERING
    default_ordering = '-created_at'
    filterset_class = AuditLogFilterSet

    def get_queryset(self):
        return AuditLog.objects.select_related('actor')


class PortalBadgesView(APIView):
    """GET /api/v1/core/badges/ — sidebar counters for the current user (BACKLOG P1-E3)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .badges import portal_badges

        return Response(portal_badges(request.user))


@method_decorator(ratelimit('facturacion', '5/m', method='POST'), name='dispatch')
class FacturacionRequestView(APIView):
    """POST /api/v1/facturacion/ — CFDI request form (BACKLOG P1-G6).

    Emails BILLING_EMAIL with the fiscal data (Reply-To the requester) and keeps
    a ContactMessage copy tagged [Facturación] so it shows up in the inbox.
    """
    permission_classes = [permissions.AllowAny]

    # Mismos 7 campos, todos obligatorios, que el formulario oficial del colegio
    # (interlaken.com.mx/index-7.html). Bitácora 13/10/2026, ref. 8.
    FIELDS = ('student', 'razon_social', 'rfc', 'cp', 'regimen', 'email', 'phone')
    REGIMENES = (
        'Régimen de sueldos y salarios e ingresos asimilados a salarios',
        'Régimen simplificado de confianza',
        'Régimen de las personas físicas con actividades empresariales y profesionales',
        'Régimen de incorporación fiscal',
        'Régimen general de ley personas morales',
        'Régimen simplificado de ley personas morales',
        'Régimen de pequeños contribuyentes',
        'Régimen de arrendamiento',
        'Régimen de enajenación o adquisición de bienes',
        'Régimen intermedio de las personas físicas con actividades empresariales',
        'Régimen simplificado de ley personas físicas',
        'Régimen de las actividades empresariales con ingresos a través de plataformas tecnológicas.',
    )

    def post(self, request):
        from apps.portal.services import send_email

        from .models import ContactMessage

        d = {k: str(request.data.get(k, '') or '').strip() for k in self.FIELDS}
        errors = {}
        for k in self.FIELDS:
            if not d[k]:
                errors[k] = ['Requerido.']
        if d['email'] and '@' not in d['email']:
            errors['email'] = ['Correo inválido.']
        if d['rfc'] and not (12 <= len(d['rfc']) <= 13):
            errors['rfc'] = ['El RFC debe tener 12 o 13 caracteres.']
        if d['cp'] and not (d['cp'].isdigit() and len(d['cp']) == 5):
            errors['cp'] = ['El código postal debe tener 5 dígitos.']
        if d['regimen'] and d['regimen'] not in self.REGIMENES:
            errors['regimen'] = ['Seleccione un régimen fiscal de la lista.']
        phone_digits = ''.join(ch for ch in d['phone'] if ch.isdigit())
        if d['phone'] and len(phone_digits) != 10:
            errors['phone'] = ['Escriba el teléfono a 10 dígitos: (00) 0000-0000.']
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        rfc = d['rfc'].upper()
        body = '\n'.join([
            f'Nombre del alumno: {d["student"]}',
            f'Razón social: {d["razon_social"]}',
            f'RFC: {rfc}',
            f'Código postal: {d["cp"]}',
            f'Régimen fiscal: {d["regimen"]}',
            f'Correo para enviar facturas: {d["email"]}',
            f'Teléfono de contacto: {d["phone"]}',
        ])
        ContactMessage.objects.create(
            name=d['razon_social'][:120], email=d['email'],
            subject=f'[Facturación] {rfc} · {d["student"]}'[:200], message=body)
        recipient = getattr(settings, 'BILLING_EMAIL', '') or settings.CONTACT_EMAIL or settings.DEFAULT_FROM_EMAIL
        send_email(f'[Facturación] Solicitud de factura: {d["razon_social"]}', body, [recipient],
                   reply_to=d['email'], html=False)
        send_email('Recibimos su solicitud de facturación - Colegio Interlaken',
                   f'Recibimos su solicitud de facturación para {d["razon_social"]} ({rfc}), '
                   f'alumno {d["student"]}.\n\n'
                   'A partir de ahora recibirá sus facturas cada mes, 24 horas hábiles después de '
                   'realizar sus pagos. Solo se emiten facturas del mes en curso y no es posible '
                   'cancelar ni cambiar facturas fuera del mes en que se realizó el pago.\n\n'
                   f'Si algún dato cambia, escríbanos a {recipient}.\n\nColegio Interlaken',
                   [d['email']], reply_to=recipient)
        return Response({'detail': 'Solicitud enviada.'}, status=status.HTTP_201_CREATED)


class ContactInboxView(AdminListMixin, generics.ListAPIView):
    """GET /api/v1/core/admin/contact-messages/ — website inbox (BACKLOG P1-G7).

    Data Ops list contract (Phase 7): ``?q=`` over name, email, subject and
    message; ``?handled=1|0``; ``from`` / ``to``; ordering ``date``, ``name``,
    ``email``, ``subject``, ``handled``.
    """
    serializer_class = ContactMessageAdminSerializer
    search_fields = CONTACT_SEARCH_FIELDS
    ordering = CONTACT_ORDERING
    default_ordering = '-created_at'
    filterset_class = ContactMessageFilterSet

    def get_queryset(self):
        return ContactMessage.objects.all()


class ContactInboxExportView(AdminExportMixin, ContactInboxView):
    """GET /api/v1/core/admin/contact-messages/export/?fmt=csv|xlsx|pdf (audited)."""
    export_spec = CONTACT_EXPORT_SPEC


class ContactMessageHandleView(APIView):
    """PATCH /api/v1/core/admin/contact-messages/<pk>/ {"is_handled": bool} (audited)."""
    permission_classes = [IsAdmin]

    def patch(self, request, pk):
        from django.shortcuts import get_object_or_404

        m = get_object_or_404(ContactMessage, pk=pk)
        handled = parse_bool_param(request.data.get('is_handled', True))
        if handled is None:
            handled = bool(request.data.get('is_handled'))
        if m.is_handled != handled:
            before = m.is_handled
            m.is_handled = handled
            m.save(update_fields=['is_handled'])
            record('update', m, {'is_handled': [before, handled]}, actor=request.user,
                   context='contact.handled')
        return Response(ContactMessageAdminSerializer(m).data)


def _handled_action(name: str, label_es: str, target: bool) -> BulkAction:
    """``mark_handled`` / ``reopen``: rows already in the target state are *omitidas*."""
    def check(message, payload):
        if message.is_handled == target:
            raise BulkSkip('ya está atendido' if target else 'ya está pendiente')

    def handler(message, payload, actor):
        check(message, payload)
        before = message.is_handled
        message.is_handled = target
        message.save(update_fields=['is_handled'])
        return {'is_handled': [before, target]}

    return BulkAction(name=name, label_es=label_es, handler=handler, plan=check, side_effects='none')


class ContactInboxBulkView(AdminBulkView):
    """POST /api/v1/core/admin/contact-messages/bulk/ — ``mark_handled`` / ``reopen`` (C5)."""
    entity = 'core.contactmessage'
    list_view_class = ContactInboxView
    actions = {
        a.name: a
        for a in (
            _handled_action('mark_handled', 'Marcar atendidos', True),
            _handled_action('reopen', 'Reabrir', False),
        )
    }


class AdminAuditExportView(AdminExportMixin, AdminAuditLogView):
    """GET /api/v1/core/admin/audit/export/?fmt=csv|xlsx|pdf — the filtered, sorted
    audit trail as a file (P1-H3 on the C3 export contract; audited itself)."""
    export_spec = AUDIT_EXPORT_SPEC
