"""Launch fix 2: one email per address and notice, whoever in the family it is addressed to.

Families sign in with the student's login (``ci…@interlaken.com.mx``) and add a
personal ``notify_email``, which is often the address of a guardian who has a
login of their own. Every family member gets their own copy of a cafetería
notice, so on 2026-11-08 a purchase notice went to
``['mama@gmail.com', 'ci…', 'mama@gmail.com']``. The student's copy now leaves
out every address an active linked guardian's own copy reaches, and the
dispatcher no longer sends a student's queued row to a guardian who holds a row
of the same notice.
"""
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core import mail
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.accounts.models import NotificationPreference
from apps.accounts.recipients import own_copy_mailboxes
from apps.cafeteria.models import CafeteriaTransaction
from apps.cafeteria.services import _notify_balance_change, _notify_purchase
from apps.cafeteria.views import _queue_balance_notification
from apps.portal.models import Announcement, Notification, PushSubscription
from apps.portal.services import dispatch_pending_notifications, fanout_announcement

pytestmark = pytest.mark.django_db

NOW = timezone.now()


def _family(*, student_email='ci09938@interlaken.com.mx', student_notify='mama@gmail.com',
            guardian_email='mama@gmail.com', guardian_notify=''):
    mom = ParentFactory(email=guardian_email, notify_email=guardian_notify,
                        notify_email_verified_at=NOW if guardian_notify else None)
    kid = StudentUserFactory(email=student_email, notify_email=student_notify,
                             notify_email_verified_at=NOW if student_notify else None)
    profile = StudentProfileFactory(user=kid, parents=[mom])
    return profile, kid, mom


def _sent_to():
    """Every address of every email sent, in order: a duplicate shows up twice."""
    return [addr.lower() for m in mail.outbox for addr in m.to]


def _off(user, **fields):
    prefs = NotificationPreference.for_user(user)
    for k, v in fields.items():
        setattr(prefs, k, v)
    prefs.save()


class TestFamilyLoop:
    """``notify(fanout=False)`` for each family member (cafetería notices)."""

    def test_the_reported_purchase_reaches_each_address_once(self):
        profile, kid, mom = _family()
        tx = CafeteriaTransaction.objects.create(
            student=profile, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal('25.00'), description='Agua', loyverse_receipt_id='R-dedupe-1',
            balance_after=Decimal('75.00'))
        mail.outbox.clear()
        _notify_purchase(tx)
        assert sorted(_sent_to()) == ['ci09938@interlaken.com.mx', 'mama@gmail.com']
        # Both still get the in-app notice: only the duplicate email is gone.
        assert Notification.objects.filter(user__in=[kid, mom]).count() == 2

    def test_guardian_personal_address_is_not_repeated_either(self):
        profile, *_ = _family(student_notify='familia@gmail.com', guardian_email='papa@test.mx',
                              guardian_notify='familia@gmail.com')
        mail.outbox.clear()
        _notify_balance_change(profile, 'Ajuste de saldo', 'Se acreditaron $30.00.')
        assert sorted(_sent_to()) == ['ci09938@interlaken.com.mx', 'familia@gmail.com', 'papa@test.mx']

    def test_comparison_ignores_case(self):
        profile, *_ = _family(student_notify='Mama@Gmail.com', guardian_email='mama@gmail.com')
        mail.outbox.clear()
        _notify_balance_change(profile, 'Ajuste de saldo', 'Se acreditaron $30.00.')
        assert sorted(_sent_to()) == ['ci09938@interlaken.com.mx', 'mama@gmail.com']

    def test_guardian_with_email_off_still_gets_one_copy_through_the_student(self):
        profile, kid, mom = _family()
        _off(mom, email_enabled=False)
        mail.outbox.clear()
        _notify_balance_change(profile, 'Ajuste de saldo', 'Se acreditaron $30.00.')
        assert sorted(_sent_to()) == ['ci09938@interlaken.com.mx', 'mama@gmail.com']

    def test_inactive_guardian_does_not_cover_the_address(self):
        profile, kid, mom = _family()
        mom.is_active = False
        mom.save(update_fields=['is_active'])
        assert own_copy_mailboxes(kid, 'cafeteria') == ['ci09938@interlaken.com.mx', 'mama@gmail.com']

    def test_a_guardian_keeps_their_own_addresses(self):
        _, kid, mom = _family()
        assert own_copy_mailboxes(mom, 'cafeteria') == ['mama@gmail.com']
        assert own_copy_mailboxes(kid, 'cafeteria') == ['ci09938@interlaken.com.mx']


class TestDispatcher:
    def test_queued_notice_reaches_the_guardian_once(self, settings):
        settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = 'pub', 'priv'
        profile, kid, mom = _family()
        PushSubscription.objects.create(user=mom, endpoint='https://push.example.com/mom', p256dh='k', auth='a')
        assert _queue_balance_notification(profile, 'Ajuste de saldo', 'Se acreditaron $30.00.') == 2
        mail.outbox.clear()
        with mock.patch('pywebpush.webpush') as wp:
            assert dispatch_pending_notifications() == 2
        assert sorted(_sent_to()) == ['ci09938@interlaken.com.mx', 'mama@gmail.com']
        assert wp.call_count == 1                     # her own row only, not the student's too

    def test_comunicado_student_row_leaves_out_the_guardians_address(self):
        _family()
        ann = Announcement.objects.create(title='Junta', body='Viernes 8:00', audience='parents', is_active=True)
        assert fanout_announcement(ann) == 2          # the student login and the guardian login
        mail.outbox.clear()
        dispatch_pending_notifications()
        assert sorted(_sent_to()) == ['ci09938@interlaken.com.mx', 'mama@gmail.com']

    def test_a_different_notice_still_reaches_the_guardian(self):
        profile, kid, mom = _family(student_notify='')
        Notification.objects.create(user=mom, notif_type='cafeteria', title='Compra en cafetería',
                                    message='Otra compra.', delivered_at=NOW)
        Notification.objects.create(user=kid, notif_type='cafeteria', title='Compra en cafetería',
                                    message='Carla: compra de $25.00.')
        mail.outbox.clear()
        dispatch_pending_notifications()
        assert sorted(_sent_to()) == ['ci09938@interlaken.com.mx', 'mama@gmail.com']

    def test_same_text_long_ago_is_another_notice(self):
        profile, kid, mom = _family(student_notify='')
        old = Notification.objects.create(user=mom, notif_type='cafeteria', title='Saldo bajo',
                                          message='Saldo de $10.00.', delivered_at=NOW)
        Notification.objects.filter(pk=old.pk).update(created_at=NOW - timedelta(days=2))
        Notification.objects.create(user=kid, notif_type='cafeteria', title='Saldo bajo',
                                    message='Saldo de $10.00.')
        mail.outbox.clear()
        dispatch_pending_notifications()
        assert sorted(_sent_to()) == ['ci09938@interlaken.com.mx', 'mama@gmail.com']
