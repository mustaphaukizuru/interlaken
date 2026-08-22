"""
Payments views: initiate a hosted-payment charge, process gateway webhooks, history.

Webhooks are authenticated per-gateway (HMAC-SHA256 over the raw body, Prompt 03),
idempotent (a webhook for an already-finalised payment is a no-op), and — for a
cafeteria top-up — credit the student's **local** ledger on success (spec R1: no
Loyverse write) and notify the parent. Failures mark everything failed and credit
nothing.
"""
import logging

from django.conf import settings
from django.db import transaction as db_transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit
from apps.core.throttling import SharedScopedRateThrottle

from .gateways import get_gateway, iter_gateways
from .gateways.base import WebhookEvent
from .models import Payment
from .serializers import PaymentInitiateSerializer, PaymentSerializer

logger = logging.getLogger(__name__)

# Historically treated as closed for webhooks. Soft-FAILED (expire/supersede/
# create_checkout) is special-cased in ``_apply_event`` so a late SUCCESS still
# credits; REFUNDED remains fully closed. SUCCESS accepts a later ``refunded``.
CLOSED_STATUSES = (Payment.Status.FAILED, Payment.Status.REFUNDED)


class PaymentInitiateView(APIView):
    """POST /api/v1/payments/initiate/ — fail-closed for unlinked money types.

    Every ``payment_type`` is rejected: cafeteria must go through the top-up
    flow (``POST /cafeteria/topup/``) so a SUCCESS webhook has a ledger to
    credit, and ``other`` would leave an orphan. The cafetería wallet is the
    only money path the app implements; the endpoint stays for a future
    linked fee type.
    """
    permission_classes = [permissions.IsAuthenticated]
    # Per-user (DRF throttles run after JWT auth): each initiate creates a
    # Payment row + a gateway checkout session, so bound it.
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = 'payment-initiate'

    def post(self, request):
        serializer = PaymentInitiateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        gateway = get_gateway(request.data.get('gateway'))
        payment = Payment.objects.create(
            user=request.user,
            payment_type=data['payment_type'],
            amount=data['amount'],
            description=data.get('description', ''),
            gateway=gateway.name,
            status=Payment.Status.PENDING,
        )

        try:
            hpp_url = gateway.create_checkout(payment)
        except Exception as exc:
            logger.exception(
                'create_checkout failed for payment=%s gateway=%s user=%s type=%s amount=%s',
                payment.id, gateway.name, request.user.pk, payment.payment_type, payment.amount,
            )
            payment.mark_failed(exc, stage='create_checkout')
            return self._checkout_failed(payment)

        if not hpp_url:
            logger.error(
                'create_checkout returned no URL for payment=%s gateway=%s',
                payment.id, gateway.name,
            )
            payment.mark_failed('gateway returned no checkout URL', stage='create_checkout')
            return self._checkout_failed(payment)

        return Response({
            'payment_id': payment.id,
            'amount': str(payment.amount),
            'status': payment.status,
            'gateway': payment.gateway,
            'hpp_url': hpp_url,
            'redirect_url': hpp_url,
            'detail': 'Pago registrado correctamente.',
        }, status=status.HTTP_201_CREATED)

    @staticmethod
    def _checkout_failed(payment):
        """Explicit, frontend-consumable error for a failed checkout creation."""
        return Response({
            'payment_id': payment.id,
            'status': payment.status,
            'detail': 'No se pudo iniciar el pago con el proveedor. Intenta de nuevo más tarde.',
        }, status=status.HTTP_502_BAD_GATEWAY)


class _WebhookProcessMixin:
    """Shared webhook processing: verify → (idempotently) apply → credit → notify."""

    def _apply_event(self, event):
        """Apply a verified ``WebhookEvent`` inside a locked, idempotent transaction.

        Returns ``(http_status, body, notify_arg)`` where ``notify_arg`` is
        ``(payment, success)`` when a top-up notification should be sent **after**
        commit, or ``None``.
        """
        from apps.cafeteria.services import (
            complete_online_topup,
            fail_online_topup,
            reverse_online_topup,
        )

        notify_arg = None
        with db_transaction.atomic():
            try:
                payment = (Payment.objects
                           .select_for_update()
                           .get(pk=event.payment_id))
            except (Payment.DoesNotExist, TypeError, ValueError):
                return status.HTTP_404_NOT_FOUND, {'error': 'payment_not_found'}, None

            # Refunded is fully closed. Gateway-DECLINED FAILED is closed too.
            # Soft-FAILED (expire/supersede/create_checkout) still accepts a late
            # SUCCESS so a parent who pays after local TTL/supersede is credited.
            if payment.status == Payment.Status.REFUNDED:
                return status.HTTP_200_OK, {'detail': 'already_processed'}, None
            if payment.status == Payment.Status.FAILED:
                if not (event.status == 'success' and payment.is_soft_failed()):
                    return status.HTTP_200_OK, {'detail': 'already_processed'}, None

            # Successful capture: only a later refund/chargeback may move money again.
            if payment.status == Payment.Status.SUCCESS:
                if event.status != 'refunded':
                    return status.HTTP_200_OK, {'detail': 'already_processed'}, None
                payment.gateway_raw = event.raw or payment.gateway_raw
                if event.transaction_id:
                    payment.gateway_tx_id = event.transaction_id
                payment.status = Payment.Status.REFUNDED
                payment.save(update_fields=[
                    'status', 'gateway_tx_id', 'gateway_raw', 'updated_at',
                ])
                reverse_online_topup(payment)
                return status.HTTP_200_OK, {'detail': 'refunded'}, None

            if event.status == 'success':
                payment.mark_success(event.transaction_id or payment.gateway_tx_id, event.raw)
                complete_online_topup(payment)     # None for non-cafeteria payments
                notify_arg = (payment, True)
            elif event.status == 'failed':
                payment.status = Payment.Status.FAILED
                if event.transaction_id:
                    payment.gateway_tx_id = event.transaction_id
                payment.gateway_raw = event.raw
                payment.save(update_fields=['status', 'gateway_tx_id', 'gateway_raw', 'updated_at'])
                fail_online_topup(payment)
                notify_arg = (payment, False)
            elif event.status == 'refunded':
                # Refund before capture is unusual — mark refunded, reverse no-ops.
                payment.status = Payment.Status.REFUNDED
                if event.transaction_id:
                    payment.gateway_tx_id = event.transaction_id
                payment.gateway_raw = event.raw
                payment.save(update_fields=['status', 'gateway_tx_id', 'gateway_raw', 'updated_at'])
                reverse_online_topup(payment)
            else:
                # Non-terminal notification (PENDING/PROCESSING): record raw only.
                payment.gateway_raw = event.raw
                if event.transaction_id:
                    payment.gateway_tx_id = event.transaction_id
                payment.save(update_fields=['gateway_tx_id', 'gateway_raw', 'updated_at'])

        return status.HTTP_200_OK, {'detail': 'ok'}, notify_arg

    def _process(self, request, gateways):
        """Verify the request against ``gateways`` and apply the first that matches."""
        from apps.core.audit import audit_context

        event = None
        for gateway in gateways:
            event = gateway.verify_webhook(request)
            if event is not None:
                break
        if event is None:
            return Response({'error': 'invalid_signature'},
                            status=status.HTTP_401_UNAUTHORIZED)

        # Automated money movement: attribute audit records to the gateway job.
        with audit_context(actor_label='system:webhook'):
            http_status, body, notify_arg = self._apply_event(event)

        # Email/notify outside the DB transaction (best-effort; never blocks the ack).
        if notify_arg is not None:
            payment, success = notify_arg
            if payment.payment_type == Payment.Type.CAFETERIA:
                from apps.cafeteria.services import notify_topup_result
                notify_topup_result(payment, success=success)

        return Response(body, status=http_status)


@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(ratelimit('payment-webhook', '120/m', key='ip', method='POST'), name='dispatch')
class PaymentWebhookView(_WebhookProcessMixin, APIView):
    """POST /api/v1/payments/webhook/ — generic endpoint (any configured gateway).

    Tries every registered gateway's signature until one verifies, so a single URL
    can serve both providers. Prefer the gateway-specific endpoints below when the
    provider lets you configure a distinct notification URL.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        return self._process(request, list(iter_gateways()))


@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(ratelimit('payment-webhook-gp', '120/m', key='ip', method='POST'), name='dispatch')
class GlobalPaymentsWebhookView(_WebhookProcessMixin, APIView):
    """POST /api/v1/payments/webhook/global-payments/"""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        return self._process(request, [get_gateway('global_payments')])


@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(ratelimit('payment-webhook-banorte', '120/m', key='ip', method='POST'), name='dispatch')
class BanorteWebhookView(_WebhookProcessMixin, APIView):
    """POST /api/v1/payments/webhook/banorte/"""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        return self._process(request, [get_gateway('banorte')])


def _sandbox_payments_enabled() -> bool:
    """Sandbox payment completion is DEV-ONLY (DEBUG or SQLITE_LOCAL). In
    production the real gateway webhook settles payments and this is disabled."""
    import os

    from django.conf import settings
    return bool(settings.DEBUG or os.getenv('SQLITE_LOCAL'))


@method_decorator(csrf_exempt, name='dispatch')
class SandboxCompleteView(_WebhookProcessMixin, APIView):
    """POST /api/v1/payments/sandbox/complete/ — DEV-ONLY.

    Lets the mock hosted-payment page finish the flow end-to-end without a live
    gateway. Reuses the EXACT webhook completion path (mark success/fail, credit
    the cafeteria ledger, notify the family) — only the
    HMAC signature check is skipped — so sandbox behaviour matches production.
    Returns 404 unless DEBUG/SQLITE_LOCAL.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        if not _sandbox_payments_enabled():
            return Response({'error': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        order_id = request.data.get('order_id')
        result = 'success' if request.data.get('result', 'success') == 'success' else 'failed'
        event = WebhookEvent(
            payment_id=order_id, status=result,
            transaction_id=f'SANDBOX-{order_id}',
            raw={'sandbox': True, 'result': result},
        )

        from apps.core.audit import audit_context
        with audit_context(actor_label='system:sandbox'):
            http_status, body, notify_arg = self._apply_event(event)

        if notify_arg is not None:
            payment, success = notify_arg
            if payment.payment_type == Payment.Type.CAFETERIA:
                from apps.cafeteria.services import notify_topup_result
                notify_topup_result(payment, success=success)
        return Response(body, status=http_status)


class PaymentDetailView(generics.RetrieveAPIView):
    """GET /api/v1/payments/<pk>/ — family-scoped (return-page polling)."""
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        from .services import payments_visible_to
        return payments_visible_to(self.request.user)


def _filtered_history(request):
    """Family-scoped payments with the Pagos page filters (BACKLOG P1-D3).

    ?status=  ?student=<profile id>  ?from=YYYY-MM-DD  ?to=YYYY-MM-DD
    """
    from django.utils.dateparse import parse_date

    from .services import payments_visible_to

    qs = payments_visible_to(request.user).select_related('related_topup__student__user')
    p = request.query_params
    if p.get('status') in Payment.Status.values:
        qs = qs.filter(status=p['status'])
    if p.get('student', '').isdigit():
        qs = qs.filter(related_topup__student_id=int(p['student']))
    d = parse_date(p.get('from', '') or '')
    if d:
        qs = qs.filter(created_at__date__gte=d)
    d = parse_date(p.get('to', '') or '')
    if d:
        qs = qs.filter(created_at__date__lte=d)
    return qs.order_by('-created_at')


class PaymentHistoryView(generics.ListAPIView):
    """GET /api/v1/payments/history/ — family-scoped, filterable payment history."""
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return _filtered_history(self.request)


class PaymentSummaryView(APIView):
    """GET /api/v1/payments/summary/ — header tiles for the Pagos page (P1-D2):
    month total, last successful top-up, pending count, per-child totals."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from django.db.models import Count, Sum
        from django.utils import timezone

        from .services import payments_visible_to

        qs = payments_visible_to(request.user)
        now = timezone.localtime()
        month = qs.filter(status=Payment.Status.SUCCESS, created_at__year=now.year, created_at__month=now.month)
        last = qs.filter(status=Payment.Status.SUCCESS).order_by('-created_at').first()
        per_child = (qs.filter(status=Payment.Status.SUCCESS, related_topup__isnull=False)
                     .values('related_topup__student_id', 'related_topup__student__user__first_name',
                             'related_topup__student__user__last_name')
                     .annotate(total=Sum('amount'), count=Count('id')).order_by('-total'))
        return Response({
            'month_total': str(month.aggregate(t=Sum('amount'))['t'] or 0),
            'month_count': month.count(),
            'pending_count': qs.filter(status__in=[Payment.Status.PENDING, Payment.Status.PROCESSING]).count(),
            'last_success': PaymentSerializer(last).data if last else None,
            'per_child': [
                {'student_id': r['related_topup__student_id'],
                 'name': f"{r['related_topup__student__user__first_name']} {r['related_topup__student__user__last_name']}".strip(),
                 'total': str(r['total']), 'count': r['count']} for r in per_child],
        })


class PaymentHistoryExportView(APIView):
    """GET /api/v1/payments/history/export/ — CSV of the filtered family history (P1-D5)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        import csv

        from django.http import HttpResponse

        from apps.core.exports import as_download, export_filename, fmt_dt

        resp = HttpResponse(content_type='text/csv; charset=utf-8')
        resp.write('\ufeff')
        w = csv.writer(resp)
        w.writerow(['Fecha', 'Alumno', 'Concepto', 'Monto', 'Moneda', 'Estado', 'Pasarela', 'Referencia'])
        for p in _filtered_history(request)[:5000]:
            topup = p.related_topup
            w.writerow([fmt_dt(p.created_at), topup.student.user.full_name if topup else '',
                        p.description or p.get_payment_type_display(), p.amount, p.currency,
                        p.get_status_display(), p.get_gateway_display(), p.gateway_tx_id or p.gateway_ref])
        return as_download(resp, export_filename('pagos'))


class AdminPaymentsView(generics.ListAPIView):
    """GET /api/v1/payments/admin/ — every gateway payment, filterable (BACKLOG P1-D9).

    Same filters as the family history plus ?gateway= and ?q= (student name,
    payer email, gateway reference). Refunds live in the cafetería console;
    cash top-ups are approved there too, so this page is the ledger view.
    """
    serializer_class = PaymentSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        from django.db.models import Q

        qs = _filtered_history(self.request)
        p = self.request.query_params
        if p.get('gateway') in Payment.Gateway.values:
            qs = qs.filter(gateway=p['gateway'])
        q = (p.get('q') or '').strip()
        if q:
            qs = qs.filter(
                Q(related_topup__student__user__first_name__icontains=q)
                | Q(related_topup__student__user__last_name__icontains=q)
                | Q(related_topup__student__student_id__icontains=q)
                | Q(user__email__icontains=q)
                | Q(gateway_tx_id__icontains=q)
                | Q(gateway_ref__icontains=q))
        return qs


class AdminPaymentsSummaryView(APIView):
    """GET /api/v1/payments/admin/summary/?days=30 — totals by status and per-day series."""
    permission_classes = [IsAdmin]

    def get(self, request):
        from datetime import timedelta

        from django.db.models import Count, Sum
        from django.db.models.functions import TruncDate
        from django.utils import timezone

        try:
            days = max(7, min(int(request.query_params.get('days', 30)), 365))
        except ValueError:
            days = 30
        since = timezone.localdate() - timedelta(days=days - 1)
        qs = Payment.objects.filter(created_at__date__gte=since)
        by_status = {
            r['status']: {'count': r['c'], 'total': str(r['t'] or 0)}
            for r in qs.values('status').annotate(c=Count('id'), t=Sum('amount'))
        }
        series = [
            {'date': r['d'].isoformat(), 'total': str(r['t'] or 0), 'count': r['c']}
            for r in (qs.filter(status=Payment.Status.SUCCESS).annotate(d=TruncDate('created_at'))
                      .values('d').annotate(t=Sum('amount'), c=Count('id')).order_by('d'))
        ]
        return Response({'days': days, 'since': since.isoformat(), 'by_status': by_status, 'series': series,
                         'stuck_pending': Payment.objects.filter(
                             status__in=[Payment.Status.PENDING, Payment.Status.PROCESSING],
                             created_at__lt=timezone.now() - timedelta(hours=24)).count()})


class PaymentReceiptView(APIView):
    """GET /api/v1/payments/<pk>/receipt/ — comprobante PDF of a successful or refunded
    payment (BACKLOG P1-D4). Family-scoped like the detail view; admins may fetch any."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        from django.http import HttpResponse
        from django.shortcuts import get_object_or_404

        from apps.core.exports import as_download, fmt_dt
        from apps.core.pdf import simple_document_pdf

        from .services import payments_visible_to

        p = get_object_or_404(payments_visible_to(request.user).select_related(
            'user', 'related_topup__student__user'), pk=pk)
        if p.status not in (Payment.Status.SUCCESS, Payment.Status.REFUNDED):
            return Response({'detail': 'Solo los pagos completados tienen comprobante.'}, status=409)
        topup = p.related_topup
        student = topup.student.user.full_name if topup else ''
        lines = [
            f'Folio: {p.id}',
            f'Fecha: {fmt_dt(p.created_at)}',
            f'Estado: {p.get_status_display()}',
            '',
            f'Concepto: {p.description or p.get_payment_type_display()}',
            f'Alumno: {student or "-"}',
            f'Pagó: {p.user.full_name if p.user else "-"} ({p.user.email if p.user else "-"})',
            '',
            f'Monto: ${p.amount} {p.currency}',
            f'Pasarela: {p.get_gateway_display()}',
            f'Referencia: {p.gateway_tx_id or p.gateway_ref or "-"}',
            '',
            'Este comprobante acredita una recarga de saldo de cafetería. No es un CFDI;',
            f'para facturación escriba a {getattr(settings, "BILLING_EMAIL", "")}.',
        ]
        pdf = simple_document_pdf('Comprobante de pago - Colegio Interlaken', lines,
                                  subtitle='Portal de Familias')
        resp = HttpResponse(pdf, content_type='application/pdf')
        return as_download(resp, f'comprobante_{p.id}.pdf')
