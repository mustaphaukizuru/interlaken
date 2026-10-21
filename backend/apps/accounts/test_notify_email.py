"""Owner, 2026-10-20: a family may add a personal email for notifications.

Family logins are usually the student's school address. A personal address
receives the account's emails only after its owner confirms it from the
signed link, so nobody can route a family's mail to a mailbox they don't own.
"""
import re

import pytest
from django.core import mail
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.accounts.recipients import email_recipients
from apps.portal.services import notify

pytestmark = pytest.mark.django_db

URL = '/api/v1/accounts/me/notify-email/'
VERIFY = '/api/v1/accounts/me/notify-email/verify/'


def _token_from_outbox():
    body = mail.outbox[-1].body
    return re.search(r'verificar_correo=([^\s]+)', body).group(1)


class TestSetAndVerify:
    def test_put_sends_a_link_and_does_not_mail_until_confirmed(self, auth_client, parent_user):
        mail.outbox.clear()
        r = auth_client.put(URL, {'email': 'Mama@Familia.mx'}, format='json')
        assert r.status_code == 200, r.content
        assert r.json()['email'] == 'mama@familia.mx'
        assert r.json()['verified'] is False
        assert mail.outbox[-1].to == ['mama@familia.mx']
        parent_user.refresh_from_db()
        assert 'mama@familia.mx' not in email_recipients(parent_user)

        r = auth_client.post(VERIFY, {'token': _token_from_outbox()}, format='json')
        assert r.status_code == 200, r.content
        assert r.json()['verified'] is True
        parent_user.refresh_from_db()
        assert email_recipients(parent_user) == [parent_user.email, 'mama@familia.mx']

    def test_changing_the_address_needs_a_new_confirmation(self, auth_client, parent_user):
        auth_client.put(URL, {'email': 'uno@familia.mx'}, format='json')
        old = _token_from_outbox()
        auth_client.put(URL, {'email': 'dos@familia.mx'}, format='json')
        r = auth_client.post(VERIFY, {'token': old}, format='json')
        assert r.status_code == 400
        assert r.json()['code'] == 'mismatch'

    def test_link_of_another_account_is_refused(self, api_client, auth_client, parent_user):
        auth_client.put(URL, {'email': 'mama@familia.mx'}, format='json')
        token = _token_from_outbox()
        other = ParentFactory()
        api_client.force_authenticate(other)
        r = api_client.post(VERIFY, {'token': token}, format='json')
        assert r.status_code == 400
        other.refresh_from_db()
        assert other.notify_email_verified_at is None

    def test_tampered_token_is_refused(self, auth_client):
        auth_client.put(URL, {'email': 'mama@familia.mx'}, format='json')
        r = auth_client.post(VERIFY, {'token': _token_from_outbox() + 'x'}, format='json')
        assert r.status_code == 400
        assert r.json()['code'] == 'invalid'

    def test_same_as_account_and_synthetic_are_refused(self, auth_client, parent_user):
        r = auth_client.put(URL, {'email': parent_user.email.upper()}, format='json')
        assert r.status_code == 400
        assert r.json()['code'] == 'same_as_account'
        r = auth_client.put(URL, {'email': 'a1@alumnos.interlaken.edu.mx'}, format='json')
        assert r.status_code == 400

    def test_delete_stops_it(self, auth_client, parent_user):
        auth_client.put(URL, {'email': 'mama@familia.mx'}, format='json')
        auth_client.post(VERIFY, {'token': _token_from_outbox()}, format='json')
        r = auth_client.delete(URL)
        assert r.json() == {'email': '', 'verified': False}
        parent_user.refresh_from_db()
        assert email_recipients(parent_user) == [parent_user.email]

    def test_requires_login(self, api_client):
        assert api_client.get(URL).status_code in (401, 403)


class TestDelivery:
    def test_student_notification_reaches_the_confirmed_personal_address(self):
        parent = ParentFactory(email='papa@test.mx', notify_email='papa.casa@gmail.com',
                               notify_email_verified_at=timezone.now())
        student = StudentUserFactory(email='ci1@alumnos.interlaken.edu.mx',
                                     notify_email='alumno.casa@gmail.com',
                                     notify_email_verified_at=timezone.now())
        StudentProfileFactory(user=student, parents=[parent])
        mail.outbox.clear()
        notify(student, 'info', 'Saldo bajo', 'Recargue la cafetería')
        assert sorted(mail.outbox[0].to) == ['alumno.casa@gmail.com', 'papa.casa@gmail.com', 'papa@test.mx']

    def test_unconfirmed_personal_address_gets_nothing(self):
        parent = ParentFactory(email='papa@test.mx', notify_email='papa.casa@gmail.com')
        mail.outbox.clear()
        notify(parent, 'info', 'Aviso', 'Hola')
        assert mail.outbox[0].to == ['papa@test.mx']
