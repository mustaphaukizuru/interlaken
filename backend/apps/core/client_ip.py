"""Restore the real client IP when the app runs behind a reverse proxy.

Django takes ``REMOTE_ADDR`` from the TCP peer. Behind a proxy that peer is the
proxy, so every request in the world arrives with the SAME address. Two security
controls silently degrade when that happens, neither of them loudly:

* ``django-ratelimit`` reads ``REMOTE_ADDR`` and every ``key='ip'`` decorator
  collapses into ONE bucket shared by the whole internet. The login limit of
  10/min stops being "10 per visitor" and becomes "10 for the entire school",
  so a single machine issuing ten requests a minute locks every parent out.
* ``django-axes`` locks on ``[['username', 'ip_address']]``. With a constant
  IP that pair degenerates to the username alone, so anyone who knows a parent's
  email can lock that account, and repeat it indefinitely.

Both fail closed, which is the dangerous direction: the site looks healthy while
legitimate parents are refused.

**This middleware is opt-in on purpose.** Reading a client-supplied header and
believing it is worse than the problem it solves: anyone could then claim a
fresh IP per request and bypass rate limiting entirely. It only activates when
``TRUST_PROXY_IP_HEADER`` is true, which is correct only when a trusted proxy
*overwrites* the header on the way in. Our Caddy config does exactly that with
``header_up X-Real-IP {remote_host}`` (a set, not an append), and the app
container publishes no host port, so Caddy is the only possible source.

``X-Forwarded-For`` is deliberately NOT used: proxies append to it, so the
client controls the left-hand entries.
"""
from django.conf import settings


class RealClientIPMiddleware:
    """Copy the trusted proxy's client-IP header over ``REMOTE_ADDR``.

    Must run BEFORE anything that reads ``REMOTE_ADDR`` (axes, ratelimit,
    consent logging), so it belongs at the very top of ``MIDDLEWARE``.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.enabled = bool(getattr(settings, 'TRUST_PROXY_IP_HEADER', False))
        # WSGI-mangled form of the header name, e.g. X-Real-IP -> HTTP_X_REAL_IP.
        header = getattr(settings, 'PROXY_IP_HEADER', 'X-Real-IP')
        self.meta_key = 'HTTP_' + header.upper().replace('-', '_')

    def __call__(self, request):
        if self.enabled:
            forwarded = request.META.get(self.meta_key)
            if forwarded:
                # A misconfigured proxy can still append; take the first entry
                # and ignore anything after a comma.
                candidate = forwarded.split(',')[0].strip()
                if candidate:
                    request.META['REMOTE_ADDR'] = candidate
        return self.get_response(request)
