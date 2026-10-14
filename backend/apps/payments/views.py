"""
Payments views: Banorte checkout results, staff verification, history.

Money only moves through ``payments.settlement`` (locked, idempotent). The
Banorte result arrives from the parent's browser, so the endpoint decides on
the server-side decryption of Banorte's ``data`` only (see
``gateways.banorte.interpret_result``) and a credited approval stays
*unverified* until staff match it in MultiCobros.
"""
import logging

from django.conf import settings
from django.db import transaction as db_transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import error_body
from apps.core.exporting import AdminExportMixin
from apps.core.listing import AdminListMixin, apply_date_range, day_start
from apps.core.matricula import search_key
from apps.core.ordering import apply_ordering
from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit
from apps.core.throttling import SharedScopedRateThrottle

from .filters import (
    ADMIN_PAYMENT_ORDERING,
    ADMIN_PAYMENT_SEARCH_FIELDS,
    PAYMENT_EXPORT_SPEC,
    AdminPaymentFilterSet,
)
from .gateways.banorte import interpret_result
from .gateways.base import PaymentEvent
from .models import BanorteCheckout, Payment
from .serializers import PaymentInitiateSerializer, PaymentSerializer
from .settlement import settle

logger = logging.getLogger(__name__)


class PaymentInitiateView(APIView):
    """POST /api/v1/payments/initiate/ — fail-closed for unlinked money types.

    Every ``payment_type`` is rejected: cafeteria must go through the top-up
    flow (``POST /cafeteria/topup/``) so an approval has a ledger to credit,
    and ``other`` would leave an orphan. The endpoint stays (throttled) for a
    future linked fee type.
    """
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = 'payment-initiate'

    def post(self, request):
        serializer = PaymentInitiateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        return Response(error_body('Use la recarga de cafetería desde el portal familiar.'),
                        status=status.HTTP_400_BAD_REQUEST)


BANORTE_EVENTS = frozenset({'success', 'error', 'cancel', 'closed'})


@method_decorator(ratelimit('banorte-result', '30/m', key='ip', method='POST'), name='dispatch')
class BanorteResultView(APIView):
    """POST /api/v1/payments/banorte/result/ ``{payment_id, event, response}``

    The lightbox callbacks (``onSuccess``/``onError``/``onCancel``/``onClosed``)
    forward Banorte's raw response here. Only the payer's family (or an admin)
    may report on a payment. The decrypted Payworks result decides; anything
    that does not decrypt and match leaves the payment open for staff review.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .services import payments_visible_to

        event_name = str(request.data.get('event', '')).lower()
        if event_name not in BANORTE_EVENTS:
            return Response(error_body('Evento no válido.', code='invalid_event'), status=400)
        response = request.data.get('response') or {}
        if not isinstance(response, dict):
            return Response(error_body('Respuesta no válida.', code='invalid_response'), status=400)

        payment_id = str(request.data.get('payment_id', ''))
        payment = None
        if payment_id.isdigit():
            payment = (payments_visible_to(request.user)
                       .filter(pk=int(payment_id), gateway=Payment.Gateway.BANORTE).first())
        if payment is None:
            return Response(error_body('Pago no encontrado.', code='payment_not_found'), status=404)

        with db_transaction.atomic():
            checkout = (BanorteCheckout.objects.select_for_update()
                        .filter(payment=payment).first())
            if checkout is None:
                return Response(error_body('Pago no encontrado.', code='payment_not_found'),
                                status=404)
            outcome = interpret_result(checkout, event_name, response)
            for name, value in outcome.fields.items():
                setattr(checkout, name, value)
            if outcome.event.status != 'pending':
                checkout.result_at = timezone.now()
            checkout.save()

        if outcome.anomaly:
            logger.warning('banorte result not trusted payment=%s control=%s user=%s: %s',
                           payment.pk, checkout.control_number, request.user.pk, outcome.anomaly)

        http_status, body = settle(outcome.event, actor_label='system:banorte')

        payment.refresh_from_db()
        if payment.status in (Payment.Status.SUCCESS, Payment.Status.REFUNDED) or (
                payment.status == Payment.Status.FAILED and not payment.is_soft_failed()):
            # Final: the AES key is no longer needed. Soft failures keep it so a
            # late approval for the same control number can still be decrypted.
            BanorteCheckout.objects.filter(pk=checkout.pk).update(key_material='')

        return Response({'payment_id': payment.pk, 'status': payment.status,
                         'detail': body.get('detail', '')}, status=http_status)


class AdminBanorteVerifyView(APIView):
    """POST /api/v1/payments/admin/<pk>/banorte-verify/

    Staff confirm that the approved operation appears in MultiCobros (same
    número de control, referencia and amount). Required before an online
    top-up may be marked as loaded into the POS.
    """
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from django.shortcuts import get_object_or_404

        from apps.core.audit import record

        checkout = get_object_or_404(BanorteCheckout.objects.select_related('payment'),
                                     payment_id=pk)
        if checkout.resultado_payw != BanorteCheckout.Result.APPROVED:
            return Response(error_body('Solo se verifican operaciones aprobadas.'), status=400)
        if checkout.verified_at is None:
            checkout.verified_at = timezone.now()
            checkout.verified_by = request.user
            checkout.save(update_fields=['verified_at', 'verified_by'])
            record('update', checkout.payment,
                   {'banorte_verified': True, 'referencia': checkout.referencia},
                   actor=request.user, context='payments.banorte.verify')
        return Response({
            'payment_id': pk,
            'verified_at': checkout.verified_at,
            'verified_by_name': checkout.verified_by.full_name if checkout.verified_by_id else '',
        })


def _sandbox_payments_enabled() -> bool:
    """Sandbox payment completion is DEV-ONLY (DEBUG or SQLITE_LOCAL)."""
    import os

    return bool(settings.DEBUG or os.getenv('SQLITE_LOCAL'))


@method_decorator(csrf_exempt, name='dispatch')
class SandboxCompleteView(APIView):
    """POST /api/v1/payments/sandbox/complete/ — DEV-ONLY.

    Lets the mock checkout page (``/pago/simulado``, used when no Banorte
    credentials are configured) finish the flow through the EXACT settlement
    path production uses. Returns 404 unless DEBUG/SQLITE_LOCAL.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        if not _sandbox_payments_enabled():
            return Response(error_body('No encontrado.', code='not_found'),
                            status=status.HTTP_404_NOT_FOUND)

        order_id = request.data.get('order_id')
        result = 'success' if request.data.get('result', 'success') == 'success' else 'failed'
        event = PaymentEvent(
            payment_id=order_id, status=result,
            transaction_id=f'SANDBOX-{order_id}',
            raw={'sandbox': True, 'result': result},
        )
        http_status, body = settle(event, actor_label='system:sandbox')
        return Response(body, status=http_status)


class PaymentDetailView(generics.RetrieveAPIView):
    """GET /api/v1/payments/<pk>/ — family-scoped (return-page polling)."""
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        from .services import payments_visible_to
        return payments_visible_to(self.request.user)


# Columns the pagos tables can sort by (public key → ORM field).
PAYMENT_ORDERING = {
    'date': 'created_at',
    'amount': 'amount',
    'status': 'status',
    'gateway': 'gateway',
}


def _filtered_history(request):
    """Family-scoped payments with the Pagos page filters (BACKLOG P1-D3).

    ?status=  ?student=<profile id>  ?from=YYYY-MM-DD  ?to=YYYY-MM-DD
    """
    from .services import payments_visible_to

    qs = payments_visible_to(request.user).select_related('related_topup__student__user')
    p = request.query_params
    if p.get('status') in Payment.Status.values:
        qs = qs.filter(status=p['status'])
    if p.get('student', '').isdigit():
        qs = qs.filter(related_topup__student_id=int(p['student']))
    # Aware bounds (invalid dates ignored) so the created_at index is usable.
    qs = apply_date_range(qs, 'created_at', p.get('from'), p.get('to'))
    return apply_ordering(qs, request, PAYMENT_ORDERING, '-created_at')


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


class PaymentHistoryExportView(PaymentHistoryView):
    """GET /api/v1/payments/history/export/?fmt=csv|xlsx&status=&student=&from=&to=&ordering=

    The filtered family history (P1-D5) as a file. Subclasses the list so the
    family scoping, filters and ordering are shared (Data Ops Phase 9); capped
    at 10,000 rows (413 above; it used to truncate silently at 5,000),
    throttled under ``portal-export`` and audited with ``record_export``.
    """
    pagination_class = None
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = 'portal-export'

    def list(self, request, *args, **kwargs):
        from apps.core.exporting import export_response

        from .portal_exports import FAMILY_EXPORT_FORMATS, FAMILY_PAYMENTS_EXPORT_SPEC

        return export_response(request, self.filter_queryset(self.get_queryset()),
                               FAMILY_PAYMENTS_EXPORT_SPEC, formats=FAMILY_EXPORT_FORMATS,
                               context='portal')


class AdminPaymentsView(AdminListMixin, generics.ListAPIView):
    """GET /api/v1/payments/admin/ — every gateway payment (BACKLOG P1-D9), on the
    Data Ops list contract (Phase 7).

    ``?q=`` student name / matrícula (``ci09932`` too), payer email or name,
    gateway references, description; filters ``status``, ``gateway``, ``type``,
    ``student``, ``from``/``to``; ordering ``date``, ``amount``, ``status``,
    ``gateway``, ``student`` (``-pk`` tiebreak); ``page_size`` up to 100.
    Refunds live in the cafetería console and payment state belongs to the
    gateway webhook, so this page is the read-only ledger view.
    """
    serializer_class = PaymentSerializer
    search_fields = ADMIN_PAYMENT_SEARCH_FIELDS
    ordering = ADMIN_PAYMENT_ORDERING
    default_ordering = '-created_at'
    filterset_class = AdminPaymentFilterSet
    normalize_search_term = staticmethod(search_key)

    def get_queryset(self):
        return Payment.objects.select_related('user', 'related_topup__student__user')


class AdminPaymentsExportView(AdminExportMixin, AdminPaymentsView):
    """GET /api/v1/payments/admin/export/?fmt=csv|xlsx|pdf — the ledger view as a file.

    Same filters, ``q`` and ``ordering`` as the list (subclass, never
    duplicated), ``?ids=`` for the selected rows, audited via ``record_export``.
    """
    export_spec = PAYMENT_EXPORT_SPEC


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
        qs = Payment.objects.filter(created_at__gte=day_start(since))
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
