"""
Payments views: initiate a hosted-payment charge, process gateway webhooks, history.

Webhooks are authenticated per-gateway (HMAC-SHA256 over the raw body, Prompt 03),
idempotent (a webhook for an already-finalised payment is a no-op), and — for a
cafeteria top-up — credit the student's **local** ledger on success (spec R1: no
Loyverse write) and notify the parent. Failures mark everything failed and credit
nothing.
"""
import logging

from django.db import transaction as db_transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.ratelimit import ratelimit

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

    All current ``payment_type`` values are rejected: tuition/cafeteria must use
    invoice-pay / cafeteria top-up; enrollment has no Registration fee link yet;
    ``other`` would leave a SUCCESS webhook with nothing to credit. Keep the
    endpoint for a future linked fee type.
    """
    permission_classes = [permissions.IsAuthenticated]

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
        from apps.finance.services import (
            complete_invoice_payment,
            fail_invoice_payment,
            reverse_invoice_payment,
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
                reverse_invoice_payment(payment)
                return status.HTTP_200_OK, {'detail': 'refunded'}, None

            if event.status == 'success':
                payment.mark_success(event.transaction_id or payment.gateway_tx_id, event.raw)
                complete_online_topup(payment)     # None for non-cafeteria payments
                complete_invoice_payment(payment)  # None for non-tuition payments
                notify_arg = (payment, True)
            elif event.status == 'failed':
                payment.status = Payment.Status.FAILED
                if event.transaction_id:
                    payment.gateway_tx_id = event.transaction_id
                payment.gateway_raw = event.raw
                payment.save(update_fields=['status', 'gateway_tx_id', 'gateway_raw', 'updated_at'])
                fail_online_topup(payment)
                fail_invoice_payment(payment)
                notify_arg = (payment, False)
            elif event.status == 'refunded':
                # Refund before capture is unusual — mark refunded, reverse no-ops.
                payment.status = Payment.Status.REFUNDED
                if event.transaction_id:
                    payment.gateway_tx_id = event.transaction_id
                payment.gateway_raw = event.raw
                payment.save(update_fields=['status', 'gateway_tx_id', 'gateway_raw', 'updated_at'])
                reverse_online_topup(payment)
                reverse_invoice_payment(payment)
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
            elif payment.payment_type == Payment.Type.TUITION:
                from apps.finance.services import notify_invoice_result
                notify_invoice_result(payment, success=success)

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
    the cafeteria ledger / mark the invoice paid, notify the family) — only the
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
            elif payment.payment_type == Payment.Type.TUITION:
                from apps.finance.services import notify_invoice_result
                notify_invoice_result(payment, success=success)
        return Response(body, status=http_status)


class PaymentDetailView(generics.RetrieveAPIView):
    """GET /api/v1/payments/<pk>/ — family-scoped (return-page polling)."""
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        from .services import payments_visible_to
        return payments_visible_to(self.request.user)


class PaymentHistoryView(generics.ListAPIView):
    """GET /api/v1/payments/history/ — family-scoped payment history."""
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        from .services import payments_visible_to
        return payments_visible_to(self.request.user).order_by('-created_at')
