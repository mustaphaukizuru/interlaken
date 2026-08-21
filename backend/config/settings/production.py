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

# ── Structured logs ───────────────────────────────────────────────────────
# Same handlers/levels as base; only the formatter changes: one JSON object per
# line on stdout (collected by the container runtime), each carrying the X-Request-ID so a
# request's lines can be correlated. Dev keeps the readable console format.
LOGGING['handlers']['console']['formatter'] = 'json'

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

# ── WhiteNoise: serve the SPA's public assets at the web ROOT ──────────────
# The built React app references public files by root-absolute paths — campus
# photos and the logo as /assets/*.webp, plus /icon-192.png, /favicon.ico,
# /site.webmanifest, /robots.txt. Vite's base='/static/' only rewrites *bundled*
# (hashed) asset URLs, NOT these hardcoded public paths, so in production they
# 404 past whitenoise's /static/ handler and fall through to the SPA catch-all —
# which returns index.html (a 200 of the wrong bytes), leaving every image blank.
# WHITENOISE_ROOT serves the built tree (Dockerfile copies dist/ → ./static/) at
# the root URL too, so /assets/foo.webp and /icon-192.png resolve to real files.
# index.html was removed from ./static/ in the image build, so '/' still falls
# through to the Django SPA view (this only adds the missing root file routes).
WHITENOISE_ROOT = BASE_DIR / 'static'
