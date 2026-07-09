"""
portal/push.py — Web Push: subscription endpoints + fail-soft sender.

Inert until VAPID keys are configured (generate once):
    python -c "from py_vapid import Vapid02; v=Vapid02(); v.generate_keys(); \
print('VAPID_PRIVATE_KEY=', v.private_pem().decode()); \
print('VAPID_PUBLIC_KEY(base64url)=', __import__('base64').urlsafe_b64encode(\
v.public_key.public_bytes(__import__('cryptography.hazmat.primitives.serialization', \
fromlist=['Encoding']).Encoding.X962, __import__('cryptography.hazmat.primitives.serialization', \
fromlist=['PublicFormat']).PublicFormat.UncompressedPoint)).rstrip(b'=').decode())"
(or simply run `vapid --gen` from the pywebpush/py-vapid CLI — see DEPLOYMENT.md).

The same base64url public key goes to the frontend as VITE_VAPID_PUBLIC_KEY.
Sending never raises into callers: failures are logged and 404/410 (expired)
subscriptions are pruned automatically.
"""
import json
import logging

from django.conf import settings
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import PushSubscription

logger = logging.getLogger(__name__)


def push_configured() -> bool:
    return bool(getattr(settings, 'VAPID_PRIVATE_KEY', '')
                and getattr(settings, 'VAPID_PUBLIC_KEY', ''))


def send_web_push(user, title: str, message: str, url: str = '/portal') -> int:
    """Send a push to every subscription of ``user``. Returns #delivered.

    Fail-soft: no keys or no subscriptions → 0, never an exception. Dead
    endpoints (HTTP 404/410 from the push service) are deleted on the spot.
    """
    if not push_configured() or user is None:
        return 0
    from pywebpush import WebPushException, webpush   # imported lazily

    payload = json.dumps({'title': title, 'body': message, 'url': url})
    delivered = 0
    for sub in list(user.push_subscriptions.all()):
        try:
            webpush(
                subscription_info={
                    'endpoint': sub.endpoint,
                    'keys': {'p256dh': sub.p256dh, 'auth': sub.auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={'sub': f'mailto:{settings.VAPID_ADMIN_EMAIL}'},
            )
            delivered += 1
        except WebPushException as exc:
            code = getattr(exc.response, 'status_code', None)
            if code in (404, 410):
                sub.delete()   # subscription expired/revoked — prune
                logger.info(f'Pruned dead push subscription for {user}: {code}')
            else:
                logger.warning(f'Web push failed for {user}: {exc}')
        except Exception as exc:   # pragma: no cover — defensive
            logger.warning(f'Web push error for {user}: {exc}')
    return delivered


class PushSubscribeView(APIView):
    """POST /api/v1/portal/push/subscribe/ — body: browser PushSubscription JSON."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        endpoint = (request.data.get('endpoint') or '').strip()
        keys = request.data.get('keys') or {}
        p256dh, auth = keys.get('p256dh', ''), keys.get('auth', '')
        if not (endpoint and p256dh and auth):
            return Response({'error': 'Suscripción inválida.'},
                            status=status.HTTP_400_BAD_REQUEST)
        # Endpoint is globally unique: re-subscribing moves it to this user.
        PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            defaults={'user': request.user, 'p256dh': p256dh, 'auth': auth},
        )
        return Response({'detail': 'Suscripción registrada.'},
                        status=status.HTTP_201_CREATED)


class PushUnsubscribeView(APIView):
    """POST /api/v1/portal/push/unsubscribe/ — body: {endpoint}."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        endpoint = (request.data.get('endpoint') or '').strip()
        deleted, _ = PushSubscription.objects.filter(
            user=request.user, endpoint=endpoint).delete()
        return Response({'removed': deleted})
