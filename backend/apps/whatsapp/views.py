"""
whatsapp/views.py — Meta WhatsApp Business (Cloud API) webhook.

  - ``GET``  echoes Meta's verification challenge (``WHATSAPP_VERIFY_TOKEN``).
  - ``POST`` verifies ``X-Hub-Signature-256`` (``WHATSAPP_APP_SECRET``) then
    processes messages. Unsigned/forged calls are rejected with 403 (fails closed).

We always answer 200 to a *verified* POST — even if handling fails — so Meta
doesn't retry-storm; message handling is fail-soft in ``services``.
"""
import json
import logging

from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.ratelimit import ratelimit

from . import services

logger = logging.getLogger(__name__)


@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(ratelimit('whatsapp-webhook', '120/m', key='ip', method='POST'), name='dispatch')
class WhatsAppWebhookView(APIView):
    """GET|POST /api/v1/whatsapp/webhook/ — Cloud API verify handshake + messages."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        challenge = services.verify_handshake(request.query_params)
        if challenge is None:
            return HttpResponse('Verification failed', status=status.HTTP_403_FORBIDDEN)
        # Meta expects the raw challenge echoed back as text/plain.
        return HttpResponse(challenge, content_type='text/plain')

    def post(self, request):
        if not services.verify_signature(request):
            logger.warning('Rejected WhatsApp webhook with invalid signature')
            return Response({'detail': 'Firma no válida.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            payload = json.loads(request.body.decode('utf-8'))
            result = services.handle_webhook(payload)
            logger.info('WhatsApp webhook processed: %s', result)
        except Exception as exc:  # fail-soft: still 200 so Meta stops retrying
            logger.exception('WhatsApp webhook processing error: %s', exc)
        return Response({'status': 'ok'}, status=status.HTTP_200_OK)
