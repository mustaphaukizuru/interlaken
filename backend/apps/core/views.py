"""
Core API views: public contact form, health check + admin audit viewer.
"""
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin
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

        recipient = settings.CONTACT_EMAIL or settings.DEFAULT_FROM_EMAIL
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


class AdminAuditLogView(generics.ListAPIView):
    """GET /api/v1/core/admin/audit/ — read-only, paginated audit trail (admin).

    Filters: ``actor`` (label/email icontains), ``action`` (choice),
    ``context`` (icontains — semantic category, e.g. ``finance.mark_paid``),
    ``object_type`` + ``object_id`` (target filter, e.g. one invoice's history),
    ``from`` / ``to`` (ISO dates, inclusive). Newest first.
    """
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdmin]

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

    FIELDS = ('name', 'email', 'phone', 'student', 'rfc', 'razon_social', 'regimen', 'cp',
              'uso_cfdi', 'concepto', 'monto', 'fecha_pago', 'referencia', 'notes')

    def post(self, request):
        from apps.portal.services import send_email

        from .models import ContactMessage

        d = {k: str(request.data.get(k, '') or '').strip() for k in self.FIELDS}
        errors = {}
        for k in ('name', 'email', 'rfc', 'razon_social', 'cp', 'concepto', 'monto', 'fecha_pago'):
            if not d[k]:
                errors[k] = ['Requerido.']
        if d['email'] and '@' not in d['email']:
            errors['email'] = ['Correo inválido.']
        if d['rfc'] and not (12 <= len(d['rfc']) <= 13):
            errors['rfc'] = ['El RFC debe tener 12 o 13 caracteres.']
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        body = '\n'.join([
            f'Solicitante: {d["name"]} <{d["email"]}> {d["phone"]}'.rstrip(),
            f'Alumno: {d["student"] or "-"}',
            '',
            f'RFC: {d["rfc"].upper()}',
            f'Razón social: {d["razon_social"]}',
            f'Régimen fiscal: {d["regimen"] or "-"}',
            f'Código postal: {d["cp"]}',
            f'Uso de CFDI: {d["uso_cfdi"] or "-"}',
            '',
            f'Concepto: {d["concepto"]}',
            f'Monto: {d["monto"]}',
            f'Fecha de pago: {d["fecha_pago"]}',
            f'Referencia / comprobante: {d["referencia"] or "-"}',
            '',
            f'Notas: {d["notes"] or "-"}',
        ])
        ContactMessage.objects.create(
            name=d['name'], email=d['email'],
            subject=f'[Facturación] {d["rfc"].upper()} · {d["concepto"]}'[:200], message=body)
        recipient = getattr(settings, 'BILLING_EMAIL', '') or settings.CONTACT_EMAIL or settings.DEFAULT_FROM_EMAIL
        send_email(f'[Facturación] Solicitud de CFDI: {d["razon_social"]}', body, [recipient],
                   reply_to=d['email'], html=False)
        send_email('Recibimos su solicitud de factura - Colegio Interlaken',
                   f'Hola {d["name"]},\n\nRecibimos su solicitud de CFDI para {d["razon_social"]} '
                   f'({d["rfc"].upper()}). Recuerde que las facturas solo se emiten dentro del mes del pago.\n\n'
                   f'Le responderemos desde {recipient}.\n\nColegio Interlaken',
                   [d['email']], reply_to=recipient)
        return Response({'detail': 'Solicitud enviada.'}, status=status.HTTP_201_CREATED)


class ContactInboxView(generics.ListAPIView):
    """GET /api/v1/core/admin/contact-messages/?handled=0 — website inbox (BACKLOG P1-G7)."""
    serializer_class = None
    permission_classes = [IsAdmin]

    def get_serializer_class(self):
        from .serializers import ContactMessageAdminSerializer
        return ContactMessageAdminSerializer

    def get_queryset(self):
        from .models import ContactMessage

        qs = ContactMessage.objects.all()
        handled = self.request.query_params.get('handled')
        if handled in ('0', 'false'):
            qs = qs.filter(is_handled=False)
        elif handled in ('1', 'true'):
            qs = qs.filter(is_handled=True)
        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(email__icontains=q) | Q(subject__icontains=q))
        return qs.order_by('-created_at')


class ContactMessageHandleView(APIView):
    """PATCH /api/v1/core/admin/contact-messages/<pk>/ {"is_handled": bool}"""
    permission_classes = [IsAdmin]

    def patch(self, request, pk):
        from django.shortcuts import get_object_or_404

        from .models import ContactMessage
        from .serializers import ContactMessageAdminSerializer

        m = get_object_or_404(ContactMessage, pk=pk)
        m.is_handled = bool(request.data.get('is_handled', True))
        m.save(update_fields=['is_handled'])
        return Response(ContactMessageAdminSerializer(m).data)


class AdminAuditExportView(AdminAuditLogView):
    """GET /api/v1/core/admin/audit/export/ — CSV of the filtered audit trail (P1-H3)."""

    def list(self, request, *args, **kwargs):
        import csv
        import json

        from django.http import HttpResponse

        from apps.core.exports import as_download, export_filename, fmt_dt

        resp = HttpResponse(content_type='text/csv; charset=utf-8')
        resp.write('﻿')
        w = csv.writer(resp)
        w.writerow(['Fecha', 'Actor', 'Acción', 'Objeto', 'ID', 'Contexto', 'Cambios'])
        for a in self.get_queryset()[:10000]:
            w.writerow([fmt_dt(a.created_at), a.actor_label or (a.actor.email if a.actor else ''), a.action,
                        a.object_type, a.object_id, a.context, json.dumps(a.changes, ensure_ascii=False)[:2000]])
        return as_download(resp, export_filename('auditoria'))
