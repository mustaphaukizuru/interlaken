"""
core/security_headers.py — Content-Security-Policy + Permissions-Policy
(IK-SEC C4). Deliberately dependency-free: two path-scoped policies beat a
single global one here, because the unfold admin ships Alpine.js (needs
'unsafe-eval') while the public SPA must not get it.

Origins map to real integrations only:
  fonts     — Google Fonts (index.html + admin styles)
  analytics — consent-gated GA4 / Plausible loaders (harmless when disabled)
  sentry    — browser SDK ingest (no-op unless VITE_SENTRY_DSN is set)
  avatars   — Google account photos (User.avatar from OAuth)
  maps      — embedded Google Maps iframe on /contacto

Toggles (env): CSP_ENABLED (default on), CSP_REPORT_ONLY (default off —
flip on for a shakedown period in production if desired).
"""
from django.conf import settings

_FONT_STYLES = 'https://fonts.googleapis.com'
_FONT_FILES = 'https://fonts.gstatic.com'
_ANALYTICS = ('https://www.googletagmanager.com '
              'https://*.google-analytics.com https://plausible.io')
_SENTRY = 'https://*.ingest.sentry.io https://*.ingest.us.sentry.io'
_AVATARS = 'https://lh3.googleusercontent.com'
_MAPS_EMBED = 'https://www.google.com https://maps.google.com'

# Public SPA + API. NOTE: style-src keeps 'unsafe-inline' because React
# components set style attributes (token-driven inline styles); script-src
# stays free of unsafe-* — scripts load only from our origin + the
# consent-gated analytics origins.
PUBLIC_CSP = '; '.join([
    "default-src 'self'",
    f"script-src 'self' {_ANALYTICS}",
    f"style-src 'self' 'unsafe-inline' {_FONT_STYLES}",
    f"font-src 'self' {_FONT_FILES}",
    f"img-src 'self' data: blob: {_AVATARS}",
    f"connect-src 'self' {_ANALYTICS} {_SENTRY}",
    f"frame-src {_MAPS_EMBED}",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self'",
])

# unfold admin: Alpine.js evaluates x-data/x-show expressions → needs
# 'unsafe-eval'; the admin also inlines small scripts → 'unsafe-inline'.
# Confined strictly to /admin/ paths.
ADMIN_CSP = '; '.join([
    "default-src 'self'",
    f"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    f"style-src 'self' 'unsafe-inline' {_FONT_STYLES}",
    f"font-src 'self' {_FONT_FILES}",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
])

PERMISSIONS_POLICY = ('camera=(), microphone=(), geolocation=(), '
                      'payment=(), usb=(), magnetometer=()')


class SecurityHeadersMiddleware:
    """Attach CSP + Permissions-Policy to every response."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.enabled = getattr(settings, 'CSP_ENABLED', True)
        self.header = ('Content-Security-Policy-Report-Only'
                       if getattr(settings, 'CSP_REPORT_ONLY', False)
                       else 'Content-Security-Policy')

    def __call__(self, request):
        response = self.get_response(request)
        if self.enabled and self.header not in response:
            response[self.header] = ADMIN_CSP if self._is_admin(request.path) else PUBLIC_CSP
        response.setdefault('Permissions-Policy', PERMISSIONS_POLICY)
        return response

    @staticmethod
    def _is_admin(path):
        # Match the real Django admin mount only. The admin is mounted at
        # path('admin/', …) so it lives exclusively under '/admin/'; a bare
        # startswith('/admin') would also match public SPA paths like
        # /administracion or /admin-foo (served index.html by the catch-all)
        # and hand them the relaxed unsafe-eval policy. Note '/admin' with NO
        # trailing slash is ALSO a public SPA route — the catch-all's negative
        # lookahead only excludes 'admin/', so bare 'admin' falls through to
        # index.html — hence it too must get the strict policy. Key solely on
        # the '/admin/' prefix, mirroring the catch-all's own guard.
        return path.startswith('/admin/')
