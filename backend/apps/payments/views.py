"""
Payments views: initiate Global Payments charge, webhook, history.
"""
import hashlib
import hmac
import json

from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.ratelimit import ratelimit

from .models import Payment
from .serializers import PaymentInitiateSerializer, PaymentSerializer

# Statuses that are terminal — a webhook that arrives for one of these is a
# duplicate/replay and must be a no-op (idempotency).
FINAL_STATUSES = (Payment.Status.SUCCESS, Payment.Status.FAILED, Payment.Status.REFUNDED)


def verify_webhook(request):
    """Verify an inbound payment webhook against a shared HMAC secret.

    Computes ``HMAC-SHA256(secret, raw_body)`` (hex) and constant-time compares
    it to the ``X-Webhook-Signature`` header. Any configured gateway secret that
    matches is accepted, so the same endpoint can serve Global Payments and
    Banorte. Fails closed: with no secret configured (or no signature sent),
    verification fails and the caller returns 401.
    """
    secrets = [
        getattr(settings, 'GLOBAL_PAYMENTS_WEBHOOK_SECRET', ''),
        getattr(settings, 'BANORTE_WEBHOOK_SECRET', ''),
    ]
    secrets = [s for s in secrets if s]
    signature = (
        request.headers.get('X-Webhook-Signature')
        or request.headers.get('X-Signature', '')
    )
    if not secrets or not signature:
        return False

    body = request.body
    for secret in secrets:
        expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, signature):
            return True
    return False


class PaymentInitiateView(APIView):
    """POST /api/v1/payments/initiate/"""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = PaymentInitiateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        payment = Payment.objects.create(
            user=request.user,
            payment_type=data['payment_type'],
            amount=data['amount'],
            description=data.get('description', ''),
            status=Payment.Status.PENDING,
        )

        from django.conf import settings as dj_settings
        hpp_url = None
        if getattr(dj_settings, 'GLOBAL_PAYMENTS_APP_ID', ''):
            pass  # Wire Global Payments HPP SDK here when credentials are live

        return Response({
            'payment_id': payment.id,
            'amount': str(payment.amount),
            'status': payment.status,
            'hpp_url': hpp_url,
            'detail': 'Pago registrado correctamente.',
        }, status=status.HTTP_201_CREATED)


@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(ratelimit('payment-webhook', '120/m', key='ip', method='POST'), name='dispatch')
class PaymentWebhookView(APIView):
    """POST /api/v1/payments/webhook/ — Gateway server notification.

    Requires a valid HMAC signature (see ``verify_webhook``) and is idempotent:
    a webhook for an already-finalized payment is acknowledged but not
    re-applied.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        if not verify_webhook(request):
            return Response({'error': 'invalid_signature'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            payload = json.loads(request.body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return Response({'error': 'invalid_payload'}, status=400)

        transaction_id = payload.get('id') or payload.get('transaction_id')
        gp_status = payload.get('status', '').upper()
        payment_id = payload.get('order_id') or payload.get('reference')

        try:
            payment = Payment.objects.get(pk=payment_id)
        except (Payment.DoesNotExist, TypeError, ValueError):
            return Response({'error': 'payment_not_found'}, status=404)

        # Idempotency: never re-process a payment that already reached a final state.
        if payment.status in FINAL_STATUSES:
            return Response({'detail': 'already_processed'})

        if gp_status in ('CAPTURED', 'SUCCESS'):
            payment.mark_success(transaction_id or payment.gateway_tx_id, payload)
        elif gp_status in ('DECLINED', 'FAILED', 'ERROR'):
            payment.status = Payment.Status.FAILED
            if transaction_id:
                payment.gateway_tx_id = transaction_id
            payment.gateway_raw = payload
            payment.save(update_fields=['status', 'gateway_tx_id', 'gateway_raw', 'updated_at'])
        else:
            # Non-terminal notification (e.g. PENDING/PROCESSING): record raw only.
            payment.gateway_raw = payload
            if transaction_id:
                payment.gateway_tx_id = transaction_id
            payment.save(update_fields=['gateway_tx_id', 'gateway_raw', 'updated_at'])

        return Response({'detail': 'ok'})


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
