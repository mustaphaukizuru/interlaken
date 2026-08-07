"""
accounts/password_reset.py — single-use hashed password-reset / account-activation tokens.

Same security shape as admissions invite tokens: raw token shown once in email,
SHA-256 at rest, TTL, single-use. Used for both "forgot password" and first-login
activation of CSV-imported parents (unusable password).
"""
import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import PasswordResetToken

RESET_TTL = timedelta(hours=getattr(settings, 'PASSWORD_RESET_TTL_HOURS', 24))


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_reset_token(user) -> str:
    """Invalidate prior unused tokens and mint a fresh one. Returns raw token."""
    PasswordResetToken.objects.filter(user=user, used_at__isnull=True).delete()
    raw = secrets.token_urlsafe(32)
    PasswordResetToken.objects.create(
        user=user,
        token_hash=_hash(raw),
        expires_at=timezone.now() + RESET_TTL,
    )
    return raw


def consume_reset_token(user, raw: str) -> bool:
    """Validate + consume. Returns True on success."""
    if not raw or not user:
        return False
    now = timezone.now()
    candidates = PasswordResetToken.objects.filter(
        user=user, used_at__isnull=True, expires_at__gt=now,
    )
    for row in candidates:
        if secrets.compare_digest(_hash(raw), row.token_hash):
            row.used_at = now
            row.save(update_fields=['used_at'])
            return True
    return False
