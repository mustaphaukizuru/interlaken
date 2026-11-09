"""Launch fix 3: notification dispatch that survives a killed worker and a second dispatcher.

A comunicado used to send up to 200 emails inside the publish request (sync
gunicorn workers, 60 s timeout, no SMTP timeout), stamped ``delivered_at`` only
after the whole batch, read the pending rows without a lock, and the cron that
sends the rest ran once a day. Now: each row is claimed on its own and stamped
as soon as it is handled, the publish request sends a small first batch of its
own comunicado only, SMTP and web push have timeouts, and the cron runs every
5 minutes.
"""
from datetime import timedelta
from io import StringIO
from unittest import mock

import pytest
from django.core import mail
from django.core.management import call_command
from django.db.models.query import QuerySet
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.portal import services
from apps.portal.models import Announcement, Notification, PushSubscription
from apps.portal.services import dispatch_pending_notifications, emergency_broadcast

pytestmark = pytest.mark.django_db


class _Killed(BaseException):
    """What a gunicorn timeout does to a sync worker: not an ``Exception``, nothing catches it."""


def _rows(n, **kw):
    rows = []
    for i in range(n):
        user = ParentFactory(email=f'familia{i}@test.mx')
        rows.append(Notification.objects.create(user=user, notif_type='info', title=f'Aviso {i}',
                                                message='Texto', **kw))
    return rows


def _parents(n):
    return [ParentFactory(email=f'padre{i}@test.mx') for i in range(n)]


def _later(row, **delta):
    """Time passes: the row was created that much earlier."""
    Notification.objects.filter(pk=row.pk).update(created_at=row.created_at - timedelta(**delta))
    row.refresh_from_db()


class TestPerRowStamping:
    def test_a_killed_worker_never_resends_what_it_already_sent(self):
        first, second, third = _rows(3)
        real = services.send_email
        calls = []

        def send(*args, **kwargs):
            calls.append(kwargs['recipients'])
            if len(calls) == 2:
                raise _Killed()
            return real(*args, **kwargs)

        mail.outbox.clear()
        with mock.patch('apps.portal.services.send_email', side_effect=send), \
                pytest.raises(_Killed):
            dispatch_pending_notifications()
        for row in (first, second, third):
            row.refresh_from_db()
        assert first.delivered_at is not None and first.email_status == 'sent'
        assert second.delivered_at is None and third.delivered_at is None

        mail.outbox.clear()
        assert dispatch_pending_notifications() == 2
        assert sorted(a for m in mail.outbox for a in m.to) == ['familia1@test.mx', 'familia2@test.mx']

    def test_a_row_another_dispatcher_delivered_meanwhile_is_skipped(self):
        first, second = _rows(2)
        real = services.send_email

        def send(*args, **kwargs):
            # While this dispatcher sends the first row, another one (the cron,
            # or a publish request) delivers the second.
            Notification.objects.filter(pk=second.pk).update(delivered_at=timezone.now(), email_status='sent')
            return real(*args, **kwargs)

        mail.outbox.clear()
        with mock.patch('apps.portal.services.send_email', side_effect=send) as sender:
            assert dispatch_pending_notifications() == 1
        assert sender.call_count == 1
        assert [a for m in mail.outbox for a in m.to] == ['familia0@test.mx']

    def test_rows_are_claimed_with_skip_locked(self):
        _rows(2)
        real, seen = QuerySet.select_for_update, []

        def spy(qs, *args, **kwargs):
            seen.append(kwargs)
            return real(qs, *args, **kwargs)

        with mock.patch.object(QuerySet, 'select_for_update', spy):
            dispatch_pending_notifications()
        assert len(seen) == 2 and all(k.get('skip_locked') is True for k in seen)

    def test_a_row_that_raises_never_blocks_the_queue(self, settings):
        settings.NOTIFICATION_MAX_ATTEMPTS = 2
        settings.OPS_EMAIL = 'sistemas@test.mx'
        poison, healthy = _rows(2)
        real = services.send_email

        def send(*args, **kwargs):
            if kwargs.get('recipients') == ['familia0@test.mx']:
                raise RuntimeError('plantilla rota')
            return real(*args, **kwargs)

        with mock.patch('apps.portal.services.send_email', side_effect=send):
            assert dispatch_pending_notifications() == 1
            poison.refresh_from_db()
            healthy.refresh_from_db()
            assert healthy.delivered_at is not None
            assert poison.delivered_at is None and poison.attempts == 1
            assert 'RuntimeError' in poison.last_error

            _later(poison, minutes=31)
            mail.outbox.clear()
            dispatch_pending_notifications()
        poison.refresh_from_db()
        assert poison.delivered_at is not None and poison.email_status == 'failed'
        assert [m.to for m in mail.outbox] == [['sistemas@test.mx']]   # the ops alert

    def test_a_retry_never_pushes_twice(self, settings):
        settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = 'pub', 'priv'
        (row,) = _rows(1)
        PushSubscription.objects.create(user=row.user, endpoint='https://push.example.com/a', p256dh='k', auth='a')
        with mock.patch('pywebpush.webpush') as wp, \
                mock.patch('apps.portal.services.send_email', return_value=False):
            dispatch_pending_notifications()
        row.refresh_from_db()
        assert row.delivered_at is None and row.push_status == 'sent' and wp.call_count == 1
        _later(row, minutes=31)
        with mock.patch('pywebpush.webpush') as wp:
            dispatch_pending_notifications()
        row.refresh_from_db()
        assert row.delivered_at is not None and row.email_status == 'sent'
        wp.assert_not_called()

    def test_a_failed_email_waits_before_its_retry(self, settings):
        settings.NOTIFICATION_MAX_ATTEMPTS = 3
        settings.OPS_EMAIL = ''                            # no ops alert in the count below
        (row,) = _rows(1)
        with mock.patch('apps.portal.services.send_email', return_value=False) as sender:
            dispatch_pending_notifications()               # attempt 1 fails
            dispatch_pending_notifications()               # 5 minutes later: too soon
            assert sender.call_count == 1
            _later(row, minutes=31)
            dispatch_pending_notifications()               # attempt 2 fails
            dispatch_pending_notifications()
            assert sender.call_count == 2
            _later(row, hours=4)
            dispatch_pending_notifications()               # attempt 3: out of attempts
            assert sender.call_count == 3
        row.refresh_from_db()
        assert row.delivered_at is not None and row.email_status == 'failed' and row.attempts == 3

    def test_stale_rows_are_closed_without_sending(self):
        (row,) = _rows(1)
        Notification.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(days=8))
        mail.outbox.clear()
        assert dispatch_pending_notifications() == 0
        row.refresh_from_db()
        assert row.delivered_at is not None and row.last_error == 'Caducó sin enviarse'
        assert mail.outbox == []

    def test_the_cron_command_reports_what_it_sent(self):
        _rows(2)
        out = StringIO()
        call_command('dispatch_notifications', stdout=out)
        assert 'Dispatched 2 notification(s).' in out.getvalue()
        assert not Notification.objects.filter(delivered_at__isnull=True).exists()


class TestInlineFirstBatch:
    def _publish(self, api_client, **extra):
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(reverse('admin-announcements'), {
            'title': 'Junta', 'body': 'Viernes 8:00', 'audience': 'parents', 'is_active': True, **extra,
        }, format='json')
        assert resp.status_code == 201, resp.content
        return Announcement.objects.get(pk=resp.json()['id'])

    def test_publish_sends_a_small_first_batch_and_the_cron_the_rest(self, api_client):
        _parents(services.INLINE_DISPATCH_LIMIT + 5)
        mail.outbox.clear()
        ann = self._publish(api_client)
        assert len(mail.outbox) == services.INLINE_DISPATCH_LIMIT
        pending = Notification.objects.filter(announcement=ann, delivered_at__isnull=True)
        assert pending.count() == 5
        assert dispatch_pending_notifications() == 5
        assert len(mail.outbox) == services.INLINE_DISPATCH_LIMIT + 5
        assert not pending.exists()

    def test_publish_sends_only_its_own_comunicado(self, api_client):
        older = _rows(1)[0]                           # a queued notice of something else
        _parents(1)
        mail.outbox.clear()
        self._publish(api_client)
        older.refresh_from_db()
        assert older.delivered_at is None             # left for the cron

    def test_publish_stops_when_its_time_budget_is_spent(self, api_client):
        _parents(3)
        mail.outbox.clear()
        with mock.patch('apps.portal.services.INLINE_DISPATCH_SECONDS', 0):
            ann = self._publish(api_client)
        assert mail.outbox == []
        assert Notification.objects.filter(announcement=ann, delivered_at__isnull=True).count() == 3

    def test_bulk_activation_leaves_all_sending_to_the_cron(self, api_client):
        _parents(2)
        draft = Announcement.objects.create(title='Borrador', body='x', audience='parents', is_active=False)
        api_client.force_authenticate(AdminFactory())
        mail.outbox.clear()
        resp = api_client.post(reverse('admin-announcements-bulk'),
                               {'action': 'activate', 'ids': [draft.pk]}, format='json')
        assert resp.status_code == 200 and resp.data['ok'] == 1
        assert mail.outbox == []                      # nothing sent inside the bulk transaction
        assert Notification.objects.filter(announcement=draft, delivered_at__isnull=True).count() == 2
        assert dispatch_pending_notifications() == 2
        assert len(mail.outbox) == 2

    def test_emergency_broadcast_sends_a_first_batch_only(self):
        _parents(services.INLINE_DISPATCH_LIMIT + 3)
        mail.outbox.clear()
        result = emergency_broadcast(title='Simulacro', message='Evacuación a las 10:00.', audience='parents')
        assert result['notified'] == services.INLINE_DISPATCH_LIMIT + 3
        assert result['dispatched'] == services.INLINE_DISPATCH_LIMIT
        assert Notification.objects.filter(delivered_at__isnull=True).count() == 3


class TestTimeouts:
    def test_smtp_has_a_timeout(self, settings):
        from django.core.mail.backends.smtp import EmailBackend

        assert 0 < settings.EMAIL_TIMEOUT <= 30
        assert EmailBackend().timeout == settings.EMAIL_TIMEOUT

    def test_web_push_has_a_timeout(self, settings):
        from apps.portal.push import send_web_push

        settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = 'pub', 'priv'
        user = ParentFactory()
        PushSubscription.objects.create(user=user, endpoint='https://push.example.com/t', p256dh='k', auth='a')
        with mock.patch('pywebpush.webpush') as wp:
            assert send_web_push(user, 'Hola', 'Texto') == 1
        assert 0 < wp.call_args.kwargs['timeout'] <= 30
