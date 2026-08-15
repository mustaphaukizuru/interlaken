"""
core/throttling.py — DRF scoped throttling on the shared rate-limit cache.

The anonymous, abuse-prone public endpoints (login, password reset, contact,
pre-registro, booking create, webhooks) are IP-limited by django-ratelimit
decorators (see apps/core/ratelimit.py). This module covers the *authenticated*
money-initiation endpoints, where the correct key is the **user**, not the IP:
DRF throttles run after DRF authentication, so — unlike a dispatch-level
decorator — they see the JWT-authenticated user.

Usage on a view::

    from apps.core.throttling import SharedScopedRateThrottle

    class MyView(APIView):
        throttle_classes = [SharedScopedRateThrottle]
        throttle_scope = 'payment-initiate'

Rates live in ``REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']`` (base settings).
"""
from django.conf import settings
from django.core.cache import InvalidCacheBackendError, caches
from rest_framework.settings import api_settings
from rest_framework.throttling import ScopedRateThrottle


class SharedScopedRateThrottle(ScopedRateThrottle):
    """``ScopedRateThrottle`` with three project-specific behaviours:

    * counts in the shared ``'ratelimit'`` cache alias when configured
      (production: file-based, shared across gunicorn workers — the default
      LocMem cache is per-process, which would multiply the effective ceiling
      by the worker count), falling back to the default cache in dev/tests;
    * honours ``RATELIMIT_ENABLE = False`` — the same kill-switch the test
      suite already uses for django-ratelimit — so tests aren't throttled
      unless they opt in;
    * re-reads ``DEFAULT_THROTTLE_RATES`` per request so ``@override_settings``
      on ``REST_FRAMEWORK`` works in tests (DRF binds the rates dict at class
      creation otherwise).
    """

    @property
    def cache(self):
        try:
            return caches['ratelimit']
        except InvalidCacheBackendError:
            return caches['default']

    def get_rate(self):
        self.THROTTLE_RATES = api_settings.DEFAULT_THROTTLE_RATES
        return super().get_rate()

    def allow_request(self, request, view):
        if not getattr(settings, 'RATELIMIT_ENABLE', True):
            return True
        return super().allow_request(request, view)
