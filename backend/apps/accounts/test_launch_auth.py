"""Pre-launch fixes (2026-11-09): sign-in with a capitalized email, and per-account rate limits.

- Phones capitalize the first letter («Ci09938@…»). ModelBackend matched the
  email exactly, so the right password failed; the login now passes the stored
  address (matched like the Lower(email) unique constraint). Google too.
- django-ratelimit's key='user' on dispatch() ran before DRF authenticated:
  every family shared one bucket («Correo para avisos»: 5 an hour for the whole
  school). On the handler it is per account.
"""
import time as _time

import pytest
from django.core.cache import cache
from django.urls import reverse

from apps.accounts.factories import DEFAULT_PASSWORD, ParentFactory

pytestmark = pytest.mark.django_db


class _FrozenTime:
    _now = _time.time()

    @staticmethod
    def time():
        return _FrozenTime._now


class TestCapitalizedEmail:
    @pytest.mark.parametrize('typed', ['Ci09938@Interlaken.com.mx', ' CI09938@INTERLAKEN.COM.MX ', 'ci09938@interlaken.com.mx'])
    def test_the_right_password_signs_in_whatever_the_case(self, api_client, typed):
        ParentFactory(email='ci09938@interlaken.com.mx')
        r = api_client.post(reverse('token-obtain'), {'email': typed, 'password': DEFAULT_PASSWORD}, format='json')
        assert r.status_code == 200, r.data
        assert 'access' in r.data
        from apps.accounts.models import User
        assert User.objects.get(email='ci09938@interlaken.com.mx').last_login is not None

    def test_a_wrong_password_is_still_refused(self, api_client):
        ParentFactory(email='ci09938@interlaken.com.mx')
        r = api_client.post(reverse('token-obtain'), {'email': 'Ci09938@interlaken.com.mx', 'password': 'nope'},
                            format='json')
        assert r.status_code == 401

    def test_google_finds_the_account_whatever_the_case(self):
        from apps.accounts.views import _resolve_google_user

        user = ParentFactory(email='mama@test.mx')
        assert _resolve_google_user('Mama@Test.mx', defaults={}) == user


class TestPerAccountRateLimit:
    def test_one_family_reaching_the_limit_does_not_block_another(self, api_client, settings, monkeypatch):
        settings.RATELIMIT_ENABLE = True
        monkeypatch.setattr('django_ratelimit.core.time', _FrozenTime)
        cache.clear()
        url = '/api/v1/accounts/me/notify-email/'
        a, b = ParentFactory(), ParentFactory()

        api_client.force_authenticate(a)
        codes_a = [api_client.put(url, {'email': f'a{i}@familia.mx'}, format='json').status_code for i in range(6)]
        api_client.force_authenticate(b)
        code_b = api_client.put(url, {'email': 'b@familia.mx'}, format='json').status_code

        assert codes_a == [200] * 5 + [429]
        assert code_b == 200  # before the fix: 429, the school shared one bucket
