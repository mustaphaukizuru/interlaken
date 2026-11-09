"""Owner, 2026-10-20: a family may add a personal email for notifications.

Family logins are usually the student's school address. A personal address
receives the account's emails only after its owner confirms it from the
signed link, so nobody can route a family's mail to a mailbox they don't own.

Owner, 2026-11-08: the link works without signing in (a parent opens it on
their own phone, signed out or signed into their own Padre/Tutor login). The
token alone proves the mailbox and names the account; confirming needs a POST
from the public page, never just opening the link.
"""
import re
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core import mail
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.accounts.recipients import email_recipients
from apps.portal.services import notify

pytestmark = pytest.mark.django_db

URL = '/api/v1/accounts/me/notify-email/'
VERIFY = '/api/v1/accounts/me/notify-email/verify/'
CONFIRM = '/api/v1/accounts/notify-email/confirm/'


def _token_from_outbox():
    body = mail.outbox[-1].body
    return re.search(r'confirmar-correo\?token=([^\s]+)', body).group(1)


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
        assert r.json()['code'] == 'superseded'

    def test_the_link_confirms_its_own_account_whoever_is_signed_in(self, api_client, auth_client, parent_user):
        """The case of 2026-11-08: the parent opened the link signed into their own login."""
        auth_client.put(URL, {'email': 'mama@familia.mx'}, format='json')
        token = _token_from_outbox()
        other = ParentFactory()
        api_client.force_authenticate(other)
        r = api_client.post(VERIFY, {'token': token}, format='json')
        assert r.status_code == 200, r.content
        parent_user.refresh_from_db()
        other.refresh_from_db()
        assert parent_user.notify_email_verified_at is not None
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


class TestPublicConfirmation:
    """The page the emailed link opens: works signed out; opening it changes nothing."""

    def _ask(self, auth_client, email='mama@familia.mx'):
        auth_client.put(URL, {'email': email}, format='json')
        return _token_from_outbox()

    def test_preview_says_what_it_confirms_and_changes_nothing(self, api_client, auth_client):
        student = StudentUserFactory(first_name='Carla', last_name='Ramos Terrazas')
        StudentProfileFactory(user=student, grade='1° Secundaria', group='A')
        auth_client.force_authenticate(student)
        token = self._ask(auth_client)
        r = api_client.get(CONFIRM, {'token': token})
        assert r.status_code == 200
        body = r.json()
        assert body['state'] == 'ready'
        assert body['account'] == {'name': 'Carla R.', 'detail': '1° Secundaria · Grupo A', 'is_student': True}
        assert body['email'] == 'ma…@familia.mx'
        assert body['expires_at']
        assert body['separate_account'] is False
        student.refresh_from_db()
        assert student.notify_email_verified_at is None  # a GET (email scanners) never confirms

    def test_post_confirms_signed_out_and_is_idempotent(self, api_client, auth_client, parent_user):
        token = self._ask(auth_client)
        r = api_client.post(CONFIRM, {'token': token}, format='json')
        assert r.status_code == 200, r.content
        assert r.json()['state'] == 'confirmed' and r.json()['verified'] is True
        parent_user.refresh_from_db()
        assert email_recipients(parent_user) == [parent_user.email, 'mama@familia.mx']
        again = api_client.post(CONFIRM, {'token': token}, format='json')
        assert again.status_code == 200 and again.json()['state'] == 'confirmed'
        assert api_client.get(CONFIRM, {'token': token}).json()['state'] == 'confirmed'

    def test_expired_link_says_how_to_get_a_new_one(self, api_client, auth_client):
        token = self._ask(auth_client)
        later = __import__('django.utils.timezone', fromlist=['now']).now() + timedelta(days=3, minutes=1)
        with patch('apps.accounts.notify_email.timezone.now', return_value=later):
            preview = api_client.get(CONFIRM, {'token': token}).json()
            r = api_client.post(CONFIRM, {'token': token}, format='json')
        assert preview['state'] == 'expired' and 'Reenviar enlace' in preview['detail']
        assert r.status_code == 400 and r.json()['code'] == 'expired'

    def test_invalid_link_reveals_nothing(self, api_client):
        r = api_client.get(CONFIRM, {'token': 'no-es-un-token'})
        assert r.json() == {'state': 'invalid'}
        assert api_client.post(CONFIRM, {'token': 'x'}, format='json').json()['code'] == 'invalid'

    def test_an_address_with_its_own_login_is_told_they_stay_separate(self, api_client, auth_client):
        ParentFactory(email='mama@familia.mx')
        token = self._ask(auth_client)
        assert api_client.get(CONFIRM, {'token': token}).json()['separate_account'] is True

    def test_the_email_is_structured_and_needs_no_sign_in(self, auth_client):
        mail.outbox.clear()
        self._ask(auth_client)
        m = mail.outbox[-1]
        html = m.alternatives[0][0]
        assert '/confirmar-correo?token=' in m.body
        assert 'inicie sesión' not in m.body.lower() or 'no necesita iniciar sesión' in m.body.lower()
        assert 'Confirmar este correo' in html and 'Avisos que recibirá' in html
        assert 'no crea una cuenta' in html
        assert 'verificar_correo' not in m.body


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
