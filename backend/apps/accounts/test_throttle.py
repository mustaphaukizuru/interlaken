"""
Login rate limiting: the email/password endpoint answers 429 once the
10/min/IP django-ratelimit window is exhausted (separate from the axes
per-username lockout, which is disabled here by the conftest fixture).
"""
import time as _time

import pytest
from django.core.cache import cache
from django.urls import reverse

pytestmark = pytest.mark.django_db

LOGIN_URL = reverse('token-obtain')


class _FrozenTime:
    """Stand-in for the ``time`` module inside django_ratelimit.core.

    The limiter's counting window is wall-clock based, so a real minute
    rollover mid-test would reset the counter and flake the assertion below.
    Freezing the clock pins all 12 requests into one window.
    """
    _now = _time.time()

    @staticmethod
    def time():
        return _FrozenTime._now


def test_login_returns_429_after_limit(api_client, settings, monkeypatch):
    settings.RATELIMIT_ENABLE = True
    monkeypatch.setattr('django_ratelimit.core.time', _FrozenTime)
    cache.clear()

    codes = [
        api_client.post(
            LOGIN_URL,
            {'email': 'nobody@test.mx', 'password': 'wrong-pass'},
            format='json',
        ).status_code
        for _ in range(12)
    ]

    assert codes[0] == 401                    # normal wrong-credentials answer
    assert codes[:10] == [401] * 10           # 10/min allowed through
    assert all(c == 429 for c in codes[10:])  # then throttled


def test_login_not_throttled_when_disabled(api_client):
    # conftest disables RATELIMIT_ENABLE — the suite default must stay 401.
    codes = [
        api_client.post(
            LOGIN_URL,
            {'email': 'nobody@test.mx', 'password': 'wrong-pass'},
            format='json',
        ).status_code
        for _ in range(12)
    ]
    assert set(codes) == {401}
