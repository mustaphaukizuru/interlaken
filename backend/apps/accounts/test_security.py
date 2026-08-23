import time

import pytest
from django.urls import reverse
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.security import LoginEvent, new_secret, totp_code, verify_totp


def test_totp_rfc6238_vector():
    # RFC 6238 SHA1 test secret "12345678901234567890" (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ) at T=59 -> 287082 (8 digits) / 6-digit tail
    secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    assert totp_code(secret, at=59, digits=8) == '94287082'
    assert verify_totp(secret, totp_code(secret))
    assert not verify_totp(secret, '000000') or totp_code(secret) == '000000'
    assert not verify_totp(secret, 'abc')


@pytest.mark.django_db
def test_password_login_records_history_and_requires_totp(api_client, admin_user, settings):
    settings.RATELIMIT_ENABLE = False
    url = reverse('token-obtain')
    r = api_client.post(url, {'email': admin_user.email, 'password': 'wrong'}, format='json')
    assert r.status_code == 401
    assert LoginEvent.objects.filter(email=admin_user.email, success=False, reason='bad_password').exists()
    r = api_client.post(url, {'email': admin_user.email, 'password': 'admin-pass-123'}, format='json')
    assert r.status_code == 200 and 'access' in r.data
    assert LoginEvent.objects.filter(user=admin_user, success=True, method='password').exists()

    # enable TOTP through the API
    api_client.force_authenticate(admin_user)
    setup = api_client.post(reverse('totp-setup'), {}, format='json')
    assert setup.status_code == 200 and setup.data['otpauth_url'].startswith('otpauth://totp/')
    assert api_client.post(reverse('totp-enable'), {'code': '000000'}, format='json').status_code in (400,)
    code = totp_code(setup.data['secret'])
    assert api_client.post(reverse('totp-enable'), {'code': code}, format='json').data['totp_enabled'] is True
    api_client.force_authenticate(None)

    r = api_client.post(url, {'email': admin_user.email, 'password': 'admin-pass-123'}, format='json')
    assert r.status_code == 401 and r.data['totp_required'] is True
    r = api_client.post(url, {'email': admin_user.email, 'password': 'admin-pass-123', 'totp': '123456'}, format='json')
    assert r.status_code == 401 and LoginEvent.objects.filter(reason='bad_totp').exists()
    r = api_client.post(url, {'email': admin_user.email, 'password': 'admin-pass-123', 'totp': totp_code(setup.data['secret'])}, format='json')
    assert r.status_code == 200
    sessions = api_client.get(reverse('my-sessions'), HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    assert sessions.data['totp_enabled'] is True and sessions.data['history'][0]['success'] is True


@pytest.mark.django_db
def test_parent_cannot_setup_totp(auth_client):
    assert auth_client.post(reverse('totp-setup'), {}, format='json').status_code == 403


@pytest.mark.django_db
def test_close_other_sessions_keeps_current(api_client, parent_user, settings):
    t1 = RefreshToken.for_user(parent_user)
    t2 = RefreshToken.for_user(parent_user)
    RefreshToken.for_user(parent_user)
    api_client.force_authenticate(parent_user)
    assert api_client.get(reverse('my-sessions')).data['active_sessions'] == 3
    api_client.cookies[settings.AUTH_REFRESH_COOKIE] = str(t1)
    api_client.cookies[settings.AUTH_CSRF_COOKIE] = 'csrf-1'
    r = api_client.post(reverse('close-other-sessions'), {}, format='json', HTTP_X_CSRF_TOKEN='csrf-1')
    assert r.status_code == 200 and r.data['closed'] == 2
    assert api_client.get(reverse('my-sessions')).data['active_sessions'] == 1
    with pytest.raises(TokenError):
        RefreshToken(str(t2)).check_blacklist()
    assert new_secret() != new_secret()
    time.sleep(0)
