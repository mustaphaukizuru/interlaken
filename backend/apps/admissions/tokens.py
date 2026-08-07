"""
admissions/tokens.py — single-use, expiring, hashed-at-rest registration tokens.

An anonymous applicant receives a one-time **invite token** at creation (returned
in the body exactly once, never in a URL). They exchange it via POST for a
short-lived **session token** used on subsequent steps (via the X-Session-Token
header, never a query string). The invite is single-use — redeeming it consumes
it. Only SHA-256 hashes are stored, so a database leak never yields a usable token.
"""
import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

INVITE_TTL = timedelta(days=getattr(settings, 'ADMISSIONS_INVITE_TTL_DAYS', 14))
SESSION_TTL = timedelta(hours=getattr(settings, 'ADMISSIONS_SESSION_TTL_HOURS', 24))


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_invite(reg) -> str:
    """Generate a fresh one-time invite token; store only its hash. Returns raw."""
    raw = secrets.token_urlsafe(32)
    reg.invite_token_hash = _hash(raw)
    reg.invite_expires_at = timezone.now() + INVITE_TTL
    reg.invite_used_at = None
    reg.save(update_fields=['invite_token_hash', 'invite_expires_at', 'invite_used_at'])
    return raw


def redeem_invite(reg, raw: str) -> bool:
    """Consume the invite if valid (unused, unexpired, matches). Single-use."""
    if not raw or not reg.invite_token_hash:
        return False
    if reg.invite_used_at is not None:
        return False
    if not reg.invite_expires_at or reg.invite_expires_at <= timezone.now():
        return False
    if not secrets.compare_digest(_hash(raw), reg.invite_token_hash):
        return False
    reg.invite_used_at = timezone.now()
    reg.save(update_fields=['invite_used_at'])
    return True


def issue_session(reg) -> str:
    """Mint a short-lived session token for the working steps; store only its hash."""
    raw = secrets.token_urlsafe(32)
    reg.session_token_hash = _hash(raw)
    reg.session_expires_at = timezone.now() + SESSION_TTL
    reg.save(update_fields=['session_token_hash', 'session_expires_at'])
    return raw


def session_valid(reg, raw: str) -> bool:
    if not raw or not reg.session_token_hash:
        return False
    if not reg.session_expires_at or reg.session_expires_at <= timezone.now():
        return False
    return secrets.compare_digest(_hash(raw), reg.session_token_hash)
