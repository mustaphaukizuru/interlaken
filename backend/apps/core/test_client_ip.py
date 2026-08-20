"""Behind a proxy, REMOTE_ADDR is the proxy for every visitor on earth.

That collapses every ``key='ip'`` rate limit into one global bucket and reduces
the axes ``(username, ip_address)`` lockout to the username alone. These tests
pin both the fix and the safety interlock that keeps it from becoming a way for
clients to forge their own address.
"""
import pytest
from django.test import RequestFactory

from apps.core.client_ip import RealClientIPMiddleware

PROXY = '172.18.0.3'          # the Caddy container, identical for all traffic
CLIENT = '189.203.44.17'      # a real parent on the internet


def _run(settings, meta):
    request = RequestFactory().get('/', **meta)
    seen = {}

    def view(req):
        seen['remote_addr'] = req.META.get('REMOTE_ADDR')
        return 'ok'

    RealClientIPMiddleware(view)(request)
    return seen['remote_addr']


def test_enabled_restores_the_real_client_ip(settings):
    settings.TRUST_PROXY_IP_HEADER = True
    assert _run(settings, {'REMOTE_ADDR': PROXY, 'HTTP_X_REAL_IP': CLIENT}) == CLIENT


def test_disabled_by_default_so_a_header_cannot_forge_an_ip(settings):
    """The dangerous direction. With no trusted proxy in front, honouring the
    header would let any client present a fresh IP per request and walk straight
    through every rate limit."""
    settings.TRUST_PROXY_IP_HEADER = False
    assert _run(settings, {'REMOTE_ADDR': PROXY, 'HTTP_X_REAL_IP': CLIENT}) == PROXY


def test_missing_header_leaves_remote_addr_untouched(settings):
    settings.TRUST_PROXY_IP_HEADER = True
    assert _run(settings, {'REMOTE_ADDR': PROXY}) == PROXY


def test_empty_header_leaves_remote_addr_untouched(settings):
    settings.TRUST_PROXY_IP_HEADER = True
    assert _run(settings, {'REMOTE_ADDR': PROXY, 'HTTP_X_REAL_IP': '   '}) == PROXY


def test_appended_header_takes_the_first_entry(settings):
    """Caddy sets a single value, but a future proxy change could append."""
    settings.TRUST_PROXY_IP_HEADER = True
    meta = {'REMOTE_ADDR': PROXY, 'HTTP_X_REAL_IP': f'{CLIENT}, 10.0.0.9'}
    assert _run(settings, meta) == CLIENT


def test_runs_before_axes_and_ratelimit_read_the_address(settings):
    """Order is the whole point: a later position would fix nothing."""
    from django.conf import settings as live

    mw = live.MIDDLEWARE
    assert mw[0] == 'apps.core.client_ip.RealClientIPMiddleware'
    assert mw.index('apps.core.client_ip.RealClientIPMiddleware') < mw.index(
        'axes.middleware.AxesMiddleware')


@pytest.mark.django_db
def test_two_visitors_get_independent_rate_limit_buckets(settings):
    """The regression this exists to prevent: distinct clients must not share
    one bucket. django-ratelimit reads REMOTE_ADDR, so this is the real check."""
    from django_ratelimit.core import get_usage

    settings.TRUST_PROXY_IP_HEADER = True
    settings.RATELIMIT_ENABLE = True

    def usage_for(client_ip):
        request = RequestFactory().post(
            '/', REMOTE_ADDR=PROXY, HTTP_X_REAL_IP=client_ip)
        RealClientIPMiddleware(lambda r: None)(request)
        return get_usage(request, group='test-bucket', key='ip',
                         rate='5/m', method='POST', increment=True)

    first = usage_for(CLIENT)
    second = usage_for('201.140.9.4')
    # Both are the first request from their own address.
    assert first['count'] == 1
    assert second['count'] == 1, 'distinct clients shared one rate-limit bucket'
