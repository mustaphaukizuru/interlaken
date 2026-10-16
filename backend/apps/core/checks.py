"""
core/checks.py — Django system checks for production configuration.

``manage.py check --deploy`` reports these. The email check exists because
production once ran with the SMTP backend and no SMTP server configured: every
notification, confirmation and password email failed silently (about 3,165
failures before anyone noticed).
"""
from __future__ import annotations

from django.conf import settings
from django.core.checks import Warning as CheckWarning
from django.core.checks import register

SMTP_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
# Inside the app container nothing listens on these, so they mean "not configured".
NO_SERVER_HOSTS = frozenset({'', 'localhost', '127.0.0.1', '::1'})


@register('email', deploy=True)
def check_email_backend(app_configs=None, **kwargs):
    backend = getattr(settings, 'EMAIL_BACKEND', '')
    host = str(getattr(settings, 'EMAIL_HOST', '') or '').strip().lower()
    if backend != SMTP_BACKEND or host not in NO_SERVER_HOSTS:
        return []
    return [
        CheckWarning(
            f'EMAIL_BACKEND is SMTP but EMAIL_HOST is {host or "empty"!r}: no SMTP server is '
            'configured, so every outgoing email (notifications, confirmations, passwords) fails.',
            hint='Set EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER and EMAIL_HOST_PASSWORD for the '
                 'real mail provider in the production env file, or choose another EMAIL_BACKEND.',
            id='core.W001',
        )
    ]
