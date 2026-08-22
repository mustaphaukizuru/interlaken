"""P1-C5/C6: per-channel delivery status, retry with cap, ops alert, delivery report + resend."""
from unittest.mock import patch

import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.portal.models import Announcement, Notification
from apps.portal.services import dispatch_pending_notifications, notify

pytestmark = pytest.mark.django_db


def _row(user, ann=None):
    return Notification.objects.create(user=user, notif_type='info', title='T', message='M', announcement=ann)


def test_notify_stamps_statuses():
    p = ParentFactory()
    n = notify(p, 'info', 'Hola', 'Msg')
    n.refresh_from_db()
    assert n.email_status == 'sent' and n.push_status == 'skipped' and n.attempts == 1


def test_dispatch_retries_then_fails_and_alerts_ops(settings):
    settings.OPS_EMAIL = 'sistemas@test.mx'
    settings.NOTIFICATION_MAX_ATTEMPTS = 2
    p = ParentFactory(email='fam@test.mx')
    n = _row(p)
    with patch('apps.portal.services.send_email', return_value=False) as se, \
         patch('apps.portal.push.send_web_push', return_value=0):
        assert dispatch_pending_notifications() == 0
        n.refresh_from_db()
        assert n.delivered_at is None and n.attempts == 1 and n.email_status == 'failed'
        assert dispatch_pending_notifications() == 0
        n.refresh_from_db()
        assert n.delivered_at is not None and n.attempts == 2 and 'intentos' in n.last_error
        # the ops alert is the extra send_email call after the exhausted attempt
        ops_calls = [c for c in se.call_args_list if c.args and c.args[0].startswith('[Interlaken]')]
        assert ops_calls and ops_calls[0].args[2] == ['sistemas@test.mx']


def test_delivery_report_and_resend(api_client):
    ann = Announcement.objects.create(title='A', body='B', audience='all')
    ok = ParentFactory(email='ok@test.mx')
    bad = ParentFactory(email='bad@test.mx')
    n1 = _row(ok, ann)
    n2 = _row(bad, ann)
    mail.outbox.clear()
    with patch('apps.portal.services.send_email', side_effect=lambda *a, **k: 'bad@' not in str(k.get('recipients'))), \
         patch('apps.portal.push.send_web_push', return_value=0):
        for _ in range(3):
            dispatch_pending_notifications()
    api_client.force_authenticate(user=AdminFactory())
    rep = api_client.get(reverse('admin-announcement-delivery', args=[ann.pk])).data
    assert rep['recipients'] == 2 and rep['email']['sent'] == 1 and rep['email']['failed'] == 1
    assert [f['email'] for f in rep['failed']] == ['bad@test.mx']
    res = api_client.post(reverse('admin-announcement-delivery', args=[ann.pk]), {'action': 'resend_failed'}, format='json')
    assert res.data['requeued'] == 1
    n2.refresh_from_db()
    n1.refresh_from_db()
    assert n2.delivered_at is None and n2.attempts == 0 and n1.delivered_at is not None
