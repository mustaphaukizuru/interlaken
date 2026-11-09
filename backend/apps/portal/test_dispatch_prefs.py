"""Launch fix 1: the dispatcher honours each target's notification preferences.

Comunicados and queued notices are delivered by ``dispatch_pending_notifications``,
which used to email and push every target whatever their Avisos tab said, while
the email footer claimed «tiene activados los avisos por correo». Now each
target gets email only with email on and the category not muted, push only
with push on and the category not muted; urgent warnings (emergency
broadcasts) still reach everyone, as the Avisos tab promises.
"""
from unittest import mock

import pytest
from django.core import mail

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.accounts.models import NotificationPreference
from apps.cafeteria.views import _queue_balance_notification
from apps.portal.models import Announcement, Notification, PushSubscription
from apps.portal.services import dispatch_pending_notifications, fanout_announcement, notify

pytestmark = pytest.mark.django_db


@pytest.fixture
def vapid(settings):
    settings.VAPID_PUBLIC_KEY = 'pub'
    settings.VAPID_PRIVATE_KEY = 'priv'
    settings.VAPID_ADMIN_EMAIL = 't@x.mx'


def _subscribe(user):
    return PushSubscription.objects.create(
        user=user, endpoint=f'https://push.example.com/ep/{user.pk}', p256dh='k', auth='a')


def _prefs(user, **fields):
    prefs = NotificationPreference.for_user(user)
    for k, v in fields.items():
        setattr(prefs, k, v)
    prefs.save()
    return prefs


def _comunicado():
    ann = Announcement.objects.create(title='Junta de padres', body='El viernes a las 8:00.',
                                      audience=Announcement.Audience.PARENTS, is_active=True)
    fanout_announcement(ann)
    return ann


def _pushed_endpoints(wp):
    return sorted(c.kwargs['subscription_info']['endpoint'] for c in wp.call_args_list)


def _emailed():
    return sorted(addr for m in mail.outbox for addr in m.to)


class TestPreferenceModel:
    def test_wants_needs_the_channel_and_the_category(self):
        prefs = NotificationPreference(email_enabled=True, push_enabled=False, cat_info=False)
        assert prefs.wants('email', 'cafeteria') is True
        assert prefs.wants('push', 'cafeteria') is False
        assert prefs.wants('email', 'info') is False          # category muted

    def test_urgent_warnings_always_go_out(self):
        prefs = NotificationPreference(email_enabled=False, push_enabled=False, in_app_enabled=False,
                                       cat_info=False, cat_cafeteria=False, cat_payment=False)
        assert all(prefs.wants(ch, 'warning') for ch in ('email', 'push', 'in_app'))

    def test_lookup_never_creates_a_row(self):
        user = ParentFactory()
        prefs = NotificationPreference.lookup(user)
        assert prefs.pk is None and prefs.email_enabled and prefs.push_enabled
        assert not NotificationPreference.objects.filter(user=user).exists()


class TestComunicadoDispatch:
    def test_email_off_gets_push_but_no_email(self, vapid):
        parent = ParentFactory(email='sinmail@test.mx')
        _prefs(parent, email_enabled=False)
        _subscribe(parent)
        _comunicado()
        mail.outbox.clear()
        with mock.patch('pywebpush.webpush') as wp:
            assert dispatch_pending_notifications() == 1
        assert mail.outbox == []
        assert wp.call_count == 1
        n = Notification.objects.get(user=parent)
        assert n.delivered_at is not None
        assert (n.email_status, n.push_status) == ('skipped', 'sent')

    def test_push_off_gets_email_but_no_push(self, vapid):
        parent = ParentFactory(email='sinpush@test.mx')
        _prefs(parent, push_enabled=False)
        _subscribe(parent)
        _comunicado()
        mail.outbox.clear()
        with mock.patch('pywebpush.webpush') as wp:
            dispatch_pending_notifications()
        wp.assert_not_called()
        assert _emailed() == ['sinpush@test.mx']
        n = Notification.objects.get(user=parent)
        assert (n.email_status, n.push_status) == ('sent', 'skipped')

    def test_muted_comunicados_category_gets_neither(self, vapid):
        parent = ParentFactory(email='silencio@test.mx')
        _prefs(parent, cat_info=False)
        _subscribe(parent)
        _comunicado()
        mail.outbox.clear()
        with mock.patch('pywebpush.webpush') as wp:
            dispatch_pending_notifications()
        wp.assert_not_called()
        assert mail.outbox == []

    def test_each_family_keeps_its_own_choice(self):
        ParentFactory(email='si@test.mx')
        _prefs(ParentFactory(email='no@test.mx'), email_enabled=False)
        _comunicado()
        mail.outbox.clear()
        dispatch_pending_notifications()
        assert _emailed() == ['si@test.mx']

    def test_urgent_warning_reaches_a_family_with_everything_off(self, vapid):
        parent = ParentFactory(email='todo-apagado@test.mx')
        _prefs(parent, email_enabled=False, push_enabled=False, in_app_enabled=False, cat_info=False)
        _subscribe(parent)
        ann = Announcement.objects.create(title='Suspensión de clases', body='Mañana no hay clases.',
                                          audience=Announcement.Audience.PARENTS, is_active=True)
        fanout_announcement(ann, notif_type=Notification.NotifType.WARNING)
        mail.outbox.clear()
        with mock.patch('pywebpush.webpush') as wp:
            dispatch_pending_notifications()
        assert wp.call_count == 1
        assert _emailed() == ['todo-apagado@test.mx']
        body = mail.outbox[0].body
        # The footer must not claim a preference the family switched off.
        assert 'alerta urgente' in body and 'tiene activados los avisos por correo' not in body

    def test_footer_claim_is_true_for_ordinary_notices(self):
        ParentFactory(email='activos@test.mx')
        _comunicado()
        mail.outbox.clear()
        dispatch_pending_notifications()
        assert 'tiene activados los avisos por correo' in mail.outbox[0].body


class TestStudentRowFanout:
    """A pending student row also reaches the guardians: each on their own channels."""

    def _family(self):
        mom = ParentFactory(email='mama@test.mx')
        dad = ParentFactory(email='papa@test.mx')
        kid = StudentUserFactory(email='kid@gmail.com')
        StudentProfileFactory(user=kid, parents=[mom, dad])
        return kid, mom, dad

    def test_guardian_with_email_off_is_not_emailed(self):
        kid, mom, dad = self._family()
        _prefs(dad, email_enabled=False)
        Notification.objects.create(user=kid, notif_type='cafeteria', title='Compra', message='m')
        mail.outbox.clear()
        dispatch_pending_notifications()
        assert _emailed() == ['kid@gmail.com', 'mama@test.mx']

    def test_guardian_with_push_off_is_not_pushed(self, vapid):
        kid, mom, dad = self._family()
        for u in (kid, mom, dad):
            _subscribe(u)
        _prefs(mom, push_enabled=False)
        Notification.objects.create(user=kid, notif_type='cafeteria', title='Compra', message='m')
        with mock.patch('pywebpush.webpush') as wp:
            dispatch_pending_notifications()
        assert _pushed_endpoints(wp) == sorted(
            f'https://push.example.com/ep/{u.pk}' for u in (kid, dad))


class TestQueuedBalanceNotice:
    """The bulk top-up's late notices: queued per family member, sent by the cron."""

    def _student_with(self, parent):
        student = StudentProfileFactory(user=StudentUserFactory(email='s1@alumnos.interlaken.edu.mx'),
                                        parents=[parent])
        _prefs(student.user, email_enabled=False, push_enabled=False)  # only the parent is reachable
        return student

    def test_push_only_family_is_pushed_never_emailed(self, vapid):
        parent = ParentFactory(email='solo-push@test.mx')
        _prefs(parent, email_enabled=False)
        _subscribe(parent)
        _queue_balance_notification(self._student_with(parent), 'Ajuste de saldo', 'Se acreditaron $30.00.')
        row = Notification.objects.get(user=parent)
        assert row.delivered_at is None and row.email_status == 'skipped'
        mail.outbox.clear()
        with mock.patch('pywebpush.webpush') as wp:
            dispatch_pending_notifications()
        assert wp.call_count == 1 and mail.outbox == []
        row.refresh_from_db()
        assert (row.email_status, row.push_status) == ('skipped', 'sent')

    def test_email_only_family_is_emailed_never_pushed(self, vapid):
        parent = ParentFactory(email='solo-correo@test.mx')
        _prefs(parent, push_enabled=False)
        _subscribe(parent)
        _queue_balance_notification(self._student_with(parent), 'Ajuste de saldo', 'Se acreditaron $30.00.')
        mail.outbox.clear()
        with mock.patch('pywebpush.webpush') as wp:
            dispatch_pending_notifications()
        wp.assert_not_called()
        assert _emailed() == ['solo-correo@test.mx']

    def test_preferences_changed_after_queueing_win(self):
        parent = ParentFactory(email='cambio@test.mx')
        _queue_balance_notification(self._student_with(parent), 'Ajuste de saldo', 'Se acreditaron $30.00.')
        _prefs(parent, email_enabled=False)       # switched off before the cron ran
        mail.outbox.clear()
        dispatch_pending_notifications()
        assert mail.outbox == []

    def test_nothing_on_means_nothing_queued(self):
        parent = ParentFactory(email='nada@test.mx')
        _prefs(parent, email_enabled=False, push_enabled=False)
        _queue_balance_notification(self._student_with(parent), 'Ajuste de saldo', 'Se acreditaron $30.00.')
        row = Notification.objects.get(user=parent)
        assert row.delivered_at is not None          # in-app only: the cron never sees it
        assert (row.email_status, row.push_status) == ('skipped', 'skipped')


class TestNotifyFanout:
    def test_fanout_honours_each_guardians_email_choice(self):
        mom = ParentFactory(email='mama@test.mx')
        dad = ParentFactory(email='papa@test.mx')
        kid = StudentUserFactory(email='kid@gmail.com')
        StudentProfileFactory(user=kid, parents=[mom, dad])
        _prefs(dad, email_enabled=False)
        mail.outbox.clear()
        notify(kid, 'info', 'Aviso', 'Hola')
        assert _emailed() == ['kid@gmail.com', 'mama@test.mx']

    def test_urgent_notify_ignores_the_toggles(self):
        parent = ParentFactory(email='urgente@test.mx')
        _prefs(parent, email_enabled=False, in_app_enabled=False)
        mail.outbox.clear()
        n = notify(parent, 'warning', 'Simulacro', 'Evacuación a las 10:00.', fanout=False)
        assert n is not None and _emailed() == ['urgente@test.mx']
