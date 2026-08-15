"""
Out-of-band notification delivery (#18): bulk announcement fan-out creates
in-app rows only; the dispatch_notifications cron delivers email + push for
undelivered rows, while per-user notify() is stamped delivered inline.

Also covers the PWA v2 push flow: comunicado pushes deep-link to
/portal/comunicados/<id>, the admin 'Enviar notificación push' toggle gates
web-push only (email/in-app unaffected), publish via the admin API triggers
the first push batch inline, and audience targeting filters recipients.
"""
import json
from unittest import mock

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, UserFactory
from apps.accounts.models import User
from apps.portal.models import Announcement, Notification, PushSubscription
from apps.portal.services import dispatch_pending_notifications, fanout_announcement, notify

pytestmark = pytest.mark.django_db


def _configure_vapid(settings):
    settings.VAPID_PUBLIC_KEY = 'pub'
    settings.VAPID_PRIVATE_KEY = 'priv'
    settings.VAPID_ADMIN_EMAIL = 't@x.mx'


def _subscribe(user, endpoint='https://push.example.com/ep/dispatch'):
    return PushSubscription.objects.create(
        user=user, endpoint=endpoint, p256dh='k', auth='a')


def test_fanout_is_pending_then_dispatch_delivers():
    p = ParentFactory()
    ann = Announcement.objects.create(
        title='Aviso', body='cuerpo', audience=Announcement.Audience.PARENTS, is_active=True)
    fanout_announcement(ann)

    n = Notification.objects.get(user=p)
    assert n.delivered_at is None                     # bulk fan-out: not yet sent

    assert dispatch_pending_notifications() == 1
    n.refresh_from_db()
    assert n.delivered_at is not None                 # delivered by the cron
    assert dispatch_pending_notifications() == 0      # idempotent: nothing left


def test_notify_is_delivered_inline():
    p = ParentFactory()
    notify(p, Notification.NotifType.INFO, 'Hola', 'mensaje')
    n = Notification.objects.get(user=p)
    assert n.delivered_at is not None                 # inline send stamps it
    assert dispatch_pending_notifications() == 0      # cron skips it


def test_dispatch_push_deep_links_to_comunicado(settings):
    _configure_vapid(settings)
    p = ParentFactory()
    _subscribe(p)
    ann = Announcement.objects.create(
        title='Junta', body='Detalle', audience=Announcement.Audience.PARENTS,
        is_active=True)
    fanout_announcement(ann)

    with mock.patch('pywebpush.webpush') as wp:
        assert dispatch_pending_notifications() == 1
    assert wp.call_count == 1
    payload = json.loads(wp.call_args.kwargs['data'])
    assert payload['title'] == 'Junta'
    assert payload['url'] == f'/portal/comunicados/{ann.pk}'


def test_push_toggle_off_skips_push_but_still_emails(settings, mailoutbox):
    _configure_vapid(settings)
    p = ParentFactory()
    _subscribe(p)
    ann = Announcement.objects.create(
        title='Sin push', body='Solo correo/app',
        audience=Announcement.Audience.PARENTS, is_active=True,
        push_enabled=False)
    fanout_announcement(ann)

    with mock.patch('pywebpush.webpush') as wp:
        assert dispatch_pending_notifications() == 1
    wp.assert_not_called()                            # toggle off → no web-push
    assert len(mailoutbox) == 1                       # email channel unaffected
    n = Notification.objects.get(user=p)
    assert n.delivered_at is not None                 # still stamped dispatched


def test_admin_publish_triggers_push_first_batch(settings, api_client):
    _configure_vapid(settings)
    p = ParentFactory()
    _subscribe(p)
    api_client.force_authenticate(AdminFactory())

    with mock.patch('pywebpush.webpush') as wp:
        resp = api_client.post(reverse('admin-announcements'), {
            'title': 'Suspensión', 'body': 'No hay clases mañana.',
            'audience': 'parents', 'is_active': True, 'push_enabled': True,
        }, format='json')
    assert resp.status_code == 201
    assert resp.json()['push_enabled'] is True
    assert wp.call_count == 1                         # inline first batch
    payload = json.loads(wp.call_args.kwargs['data'])
    assert payload['url'] == f"/portal/comunicados/{resp.json()['id']}"


def test_audience_filtering_staff_only(settings):
    _configure_vapid(settings)
    parent = ParentFactory()
    staff = UserFactory(role=User.Role.STAFF)
    _subscribe(parent, endpoint='https://push.example.com/ep/parent')
    _subscribe(staff, endpoint='https://push.example.com/ep/staff')
    ann = Announcement.objects.create(
        title='Solo personal', body='Circular interna',
        audience=Announcement.Audience.STAFF, is_active=True)
    fanout_announcement(ann)

    assert not Notification.objects.filter(user=parent).exists()
    with mock.patch('pywebpush.webpush') as wp:
        assert dispatch_pending_notifications() == 1  # staff row only
    assert wp.call_count == 1
    endpoint = wp.call_args.kwargs['subscription_info']['endpoint']
    assert endpoint == 'https://push.example.com/ep/staff'
