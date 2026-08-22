"""P0-5: a student's notification reaches the student's real mailbox AND every guardian.

Synthetic importer addresses (``<matricula>@alumnos.interlaken.edu.mx``) never
receive mail and are skipped; guardians who already hold their own row for a
comunicado are not emailed twice.
"""
from unittest.mock import patch

import pytest
from django.core import mail

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.accounts.recipients import delivery_users, email_recipients, is_synthetic_email
from apps.portal.models import Notification
from apps.portal.services import dispatch_pending_notifications, notify

pytestmark = pytest.mark.django_db


def _family(student_email='s1@alumnos.interlaken.edu.mx'):
    p1 = ParentFactory(email='mom@test.mx')
    p2 = ParentFactory(email='dad@test.mx')
    student = StudentUserFactory(email=student_email)
    StudentProfileFactory(user=student, parents=[p1, p2])
    return student, p1, p2


class TestHelpers:
    def test_synthetic_detection(self):
        assert is_synthetic_email('A123@alumnos.interlaken.edu.mx')
        assert not is_synthetic_email('kid@gmail.com')
        assert not is_synthetic_email('')

    def test_student_targets_include_guardians_once(self):
        student, p1, p2 = _family()
        assert [u.pk for u in delivery_users(student)] == [student.pk, p1.pk, p2.pk]
        assert email_recipients(student) == ['mom@test.mx', 'dad@test.mx']

    def test_real_student_email_is_kept(self):
        student, *_ = _family(student_email='kid@gmail.com')
        assert email_recipients(student) == ['kid@gmail.com', 'mom@test.mx', 'dad@test.mx']

    def test_parent_is_just_themselves(self):
        p = ParentFactory(email='solo@test.mx')
        assert email_recipients(p) == ['solo@test.mx']

    def test_inactive_guardian_skipped(self):
        student, p1, p2 = _family()
        p2.is_active = False
        p2.save(update_fields=['is_active'])
        assert email_recipients(student) == ['mom@test.mx']


class TestNotify:
    def test_student_notify_emails_guardians_not_synthetic(self):
        student, p1, p2 = _family()
        mail.outbox.clear()
        notify(student, 'info', 'Saldo bajo', 'Recargue la cafetería')
        assert len(mail.outbox) == 1
        assert sorted(mail.outbox[0].to) == ['dad@test.mx', 'mom@test.mx']
        assert Notification.objects.filter(user=student).count() == 1

    def test_student_notify_pushes_to_everyone(self):
        student, p1, p2 = _family()
        with patch('apps.portal.push.send_web_push') as push:
            notify(student, 'info', 'Hola', 'Msg', email=False)
        assert sorted(c.args[0].pk for c in push.call_args_list) == sorted([student.pk, p1.pk, p2.pk])


class TestDispatch:
    def test_pending_student_row_reaches_guardians(self):
        student, p1, p2 = _family()
        Notification.objects.create(user=student, notif_type='info', title='T', message='M')
        mail.outbox.clear()
        with patch('apps.portal.push.send_web_push'):
            assert dispatch_pending_notifications() == 1
        assert len(mail.outbox) == 1
        assert sorted(mail.outbox[0].to) == ['dad@test.mx', 'mom@test.mx']

    def test_guardian_with_own_announcement_row_not_duplicated(self):
        from apps.portal.models import Announcement

        student, p1, p2 = _family()
        ann = Announcement.objects.create(title='Aviso', body='Cuerpo', audience='all')
        Notification.objects.create(user=student, notif_type='info', title='Aviso', message='C', announcement=ann)
        Notification.objects.create(user=p1, notif_type='info', title='Aviso', message='C', announcement=ann)
        mail.outbox.clear()
        with patch('apps.portal.push.send_web_push'):
            dispatch_pending_notifications()
        to = sorted(addr for m in mail.outbox for addr in m.to)
        # mom once (own row), dad once (via the student's row), student never (synthetic)
        assert to == ['dad@test.mx', 'mom@test.mx']
