"""
core/ratelimit.py — Class-based-view-friendly rate limiting.

`django-ratelimit` raises `Ratelimited` (a subclass of PermissionDenied → 403)
when the default `block=True` is used. Abuse-prone API endpoints should answer
with **429 Too Many Requests** instead, so this decorator runs the limiter in
non-blocking mode and returns an explicit 429 JSON response on exceed.

Usage on a DRF/Django class-based view::

    from django.utils.decorators import method_decorator
    from apps.core.ratelimit import ratelimit

    @method_decorator(ratelimit('login', '10/m', method='POST'), name='dispatch')
    class MyView(APIView):
        ...
"""
from functools import wraps

from django.http import JsonResponse
from django_ratelimit.core import is_ratelimited


def ratelimit(group, rate, key='ip', method='POST'):
    """Return a view-function decorator that emits HTTP 429 when the rate is exceeded.

    `group` is the cache bucket name (keep it unique per endpoint), `rate` is a
    ``count/period`` string (e.g. ``'10/m'``), `key` selects the client
    identity (default: client IP), and `method` limits which HTTP verbs count.
    """
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped(request, *args, **kwargs):
            limited = is_ratelimited(
                request=request,
                group=group,
                key=key,
                rate=rate,
                method=method,
                increment=True,
            )
            if limited:
                return JsonResponse(
                    {'detail': 'Demasiadas solicitudes. Intente de nuevo más tarde.'},
                    status=429,
                )
            return view_func(request, *args, **kwargs)
        return _wrapped
    return decorator
