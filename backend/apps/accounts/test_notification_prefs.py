"""Notification preferences (channel toggles consumed by portal.services.notify).

Also pins the school policy that the self-service password endpoints no longer exist.
"""
import pytest
from django.core import mail
from django.urls import NoReverseMatch, reverse

from apps.accounts.factories import ParentFactory
from apps.accounts.models import NotificationPreference
from apps.portal.models import Notification
from apps.portal.services import notify

pytestmark = pytest.mark.django_db


class TestNoSelfServicePassword:
    @pytest.mark.parametrize('name', ['password-reset', 'password-reset-confirm', 'set-password'])
    def test_routes_are_gone(self, name):
        with pytest.raises(NoReverseMatch):
            reverse(name)

    def test_paths_404(self, api_client):
        user = ParentFactory(email='nopw@test.mx')
        api_client.force_authenticate(user=user)
        for path in ('/api/v1/accounts/password-reset/', '/api/v1/accounts/set-password/'):
            assert api_client.post(path, {'password': 'x'}, format='json').status_code == 404


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
