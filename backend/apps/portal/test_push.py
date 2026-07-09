"""
Web push: subscription endpoints, notify() integration (fail-soft),
and pruning of expired subscriptions.
"""
from unittest import mock

import pytest
from django.urls import reverse

from apps.portal.models import PushSubscription
from apps.portal.push import send_web_push
from apps.portal.services import notify

pytestmark = pytest.mark.django_db

SUB_URL = reverse('push-subscribe')
UNSUB_URL = reverse('push-unsubscribe')

SUB_BODY = {
    'endpoint': 'https://push.example.com/ep/1',
    'keys': {'p256dh': 'k1', 'auth': 'a1'},
}


class TestEndpoints:
    def test_anonymous_401(self, api_client):
        assert api_client.post(SUB_URL, SUB_BODY, format='json').status_code == 401

    def test_subscribe_and_resubscribe_idempotent(self, api_client, parent_user):
        api_client.force_authenticate(parent_user)
        assert api_client.post(SUB_URL, SUB_BODY, format='json').status_code == 201
        assert api_client.post(SUB_URL, SUB_BODY, format='json').status_code == 201
        assert PushSubscription.objects.filter(user=parent_user).count() == 1

    def test_invalid_body_400(self, api_client, parent_user):
        api_client.force_authenticate(parent_user)
        resp = api_client.post(SUB_URL, {'endpoint': 'x'}, format='json')
        assert resp.status_code == 400

    def test_unsubscribe_removes(self, api_client, parent_user):
        api_client.force_authenticate(parent_user)
        api_client.post(SUB_URL, SUB_BODY, format='json')
        resp = api_client.post(UNSUB_URL, {'endpoint': SUB_BODY['endpoint']},
                               format='json')
        assert resp.json()['removed'] == 1
        assert PushSubscription.objects.count() == 0


class TestSending:
    @staticmethod
    def _configure(settings):
        settings.VAPID_PUBLIC_KEY = 'pub'
        settings.VAPID_PRIVATE_KEY = 'priv'
        settings.VAPID_ADMIN_EMAIL = 't@x.mx'

    def _subscribe(self, user, endpoint='https://push.example.com/ep/1'):
        return PushSubscription.objects.create(
            user=user, endpoint=endpoint, p256dh='k', auth='a')

    def test_notify_delivers_push(self, parent_user, settings):
        self._configure(settings)
        self._subscribe(parent_user)
        with mock.patch('pywebpush.webpush') as wp:
            notify(parent_user, 'info', 'Hola', 'Mensaje', email=False)
        assert wp.call_count == 1
        assert wp.call_args.kwargs['subscription_info']['endpoint'] == SUB_BODY['endpoint']

    def test_expired_subscription_is_pruned(self, parent_user, settings):
        from pywebpush import WebPushException
        self._configure(settings)
        self._subscribe(parent_user)
        gone = WebPushException('gone', response=mock.Mock(status_code=410))
        with mock.patch('pywebpush.webpush', side_effect=gone):
            delivered = send_web_push(parent_user, 'T', 'M')
        assert delivered == 0
        assert PushSubscription.objects.count() == 0

    def test_unconfigured_is_noop(self, parent_user, settings):
        settings.VAPID_PUBLIC_KEY = 'pub'
        settings.VAPID_PRIVATE_KEY = ''
        self._subscribe(parent_user)
        with mock.patch('pywebpush.webpush') as wp:
            assert send_web_push(parent_user, 'T', 'M') == 0
        wp.assert_not_called()
