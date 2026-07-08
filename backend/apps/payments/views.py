"""
Payments views: initiate a hosted-payment charge, process gateway webhooks, history.

Webhooks are authenticated per-gateway (HMAC-SHA256 over the raw body, Prompt 03),
idempotent (a webhook for an already-finalised payment is a no-op), and — for a
cafeteria top-up — credit the student's **local** ledger on success (spec R1: no
Loyverse write) and notify the parent. Failures mark everything failed and credit
nothing.
"""
from django.db import transaction as db_transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.ratelimit import ratelimit

from .gateways import get_gateway, iter_gateways
from .models import Payment
from .serializers import PaymentInitiateSerializer, PaymentSerializer

# Statuses that are terminal — a webhook that arrives for one of these is a
# duplicate/replay and must be a no-op (idempotency).
FINAL_STATUSES = (Payment.Status.SUCCESS, Payment.Status.FAILED, Payment.Status.REFUNDED)


class PaymentInitiateView(APIView):
    """POST /api/v1/payments/initiate/ — create a pending payment + hosted-page URL."""
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
        except Exception:  # pragma: no cover - defensive; keep the record either way
            hpp_url = None

        return Response({
            'payment_id': payment.id,
            'amount': str(payment.amount),
            'status': payment.status,
            'gateway': payment.gateway,
            'hpp_url': hpp_url,
            'redirect_url': hpp_url,
            'detail': 'Pago registrado correctamente.',
        }, status=status.HTTP_201_CREATED)


class _WebhookProcessMixin:
    """Shared webhook processing: verify → (idempotently) apply → credit → notify."""

    def _apply_event(self, event):
        """Apply a verified ``WebhookEvent`` inside a locked, idempotent transaction.

        Returns ``(http_status, body, notify_arg)`` where ``notify_arg`` is
        ``(payment, success)`` when a top-up notification should be sent **after**
        commit, or ``None``.
        """
        from apps.cafeteria.services import (complete_online_topup,
                                             fail_online_topup)

        notify_arg = None
        with db_transaction.atomic():
            try:
                payment = (Payment.objects
                           .select_for_update()
                           .get(pk=event.payment_id))
            except (Payment.DoesNotExist, TypeError, ValueError):
                return status.HTTP_404_NOT_FOUND, {'error': 'payment_not_found'}, None

            # Idempotency: never re-process a payment already in a final state.
            if payment.status in FINAL_STATUSES:
                return status.HTTP_200_OK, {'detail': 'already_processed'}, None

            if event.status == 'success':
                payment.mark_success(event.transaction_id or payment.gateway_tx_id, event.raw)
                complete_online_topup(payment)  # None for non-cafeteria payments
                notify_arg = (payment, True)
            elif event.status == 'failed':
                payment.status = Payment.Status.FAILED
                if event.transaction_id:
                    payment.gateway_tx_id = event.transaction_id
                payment.gateway_raw = event.raw
                payment.save(update_fields=['status', 'gateway_tx_id', 'gateway_raw', 'updated_at'])
                fail_online_topup(payment)
                notify_arg = (payment, False)
            else:
                # Non-terminal notification (PENDING/PROCESSING): record raw only.
                payment.gateway_raw = event.raw
                if event.transaction_id:
                    payment.gateway_tx_id = event.transaction_id
                payment.save(update_fields=['gateway_tx_id', 'gateway_raw', 'updated_at'])

        return status.HTTP_200_OK, {'detail': 'ok'}, notify_arg

    def _process(self, request, gateways):
        """Verify the request against ``gateways`` and apply the first that matches."""
        event = None
        for gateway in gateways:
            event = gateway.verify_webhook(request)
            if event is not None:
                break
        if event is None:
            return Response({'error': 'invalid_signature'},
                            status=status.HTTP_401_UNAUTHORIZED)

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


class PaymentDetailView(generics.RetrieveAPIView):
    """GET /api/v1/payments/<pk>/"""
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if self.request.user.role == 'admin':
            return Payment.objects.all()
        return Payment.objects.filter(user=self.request.user)


class PaymentHistoryView(generics.ListAPIView):
    """GET /api/v1/payments/history/"""
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if self.request.user.role == 'admin':
            return Payment.objects.all().order_by('-created_at')
        return Payment.objects.filter(user=self.request.user).order_by('-created_at')
