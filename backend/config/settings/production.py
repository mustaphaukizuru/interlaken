from .base import *

DEBUG = False

# Security headers
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_SSL_REDIRECT = True
# Behind Apache/Passenger, TLS is terminated upstream; trust the forwarded
# proto header so SECURE_SSL_REDIRECT doesn't cause an infinite redirect loop.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = 'DENY'
SECURE_CONTENT_TYPE_NOSNIFF = True

# Defence in depth: pin the httpOnly refresh cookie's Secure flag. base derives
# AUTH_COOKIE_SECURE from DEBUG (forced False above), but pin it so a stray
# DEBUG=True in the prod env can't silently drop Secure — matching the explicit
# SESSION/CSRF cookie flags above.
AUTH_COOKIE_SECURE = True

# ── Rate-limit counter store ──────────────────────────────────────────────
# django-ratelimit counts in the cache; the default LocMemCache is per-process,
# so under Passenger's multiple worker processes each worker keeps its OWN
# counter bucket and the effective ceiling is multiplied by the worker count.
# Back the counters with a host-shared file cache (no Redis on this shared host;
# FileBasedCache needs no createcachetable step and auto-creates its dir) so the
# refresh / google-token / oauth-callback / booking / payment-webhook throttles
# actually hold across workers. Login is separately bounded by DB-backed axes.
CACHES = {
    **CACHES,
    'ratelimit': {
        'BACKEND': 'django.core.cache.backends.filebased.FileBasedCache',
        'LOCATION': env('RATELIMIT_CACHE_DIR', default=str(BASE_DIR / '.ratelimit-cache')),
        'TIMEOUT': 3600,
    },
}
RATELIMIT_USE_CACHE = 'ratelimit'
