"""QA 2026-11-24 (H1): a reload or «Atrás» during the silent refresh signed families out.

The server rotated the refresh token and blacklisted the old one, the browser
dropped the answer and sent the old cookie again: 401. An old token rotated
less than a minute ago whose successor was never used now gets a fresh
session once; signed-out and moved-on sessions are refused as before.
"""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.conf import settings
from django.urls import reverse
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from apps.accounts.factories import DEFAULT_PASSWORD, ParentFactory

pytestmark = pytest.mark.django_db

REFRESH_COOKIE = settings.AUTH_REFRESH_COOKIE
CSRF_COOKIE = settings.AUTH_CSRF_COOKIE


def _login(client, email='grace@test.mx'):
    ParentFactory(email=email)
    r = client.post(reverse('token-obtain'), {'email': email, 'password': DEFAULT_PASSWORD}, format='json')
    assert r.status_code == 200, r.data
    return r.cookies[CSRF_COOKIE].value, r.cookies[REFRESH_COOKIE].value


def _refresh(client, csrf, refresh):
    client.cookies[REFRESH_COOKIE] = refresh
    client.cookies[CSRF_COOKIE] = csrf
    return client.post(reverse('token-refresh'), {}, format='json', HTTP_X_CSRF_TOKEN=csrf)


def _blacklisted(refresh_value):
    return BlacklistedToken.objects.filter(token__token=refresh_value).exists()


class TestRefreshReuseWindow:
    def test_a_lost_answer_does_not_sign_the_family_out(self, api_client):
        csrf, old = _login(api_client)
        lost = _refresh(api_client, csrf, old)            # the browser never stores this one
        assert lost.status_code == 200
        lost_refresh = lost.cookies[REFRESH_COOKIE].value

        again = _refresh(api_client, csrf, old)           # reload: the old cookie again
        assert again.status_code == 200, again.data
        assert again.data['access']
        fresh = again.cookies[REFRESH_COOKIE].value
        assert fresh not in (old, lost_refresh)
        assert _blacklisted(lost_refresh)                 # the unused successor is closed
        assert _refresh(api_client, again.cookies[CSRF_COOKIE].value, fresh).status_code == 200

    def test_after_the_successor_was_used_the_old_token_is_refused(self, api_client):
        csrf, old = _login(api_client)
        r1 = _refresh(api_client, csrf, old)
        r2 = _refresh(api_client, r1.cookies[CSRF_COOKIE].value, r1.cookies[REFRESH_COOKIE].value)
        assert r2.status_code == 200
        assert _refresh(api_client, csrf, old).status_code == 401

    def test_after_the_window_the_old_token_is_refused(self, api_client):
        csrf, old = _login(api_client)
        assert _refresh(api_client, csrf, old).status_code == 200
        later = timezone.now() + timedelta(seconds=61)
        with patch('apps.accounts.refresh_grace.timezone.now', return_value=later):
            assert _refresh(api_client, csrf, old).status_code == 401

    def test_a_signed_out_token_is_never_revived(self, api_client):
        csrf, current = _login(api_client)
        out = api_client.post(reverse('logout'), {}, format='json', HTTP_X_CSRF_TOKEN=csrf)
        assert out.status_code in (200, 204, 205)
        assert _blacklisted(current)
        assert _refresh(api_client, csrf, current).status_code == 401

    def test_signing_out_after_a_rotation_also_closes_the_old_token(self, api_client):
        csrf, old = _login(api_client)
        r1 = _refresh(api_client, csrf, old)
        new_csrf, new = r1.cookies[CSRF_COOKIE].value, r1.cookies[REFRESH_COOKIE].value
        api_client.cookies[REFRESH_COOKIE] = new
        api_client.cookies[CSRF_COOKIE] = new_csrf
        api_client.post(reverse('logout'), {}, format='json', HTTP_X_CSRF_TOKEN=new_csrf)
        assert _refresh(api_client, csrf, old).status_code == 401

    def test_an_archived_account_gets_no_new_session(self, api_client):
        csrf, old = _login(api_client)
        assert _refresh(api_client, csrf, old).status_code == 200
        user = OutstandingToken.objects.filter(token=old).first().user
        user.archived_at = timezone.now()
        user.save(update_fields=['archived_at'])
        assert _refresh(api_client, csrf, old).status_code == 401
