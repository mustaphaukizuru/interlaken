"""Phase A: password reset / activation + notification preferences."""
import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.factories import ParentFactory
from apps.accounts.models import NotificationPreference, PasswordResetToken
from apps.accounts.password_reset import issue_reset_token
from apps.portal.models import Notification
from apps.portal.services import notify

pytestmark = pytest.mark.django_db


class TestPasswordReset:
    def test_request_always_200_and_sends_when_user_exists(self, api_client):
        user = ParentFactory(email='reset@test.mx')
        mail.outbox.clear()
        resp = api_client.post(reverse('password-reset'), {'email': 'reset@test.mx'}, format='json')
        assert resp.status_code == 200
        assert PasswordResetToken.objects.filter(user=user).count() == 1
        assert len(mail.outbox) == 1
        assert 'restablecer-contrasena' in mail.outbox[0].body

    def test_request_unknown_email_still_200_no_mail(self, api_client):
        mail.outbox.clear()
        resp = api_client.post(reverse('password-reset'), {'email': 'nobody@test.mx'}, format='json')
        assert resp.status_code == 200
        assert len(mail.outbox) == 0

    def test_confirm_sets_password_for_unusable_account(self, api_client):
        user = ParentFactory(email='activate@test.mx')
        user.set_unusable_password()
        user.save()
        raw = issue_reset_token(user)
        resp = api_client.post(
            reverse('password-reset-confirm'),
            {'uid': user.id, 'token': raw, 'password': 'NuevaClaveSegura9'},
            format='json',
        )
        assert resp.status_code == 200, resp.data
        user.refresh_from_db()
        assert user.has_usable_password()
        assert user.check_password('NuevaClaveSegura9')
        # Token is single-use
        resp2 = api_client.post(
            reverse('password-reset-confirm'),
            {'uid': user.id, 'token': raw, 'password': 'OtraClaveSegura9'},
            format='json',
        )
        assert resp2.status_code == 400

    def test_authenticated_set_password(self, api_client):
        user = ParentFactory(email='setpass@test.mx')
        api_client.force_authenticate(user=user)
        resp = api_client.post(reverse('set-password'), {'password': 'OtraClaveSegura9'}, format='json')
        assert resp.status_code == 200
        user.refresh_from_db()
        assert user.check_password('OtraClaveSegura9')


class TestNotificationPreferences:
    def test_prefs_gate_email_and_in_app(self, api_client):
        user = ParentFactory(email='prefs@test.mx')
        prefs = NotificationPreference.for_user(user)
        prefs.email_enabled = False
        prefs.in_app_enabled = False
        prefs.push_enabled = False
        prefs.save()

        mail.outbox.clear()
        result = notify(user, 'info', 'Hola', 'Mensaje', email=True)
        assert result is None
        assert Notification.objects.filter(user=user).count() == 0
        assert len(mail.outbox) == 0

    def test_patch_prefs(self, api_client):
        user = ParentFactory(email='prefs2@test.mx')
        api_client.force_authenticate(user=user)
        resp = api_client.patch(
            reverse('notification-preferences'),
            {'email_enabled': False},
            format='json',
        )
        assert resp.status_code == 200
        assert resp.data['email_enabled'] is False
        prefs = NotificationPreference.objects.get(user=user)
        assert prefs.email_enabled is False
