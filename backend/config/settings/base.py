"""
Colegio Interlaken — Base Django Settings
"""
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
    'jazzmin',
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
]

LOCAL_APPS = [
    'apps.core',
    'apps.accounts',
    'apps.admissions',
    'apps.cafeteria',
    'apps.payments',
    'apps.portal',
    'apps.bookings',
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ── MIDDLEWARE ────────────────────────────────────────────
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'social_django.middleware.SocialAuthExceptionMiddleware',
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
DATABASES = {
    'default': {
        'ENGINE': env('DB_ENGINE', default='django.db.backends.mysql'),
        'NAME': env('DB_NAME'),
        'USER': env('DB_USER', default=''),
        'PASSWORD': env('DB_PASSWORD', default=''),
        'HOST': env('DB_HOST', default='localhost'),
        'PORT': env('DB_PORT', default='3306'),
        'OPTIONS': {'charset': 'utf8mb4'} if 'mysql' in env('DB_ENGINE', default='mysql') else {},
    }
}

# ── AUTH ──────────────────────────────────────────────────
AUTH_USER_MODEL = 'accounts.User'

AUTHENTICATION_BACKENDS = [
    'social_core.backends.google.GoogleOAuth2',
    'django.contrib.auth.backends.ModelBackend',
]

SOCIAL_AUTH_GOOGLE_OAUTH2_KEY = env('GOOGLE_CLIENT_ID')
SOCIAL_AUTH_GOOGLE_OAUTH2_SECRET = env('GOOGLE_CLIENT_SECRET')
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
}

from datetime import timedelta

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=8),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# ── CORS ──────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS', default=['http://localhost:5173'])
CORS_ALLOW_CREDENTIALS = True

# ── STATIC & MEDIA ────────────────────────────────────────
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

MEDIA_URL = env('MEDIA_URL', default='/media/')
MEDIA_ROOT = env('MEDIA_ROOT', default=str(BASE_DIR / 'media'))

# ── EMAIL ─────────────────────────────────────────────────
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = env('EMAIL_HOST', default='localhost')
EMAIL_PORT = env.int('EMAIL_PORT', default=587)
EMAIL_USE_TLS = env.bool('EMAIL_USE_TLS', default=True)
EMAIL_HOST_USER = env('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', default='')
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='noreply@interlaken.edu.mx')
# Where public contact-form messages are delivered (falls back to DEFAULT_FROM_EMAIL).
CONTACT_EMAIL = env('CONTACT_EMAIL', default='')

# ── LOYVERSE ──────────────────────────────────────────────
LOYVERSE_API_TOKEN = env('LOYVERSE_API_TOKEN', default='')
LOYVERSE_BASE_URL = 'https://api.loyverse.com/v1.0'

# ── PAYMENTS ──────────────────────────────────────────────
GLOBAL_PAYMENTS_APP_ID = env('GLOBAL_PAYMENTS_APP_ID', default='')
GLOBAL_PAYMENTS_APP_KEY = env('GLOBAL_PAYMENTS_APP_KEY', default='')
GLOBAL_PAYMENTS_ENV = env('GLOBAL_PAYMENTS_ENV', default='sandbox')

# Shared secrets for verifying inbound payment webhooks (HMAC-SHA256 of the raw
# request body, hex digest, in the X-Webhook-Signature header). Empty → the
# webhook fails closed (rejects everything) until a secret is configured.
GLOBAL_PAYMENTS_WEBHOOK_SECRET = env('GLOBAL_PAYMENTS_WEBHOOK_SECRET', default='')
BANORTE_WEBHOOK_SECRET = env('BANORTE_WEBHOOK_SECRET', default='')

# ── GOOGLE CALENDAR ───────────────────────────────────────
# Server-side calendar writes for confirmed bookings use a *service account*
# (NOT the OAuth login client). Both empty → calendar integration is a no-op and
# bookings still succeed (fail-soft, picked up later by `manage.py sync_calendar`).
# See BOOKING_CALENDAR_SPEC.md §3 / DEPLOYMENT.md §8 for the GCP setup. Never
# commit the key file — GOOGLE_CALENDAR_SA_KEY is a path read from the env.
GOOGLE_CALENDAR_ID = env('GOOGLE_CALENDAR_ID', default='')
GOOGLE_CALENDAR_SA_KEY = env('GOOGLE_CALENDAR_SA_KEY', default='')

# ── WHATSAPP ──────────────────────────────────────────────
WHATSAPP_NUMBER = env('WHATSAPP_NUMBER', default='')

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

# ── FILE UPLOAD ───────────────────────────────────────────
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024   # 10 MB
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx']

# ── JAZZMIN ADMIN SKIN ────────────────────────────────────
JAZZMIN_SETTINGS = {
    'site_title': 'Admin · Interlaken',
    'site_header': 'Colegio Interlaken',
    'site_brand': 'INTERLAKEN',
    'welcome_sign': 'Panel de Administración — Colegio Interlaken',
    'copyright': 'Colegio Interlaken',
    'search_model': ['accounts.User'],
    'topmenu_links': [
        {'name': 'Portal Web', 'url': 'http://localhost:3000', 'new_window': True},
        {'name': 'API', 'url': '/api/v1/', 'new_window': True},
    ],
    'icons': {
        'auth': 'fas fa-shield-alt',
        'auth.user': 'fas fa-user',
        'accounts.user': 'fas fa-user-circle',
        'accounts.studentprofile': 'fas fa-graduation-cap',
        'admissions.preregistration': 'fas fa-file-alt',
        'admissions.registration': 'fas fa-clipboard-list',
        'admissions.openschoolday': 'fas fa-door-open',
        'cafeteria.cafeteriabalance': 'fas fa-coffee',
        'cafeteria.cafeteriatransaction': 'fas fa-receipt',
        'payments.payment': 'fas fa-credit-card',
        'portal.announcement': 'fas fa-bullhorn',
        'portal.event': 'fas fa-calendar-star',
        'bookings.availabilityslot': 'fas fa-calendar-check',
        'bookings.booking': 'fas fa-user-clock',
    },
    'default_icon_parents': 'fas fa-chevron-circle-right',
    'default_icon_children': 'fas fa-dot-circle',
    'related_modal_active': True,
    'custom_css': 'admin/interlaken_admin.css',
    'custom_js': None,
    'use_google_fonts_cdn': True,
    'show_ui_builder': False,
    'changeform_format': 'horizontal_tabs',
    'language_chooser': False,
    'show_sidebar': True,
    'navigation_expanded': True,
}

JAZZMIN_UI_TWEAKS = {
    'navbar_small_text': False,
    'footer_small_text': True,
    'body_small_text': False,
    'brand_small_text': False,
    'brand_colour': False,
    'accent': 'accent-purple',
    'navbar': 'navbar-dark',
    'no_navbar_border': True,
    'navbar_fixed': True,
    'layout_boxed': False,
    'footer_fixed': False,
    'sidebar_fixed': True,
    'sidebar': 'sidebar-dark-purple',
    'sidebar_nav_small_text': False,
    'sidebar_disable_expand': False,
    'sidebar_nav_child_indent': True,
    'sidebar_nav_compact_style': False,
    'sidebar_nav_legacy_style': False,
    'sidebar_nav_flat_style': False,
    'theme': 'default',
    'button_classes': {
        'primary': 'btn-primary',
        'secondary': 'btn-secondary',
        'info': 'btn-outline-info',
        'warning': 'btn-warning',
        'danger': 'btn-danger',
        'success': 'btn-success',
    },
}
