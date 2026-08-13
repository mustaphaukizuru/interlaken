"""
Colegio Interlaken — Base Django Settings
"""
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR.parent / '.env')

SECRET_KEY = env('SECRET_KEY')
DEBUG = env('DEBUG')
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost'])

# ── APPLICATIONS ──────────────────────────────────────────
DJANGO_APPS = [
    'unfold',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

THIRD_PARTY_APPS = [
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    'social_django',
    'drf_spectacular',
    'axes',
]

LOCAL_APPS = [
    'apps.core',
    'apps.content',
    'apps.accounts',
    'apps.admissions',
    'apps.cafeteria',
    'apps.payments',
    'apps.portal',
    'apps.bookings',
    'apps.whatsapp',
    'apps.finance',
    'apps.legal',
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ── MIDDLEWARE ────────────────────────────────────────────
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    # CSP + Permissions-Policy on every response (apps/core/security_headers.py).
    'apps.core.security_headers.SecurityHeadersMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'social_django.middleware.SocialAuthExceptionMiddleware',
    # Turns axes lockout signals into a 429 response (brute-force protection).
    'axes.middleware.AxesMiddleware',
    # Exposes the request so audit records can attribute the acting user (IK-SEC A3).
    'apps.core.audit.AuditActorMiddleware',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'

# ── TEMPLATES ─────────────────────────────────────────────
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'social_django.context_processors.backends',
                'social_django.context_processors.login_redirect',
            ],
        },
    },
]

# ── DATABASE ──────────────────────────────────────────────
# Postgres (Supabase / Render) needs SSL — default sslmode=require; override
# with DB_SSLMODE=disable for a local Postgres. Local dev uses SQLite
# (development.py); no MySQL driver is installed.
_DB_ENGINE = env('DB_ENGINE', default='django.db.backends.postgresql')
if 'postgresql' in _DB_ENGINE or 'postgres' in _DB_ENGINE:
    _DB_OPTIONS = {'sslmode': env('DB_SSLMODE', default='require')}
else:
    _DB_OPTIONS = {}
DATABASES = {
    'default': {
        'ENGINE': _DB_ENGINE,
        'NAME': env('DB_NAME'),
        'USER': env('DB_USER', default=''),
        'PASSWORD': env('DB_PASSWORD', default=''),
        'HOST': env('DB_HOST', default='localhost'),
        'PORT': env('DB_PORT', default='5432'),
        'OPTIONS': _DB_OPTIONS,
    }
}

# ── AUTH ──────────────────────────────────────────────────
AUTH_USER_MODEL = 'accounts.User'

AUTHENTICATION_BACKENDS = [
    # Axes must come first: it raises on locked-out credentials before any
    # real backend sees them (brute-force protection, IK-SEC C2/C6).
    'axes.backends.AxesStandaloneBackend',
    'social_core.backends.google.GoogleOAuth2',
    'django.contrib.auth.backends.ModelBackend',
]

# ── LOGIN LOCKOUT (django-axes) ───────────────────────────
# Counts failures on both the Django admin login and the JWT email/password
# endpoint (simplejwt calls authenticate() with the DRF request). Lockout is
# per username+IP pair, so an attacker can't lock a user out globally and a
# shared school NAT doesn't lock out everyone at once.
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = timedelta(minutes=15)
AXES_LOCKOUT_PARAMETERS = [['username', 'ip_address']]
AXES_RESET_ON_SUCCESS = True

# ── SECURITY HEADERS (IK-SEC C4) ──────────────────────────
# CSP + Permissions-Policy via apps.core.security_headers; policies are
# path-scoped (public/API strict; /admin relaxed for unfold's Alpine.js).
CSP_ENABLED = env.bool('CSP_ENABLED', default=True)
CSP_REPORT_ONLY = env.bool('CSP_REPORT_ONLY', default=False)
SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'

# Default '' so the app boots without Google OAuth configured (email/password
# login still works); social-auth's Google backend simply stays inactive until set.
SOCIAL_AUTH_GOOGLE_OAUTH2_KEY = env('GOOGLE_CLIENT_ID', default='')
SOCIAL_AUTH_GOOGLE_OAUTH2_SECRET = env('GOOGLE_CLIENT_SECRET', default='')
SOCIAL_AUTH_GOOGLE_OAUTH2_SCOPE = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
]
SOCIAL_AUTH_GOOGLE_OAUTH2_EXTRA_DATA = ['first_name', 'last_name', 'picture']

# Google OAuth (read by apps/accounts/views.py). Redirect URI MUST end with '/'
# to match the Django route /auth/google/callback/ and Google Cloud Console.
GOOGLE_CLIENT_ID = env('GOOGLE_CLIENT_ID', default='')
GOOGLE_CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET', default='')
GOOGLE_REDIRECT_URI = env('GOOGLE_REDIRECT_URI', default='http://localhost:8000/auth/google/callback/')
# Domains allowed to self-provision a PARENT on first Google login. Empty
# (default) = invite-only: the email must already exist (admin import / guardian
# link / CSV). Example: GOOGLE_AUTO_CREATE_DOMAINS=interlaken.edu.mx
GOOGLE_AUTO_CREATE_DOMAINS = env.list('GOOGLE_AUTO_CREATE_DOMAINS', default=[])
FRONTEND_URL = env('FRONTEND_URL', default='http://localhost:3000')

LOGIN_URL = '/auth/login/'
LOGIN_REDIRECT_URL = '/portal/'
LOGOUT_REDIRECT_URL = '/'

# ── REST FRAMEWORK ────────────────────────────────────────
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'Colegio Interlaken API',
    'DESCRIPTION': 'REST API del portal escolar: admisiones, cafetería, '
                   'colegiaturas, reservas de visitas, portal y legal.',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
    'SCHEMA_PATH_PREFIX': '/api/v1',
}

SIMPLE_JWT = {
    # Access token is short-lived and kept in memory on the client (never in
    # localStorage); the httpOnly refresh cookie mints a fresh one silently.
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# ── AUTH COOKIES (httpOnly refresh + double-submit CSRF) ───
# The refresh token lives ONLY in an httpOnly cookie (never readable by JS, never
# in a URL). A second, JS-readable CSRF cookie is echoed back in the X-CSRF-Token
# header on refresh/logout (double-submit) so a cross-site page can't drive them.
# See AUTH.md.
AUTH_REFRESH_COOKIE = env('AUTH_REFRESH_COOKIE', default='interlaken_refresh')
AUTH_CSRF_COOKIE = env('AUTH_CSRF_COOKIE', default='interlaken_csrf')
AUTH_COOKIE_SECURE = env.bool('AUTH_COOKIE_SECURE', default=not env.bool('DEBUG', default=False))
AUTH_COOKIE_SAMESITE = env('AUTH_COOKIE_SAMESITE', default='Lax')
AUTH_COOKIE_DOMAIN = env('AUTH_COOKIE_DOMAIN', default=None)
AUTH_COOKIE_PATH = env('AUTH_COOKIE_PATH', default='/')

# ── FIELD ENCRYPTION (at-rest, e.g. medical data — IK-LEGAL B4) ───
# Dedicated Fernet key (urlsafe base64, 32 bytes). If blank, derived from
# SECRET_KEY (dev/test). Set a real key in prod; see apps/core/fields.py.
FIELD_ENCRYPTION_KEY = env('FIELD_ENCRYPTION_KEY', default='')

# ── CORS ──────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS', default=['http://localhost:5173'])
CORS_ALLOW_CREDENTIALS = True

# HTTPS origins Django trusts for unsafe (POST) requests — needed by the Django
# admin form on the deployed domain (the same-origin SPA + JWT API don't need
# it). Comma-separated, full scheme, e.g. https://interlaken.onrender.com
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[])

# ── STATIC & MEDIA ────────────────────────────────────────
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

MEDIA_URL = env('MEDIA_URL', default='/media/')
MEDIA_ROOT = env('MEDIA_ROOT', default=str(BASE_DIR / 'media'))

# ── OBJECT STORAGE FOR MEDIA (uploaded documents) ─────────
# Render's container filesystem is EPHEMERAL — anything written to MEDIA_ROOT
# (admissions documents: birth certificates, CURP, proof of address — legally
# retained, ARCO-scoped) is wiped on every deploy/restart/spin-down. Set the
# S3-compatible env vars below to store uploads in durable object storage.
# Supabase Storage is S3-compatible: create a PRIVATE bucket + S3 access keys in
# the Supabase dashboard (Storage → S3 Connection) and point AWS_S3_ENDPOINT_URL
# at https://<project-ref>.supabase.co/storage/v1/s3. Empty bucket name → local
# disk (dev/test/CI). Files stay private; DocumentDownloadView proxies them
# behind the existing role + MEDICAL_DATA consent checks.
AWS_STORAGE_BUCKET_NAME = env('AWS_STORAGE_BUCKET_NAME', default='')
if AWS_STORAGE_BUCKET_NAME:
    DEFAULT_FILE_STORAGE = 'storages.backends.s3boto3.S3Boto3Storage'
    AWS_ACCESS_KEY_ID = env('AWS_ACCESS_KEY_ID', default='')
    AWS_SECRET_ACCESS_KEY = env('AWS_SECRET_ACCESS_KEY', default='')
    AWS_S3_ENDPOINT_URL = env('AWS_S3_ENDPOINT_URL', default='')
    AWS_S3_REGION_NAME = env('AWS_S3_REGION_NAME', default='')
    # Custom S3-compatible endpoints (Supabase / MinIO) need path-style addressing.
    AWS_S3_ADDRESSING_STYLE = env('AWS_S3_ADDRESSING_STYLE', default='path')
    AWS_DEFAULT_ACL = None            # rely on the bucket's private policy
    AWS_S3_FILE_OVERWRITE = False     # never clobber a same-named upload
    AWS_QUERYSTRING_AUTH = True       # signed, expiring URLs for private objects
    AWS_QUERYSTRING_EXPIRE = env.int('AWS_QUERYSTRING_EXPIRE', default=3600)

# ── EMAIL ─────────────────────────────────────────────────
# Env-driven so the documented EMAIL_BACKEND key works (development.py still
# forces the console backend locally).
EMAIL_BACKEND = env('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = env('EMAIL_HOST', default='localhost')
EMAIL_PORT = env.int('EMAIL_PORT', default=587)
EMAIL_USE_TLS = env.bool('EMAIL_USE_TLS', default=True)
EMAIL_HOST_USER = env('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', default='')
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='noreply@interlaken.edu.mx')

# ── WEB PUSH (VAPID) ──────────────────────────────────────
# Inert until keys are set. Generate once (see apps/portal/push.py docstring);
# the public key is also exposed to the SPA as VITE_VAPID_PUBLIC_KEY.
VAPID_PUBLIC_KEY = env('VAPID_PUBLIC_KEY', default='')
VAPID_PRIVATE_KEY = env('VAPID_PRIVATE_KEY', default='')
VAPID_ADMIN_EMAIL = env('VAPID_ADMIN_EMAIL', default='colegio@interlaken.edu.mx')
# Where public contact-form messages are delivered (falls back to DEFAULT_FROM_EMAIL).
CONTACT_EMAIL = env('CONTACT_EMAIL', default='')

# ── LOYVERSE ──────────────────────────────────────────────
LOYVERSE_API_TOKEN = env('LOYVERSE_API_TOKEN', default='')
LOYVERSE_BASE_URL = 'https://api.loyverse.com/v1.0'
# Go-live watermark for cafeteria purchase polling. On the FIRST sync_purchases run
# (no purchases recorded yet) the poll starts here instead of backfilling all
# history — opening balances are seeded from Loyverse points, which already include
# past spend, so a backfill would double-debit. Set to the go-live moment as an
# ISO-8601 datetime (e.g. 2026-08-01T00:00:00Z); blank → start from "now".
CAFETERIA_SYNC_PURCHASES_SINCE = env('CAFETERIA_SYNC_PURCHASES_SINCE', default='')
# Shared secret guarding the near-real-time Loyverse receipts webhook. Sent by
# Loyverse in the X-Webhook-Token header; blank disables the endpoint (fail-closed),
# so the ~10-min poll stays the fallback until this is configured.
LOYVERSE_WEBHOOK_SECRET = env('LOYVERSE_WEBHOOK_SECRET', default='')
# When True, per-purchase cafeteria alerts are suppressed in favour of a single
# daily/weekly spending digest (send_spending_digest cron). Default False keeps
# the immediate per-purchase notification behaviour.
CAFETERIA_PURCHASE_DIGEST = env.bool('CAFETERIA_PURCHASE_DIGEST', default=False)

# ── PAYMENTS ──────────────────────────────────────────────
# Which gateway a top-up defaults to when the client doesn't specify one.
DEFAULT_PAYMENT_GATEWAY = env('DEFAULT_PAYMENT_GATEWAY', default='global_payments')

# Master sandbox/live switch for hosted checkout URLs. When false (default),
# create_checkout forces sandbox URLs and ignores live merchant HPP/checkout
# hosts that may be sitting in env — see payments/gateways/*.py.
PAYMENTS_LIVE = env.bool('PAYMENTS_LIVE', default=False)

# Public origin of this Django API (webhook status_url in HPP session payloads).
# On cPanel the SPA and API share interlaken.edu.mx — set explicitly in prod.
BACKEND_URL = env('BACKEND_URL', default='')

# Global Payments (Hosted Payment Page).
# Sandbox: leave PAYMENTS_LIVE=false; empty HPP_URL → local /pago/simulado mock.
# Live: set PAYMENTS_LIVE=true + real GLOBAL_PAYMENTS_HPP_URL + APP_ID/KEY.
# Optional GLOBAL_PAYMENTS_SESSION_URL: POST GP-API-shaped session; otherwise
# create_checkout assembles a query-string redirect (mock/sandbox).
GLOBAL_PAYMENTS_APP_ID = env('GLOBAL_PAYMENTS_APP_ID', default='')
GLOBAL_PAYMENTS_APP_KEY = env('GLOBAL_PAYMENTS_APP_KEY', default='')
GLOBAL_PAYMENTS_ENV = env('GLOBAL_PAYMENTS_ENV', default='sandbox')
GLOBAL_PAYMENTS_HPP_URL = env('GLOBAL_PAYMENTS_HPP_URL', default='')
GLOBAL_PAYMENTS_SESSION_URL = env('GLOBAL_PAYMENTS_SESSION_URL', default='')
GLOBAL_PAYMENTS_API_VERSION = env('GLOBAL_PAYMENTS_API_VERSION', default='2021-03-22')

# Banorte "Pago en Línea" hosted checkout.
# Sandbox: leave PAYMENTS_LIVE=false; empty CHECKOUT_URL → local /pago/simulado.
# Live: set PAYMENTS_LIVE=true + real BANORTE_CHECKOUT_URL + MERCHANT_ID.
# Optional BANORTE_SESSION_URL + BANORTE_API_KEY for provider session create.
BANORTE_MERCHANT_ID = env('BANORTE_MERCHANT_ID', default='')
BANORTE_ENV = env('BANORTE_ENV', default='sandbox')
BANORTE_CHECKOUT_URL = env('BANORTE_CHECKOUT_URL', default='')
BANORTE_SESSION_URL = env('BANORTE_SESSION_URL', default='')
BANORTE_API_KEY = env('BANORTE_API_KEY', default='')

# Where the hosted page returns the parent after payment (the frontend reads the
# status). Defaults to the parent cafeteria return route on FRONTEND_URL.
PAYMENT_RETURN_URL = env(
    'PAYMENT_RETURN_URL',
    default=f'{FRONTEND_URL}/portal/cafeteria/recarga/retorno',
)

# Shared secrets for verifying inbound payment webhooks (HMAC-SHA256 of the raw
# request body, hex digest, in the X-Webhook-Signature header). Empty → the
# webhook fails closed (rejects everything) until a secret is configured.
GLOBAL_PAYMENTS_WEBHOOK_SECRET = env('GLOBAL_PAYMENTS_WEBHOOK_SECRET', default='')
BANORTE_WEBHOOK_SECRET = env('BANORTE_WEBHOOK_SECRET', default='')

# Where the hosted page returns the parent after paying a tuition invoice.
TUITION_RETURN_URL = env(
    'TUITION_RETURN_URL',
    default=f'{FRONTEND_URL}/portal/colegiaturas/retorno',
)

# ── FINANCE / TUITION (Prompt 17) ─────────────────────────
# Days *before* the due date to send the "próxima a vencer" reminder, and days
# *after* the due date to send the "vencida" reminder. send_payment_reminders is
# a cron command; each reminder is deduped per invoice.
TUITION_REMINDER_BEFORE_DAYS = env.int('TUITION_REMINDER_BEFORE_DAYS', default=3)
TUITION_REMINDER_OVERDUE_DAYS = env.int('TUITION_REMINDER_OVERDUE_DAYS', default=1)

# ── GOOGLE CALENDAR ───────────────────────────────────────
# Server-side calendar writes for confirmed bookings use a *service account*
# (NOT the OAuth login client). Both empty → calendar integration is a no-op and
# bookings still succeed (fail-soft, picked up later by `manage.py sync_calendar`).
# See BOOKING_CALENDAR_SPEC.md §3 / DEPLOYMENT.md §8 for the GCP setup. Never
# commit the key file — GOOGLE_CALENDAR_SA_KEY is a path read from the env.
GOOGLE_CALENDAR_ID = env('GOOGLE_CALENDAR_ID', default='')
GOOGLE_CALENDAR_SA_KEY = env('GOOGLE_CALENDAR_SA_KEY', default='')

# ── WHATSAPP ──────────────────────────────────────────────
# Tier 1 (deep link): WHATSAPP_NUMBER powers the wa.me "Reservar por WhatsApp"
# button — zero external setup. Tier 2 (conversational Cloud API bot) is behind
# the keys below; all empty → the webhook still verifies signatures and answers
# Meta's handshake, but outbound sends are no-ops (no crash). See
# BOOKING_CALENDAR_SPEC.md §5 / DEPLOYMENT.md §9 for the Meta WABA setup.
WHATSAPP_NUMBER = env('WHATSAPP_NUMBER', default='')
# Meta WhatsApp Business (Cloud API) credentials — Tier 2 self-service booking.
WHATSAPP_TOKEN = env('WHATSAPP_TOKEN', default='')            # permanent/system-user access token
WHATSAPP_PHONE_ID = env('WHATSAPP_PHONE_ID', default='')      # the WABA phone number id
WHATSAPP_VERIFY_TOKEN = env('WHATSAPP_VERIFY_TOKEN', default='')  # GET handshake shared secret
WHATSAPP_APP_SECRET = env('WHATSAPP_APP_SECRET', default='')  # HMAC secret for X-Hub-Signature-256
# Graph API version used for outbound Cloud API calls.
WHATSAPP_API_VERSION = env('WHATSAPP_API_VERSION', default='v19.0')

# ── INTERNATIONALISATION ──────────────────────────────────
LANGUAGE_CODE = 'es-mx'
TIME_ZONE = 'America/Mexico_City'
USE_I18N = True
USE_TZ = True

# ── SECURITY ──────────────────────────────────────────────
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ── ERROR MONITORING (Sentry) ─────────────────────────────
# Fully optional: without SENTRY_DSN set, this block is a no-op and the SDK is
# never even imported. PII is scrubbed (send_default_pii=False) and a before_send
# hook strips anything that looks like a secret from the outgoing event.
SENTRY_DSN = env('SENTRY_DSN', default='')
if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration

    _SENSITIVE_KEYS = (
        'password', 'secret', 'token', 'authorization', 'api_key', 'apikey',
        'credential', 'cookie', 'ssn', 'curp',
    )

    def _scrub_sensitive(event, _hint):
        """Best-effort removal of secret-looking values before an event is sent."""
        request = event.get('request') or {}
        headers = request.get('headers')
        if isinstance(headers, dict):
            for key in list(headers):
                if any(s in key.lower() for s in _SENSITIVE_KEYS):
                    headers[key] = '[Filtered]'
        extra = event.get('extra')
        if isinstance(extra, dict):
            for key in list(extra):
                if any(s in key.lower() for s in _SENSITIVE_KEYS):
                    extra[key] = '[Filtered]'
        return event

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[DjangoIntegration()],
        environment=env('SENTRY_ENVIRONMENT', default='development' if DEBUG else 'production'),
        release=env('SENTRY_RELEASE', default=None),
        traces_sample_rate=env.float('SENTRY_TRACES_SAMPLE_RATE', default=0.0),
        send_default_pii=False,
        before_send=_scrub_sensitive,
    )

# ── CACHE ─────────────────────────────────────────────────
# Per-process in-memory cache. Today it backs the 60s micro-cache on the
# staff analytics endpoint (apps/portal/analytics.py); on cPanel/Passenger
# each process keeps its own copy, which is acceptable for short-TTL
# read-only aggregates.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'interlaken-default',
    }
}

# ── FILE UPLOAD ───────────────────────────────────────────
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024   # 10 MB (memory-vs-temp threshold)
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx']
# Hard cap on an admissions document upload. The *_MAX_MEMORY_SIZE settings
# above are NOT size limits (Django excludes file fields from DATA_UPLOAD and
# FILE_UPLOAD only picks memory vs temp file), so the upload view must enforce
# this itself — otherwise an invited applicant could fill the disk.
MAX_DOCUMENT_UPLOAD_SIZE = 10 * 1024 * 1024      # 10 MB per file

# ── UNFOLD ADMIN SKIN ─────────────────────────────────────
# django-unfold configuration. Every color below is a project design token
# (docs/DESIGN.md §1 / frontend/tailwind.config.js): the purple `brand` ramp
# drives `primary`, and the cream/line/ink/dark neutrals drive `base` surfaces
# in both light and dark mode. Each stop is annotated with its source token —
# no values exist here that are not already in the token layer.
from django.templatetags.static import static as _static  # noqa: E402
from django.urls import reverse_lazy  # noqa: E402

UNFOLD = {
    'SITE_TITLE': 'Admin · Interlaken',
    'SITE_HEADER': 'Colegio Interlaken',
    'SITE_SUBHEADER': 'Panel de Administración',
    'SITE_URL': '/',
    # Official clock isotipo works on light and dark surfaces alike.
    'SITE_ICON': {
        'light': lambda request: _static('admin/logo-isotipo.png'),
        'dark': lambda request: _static('admin/logo-isotipo.png'),
    },
    'SITE_FAVICONS': [
        {'rel': 'icon', 'sizes': '32x32', 'type': 'image/png',
         'href': lambda request: _static('admin/logo-isotipo.png')},
    ],
    'SHOW_HISTORY': True,
    'SHOW_VIEW_ON_SITE': False,
    'STYLES': [
        # Brand typography (Poppins display / Inter body) — static asset, not a
        # template override; see backend/static/admin/unfold-interlaken.css.
        lambda request: _static('admin/unfold-interlaken.css'),
    ],
    'COLORS': {
        # Purple brand ramp = frontend `brand-*` scale (tailwind.config.js).
        'primary': {
            '50':  '#ede8f7',   # brand-50 / --purple-light
            '100': '#e7e2f7',   # brand-100 / --purple-xlight
            '200': '#d9cff0',   # brand-200
            '300': '#b9a5e0',   # brand-300
            '400': '#8f6fd0',   # brand-400
            '500': '#5e3aad',   # brand-500 / --purple-mid
            '600': '#401a8e',   # brand-600 / --purple (anchor)
            '700': '#37167a',   # brand-700
            '800': '#2c1163',   # brand-800
            '900': '#1f0c47',   # brand-900
            '950': '#1a1035',   # dark-3 (deep brand surface)
        },
        # Neutral/base ramp = cream, line, text and dark-surface tokens.
        'base': {
            '50':  '#FAF9FD',   # cream-2
            '100': '#F5F4FA',   # cream
            '200': '#EEEBF5',   # line-2 / --border-2
            '300': '#ECEAF3',   # line / --border
            '400': '#9A93AE',   # subtle / --text-light
            '500': '#6E6885',   # muted / --text-muted
            '600': '#2a2342',   # dark-card
            '700': '#1A1130',   # ink / --text-main
            '800': '#1a1035',   # dark-3
            '900': '#0f0a24',   # dark-2
            '950': '#080516',   # dark
        },
        # Text hierarchy mapped 1:1 to the text tokens.
        'font': {
            'subtle-light': '#9A93AE',      # --text-light
            'subtle-dark': 'var(--color-base-400)',
            'default-light': '#6E6885',     # --text-muted
            'default-dark': 'var(--color-base-300)',
            'important-light': '#1A1130',   # --text-main (ink)
            'important-dark': 'var(--color-base-100)',
        },
    },
    # KPI landing on the admin index (numbers + links only; charts live in the
    # staff dashboard app view). See apps/core/dashboard.py.
    'DASHBOARD_CALLBACK': 'apps.core.dashboard.dashboard_callback',
    # Dev/prod marker: colored label by the user links + tab-title prefix, so a
    # development admin can never be mistaken for production.
    'ENVIRONMENT': 'apps.core.environment.environment_callback',
    'ENVIRONMENT_TITLE_PREFIX': 'apps.core.environment.environment_title_prefix',
    'SIDEBAR': {
        'show_search': True,
        # Plumbing models (JWT token blacklist, sessions, social-auth rows) are
        # deliberately NOT listed below, which hides them from the default view.
        'show_all_applications': False,
        'navigation': [
            {
                'items': [
                    {'title': 'Inicio', 'icon': 'home',
                     'link': reverse_lazy('admin:index')},
                ],
            },
            {
                'title': 'Admisiones',
                'separator': True,
                'items': [
                    {'title': 'Pre-registros', 'icon': 'how_to_reg',
                     'badge': 'apps.core.badges.pending_preregistrations',
                     'badge_variant': 'primary',
                     'link': reverse_lazy('admin:admissions_preregistration_changelist')},
                    {'title': 'Inscripciones', 'icon': 'assignment_turned_in',
                     'link': reverse_lazy('admin:admissions_registration_changelist')},
                    {'title': 'Documentos', 'icon': 'folder_open',
                     'badge': 'apps.core.badges.documents_in_review',
                     'badge_variant': 'warning',
                     'link': reverse_lazy('admin:admissions_registrationdocument_changelist')},
                    {'title': 'Disponibilidad de visitas', 'icon': 'event_available',
                     'link': reverse_lazy('admin:bookings_availabilityslot_changelist')},
                    {'title': 'Reservas de visita', 'icon': 'calendar_month',
                     'link': reverse_lazy('admin:bookings_booking_changelist')},
                ],
            },
            {
                'title': 'Familias',
                'separator': True,
                'items': [
                    {'title': 'Usuarios', 'icon': 'person',
                     'link': reverse_lazy('admin:accounts_user_changelist')},
                    {'title': 'Alumnos', 'icon': 'school',
                     'link': reverse_lazy('admin:accounts_studentprofile_changelist')},
                    {'title': 'Padres y tutores', 'icon': 'family_restroom',
                     'link': reverse_lazy('admin:accounts_parentprofile_changelist')},
                ],
            },
            {
                'title': 'Cafetería',
                'separator': True,
                'items': [
                    {'title': 'Saldos', 'icon': 'account_balance_wallet',
                     'link': reverse_lazy('admin:cafeteria_cafeteriabalance_changelist')},
                    {'title': 'Transacciones', 'icon': 'receipt_long',
                     'link': reverse_lazy('admin:cafeteria_cafeteriatransaction_changelist')},
                    {'title': 'Solicitudes de recarga', 'icon': 'add_card',
                     'link': reverse_lazy('admin:cafeteria_topuprequest_changelist')},
                    {'title': 'Ajustes de saldo', 'icon': 'published_with_changes',
                     'link': reverse_lazy('admin:cafeteria_balanceadjustment_changelist')},
                    {'title': 'Perfiles de Loyverse', 'icon': 'badge',
                     'link': reverse_lazy('admin:cafeteria_loyverseprofile_changelist')},
                ],
            },
            {
                'title': 'Pagos',
                'separator': True,
                'items': [
                    {'title': 'Pagos en línea', 'icon': 'payments',
                     'link': reverse_lazy('admin:payments_payment_changelist')},
                    {'title': 'Colegiaturas (facturas)', 'icon': 'request_quote',
                     'link': reverse_lazy('admin:finance_invoice_changelist')},
                    {'title': 'Planes de colegiatura', 'icon': 'price_change',
                     'link': reverse_lazy('admin:finance_feeschedule_changelist')},
                    {'title': 'Descuentos y becas', 'icon': 'percent',
                     'link': reverse_lazy('admin:finance_discount_changelist')},
                    {'title': 'Pagos aplicados', 'icon': 'receipt',
                     'link': reverse_lazy('admin:finance_invoicepayment_changelist')},
                    {'title': 'Ajustes de factura', 'icon': 'edit_note',
                     'link': reverse_lazy('admin:finance_invoiceadjustment_changelist')},
                ],
            },
            {
                'title': 'Contenido del sitio',
                'separator': True,
                'items': [
                    {'title': 'Ajustes del sitio', 'icon': 'tune',
                     'link': reverse_lazy('admin:content_sitesettings_changelist')},
                ],
            },
            {
                'title': 'Comunicaciones',
                'separator': True,
                'items': [
                    {'title': 'Comunicados', 'icon': 'campaign',
                     'link': reverse_lazy('admin:portal_announcement_changelist')},
                    {'title': 'Notificaciones', 'icon': 'notifications',
                     'link': reverse_lazy('admin:portal_notification_changelist')},
                    {'title': 'Comentarios', 'icon': 'forum',
                     'link': reverse_lazy('admin:portal_announcementcomment_changelist')},
                    {'title': 'Mensajes de contacto', 'icon': 'mail',
                     'badge': 'apps.core.badges.unhandled_contact_messages',
                     'badge_variant': 'primary',
                     'link': reverse_lazy('admin:core_contactmessage_changelist')},
                ],
            },
            {
                'title': 'Legal y consentimientos',
                'separator': True,
                'items': [
                    {'title': 'Aviso de privacidad', 'icon': 'policy',
                     'link': reverse_lazy('admin:legal_privacynoticeversion_changelist')},
                    {'title': 'Consentimientos', 'icon': 'fact_check',
                     'link': reverse_lazy('admin:legal_consentrecord_changelist')},
                    {'title': 'Solicitudes ARCO', 'icon': 'gavel',
                     'badge': 'apps.core.badges.open_arco_requests',
                     'link': reverse_lazy('admin:legal_arcorequest_changelist')},
                ],
            },
            {
                'title': 'Sistema',
                'separator': True,
                'items': [
                    {'title': 'Auditoría', 'icon': 'history',
                     'link': reverse_lazy('admin:core_auditlog_changelist')},
                    {'title': 'Grupos de permisos', 'icon': 'group',
                     'link': reverse_lazy('admin:auth_group_changelist')},
                ],
            },
        ],
    },
}
