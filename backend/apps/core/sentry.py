"""
core/sentry.py: error alerts (Sentry), and what may leave the server with them.

Inert without ``SENTRY_DSN``: ``config/settings/base.py`` imports this module
only inside ``if SENTRY_DSN``, so without it the SDK is never even imported.
Activation guide (Spanish): docs/SENTRY.md.

No personal data leaves, whatever the endpoint. The school's requests carry
names, emails, phones, card results and minors' data (payments, cafetería,
accounts, admissions), so the rules are global rather than per endpoint:

* request bodies are never read (``max_request_body_size="never"``) and any
  that still reach ``scrub_event`` are dropped; so are cookies, query strings
  (password-reset tokens, OAuth codes) and the client IP;
* a URL path segment that is a secret (the Loyverse webhook key, avatar
  tokens) is replaced by its route parameter name, e.g. ``[token]``;
* headers whose name looks secret or carries the client IP are filtered;
* stack frames carry file, line and function, never variable values
  (``include_local_variables=False``: a payment view's locals hold the
  family's data);
* the user is reduced to its opaque id, and extras with PII or secret names go;
* email addresses and CURPs are masked in every string of the event
  (exception messages, log lines, breadcrumbs).
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit

FILTERED = "[Filtered]"

_SENSITIVE_KEYS = (
    "password",
    "secret",
    "token",
    "authorization",
    "api_key",
    "apikey",
    "credential",
    "cookie",
    "ssn",
    "curp",
)
# Headers that carry the visitor's IP (Caddy sets X-Real-IP).
_IP_HEADER_PARTS = ("forwarded", "real-ip", "client-ip", "connecting-ip")
# Direct-PII keys stripped from extras even with send_default_pii=False (a
# logger's ``extra=`` kwarg, for instance).
_PII_KEYS = ("email", "first_name", "last_name", "username", "ip_address", "phone")
# Route parameters whose value is a secret and must not appear in a URL.
_SECRET_PARAM_PARTS = ("token", "secret", "key", "password", "signature", "uid")

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# Mexican CURP: 4 letters, birth date, sex, state, 3 consonants, 2 check chars.
_CURP = re.compile(r"\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{5}[A-Z\d]\d\b")
_MAX_DEPTH = 20


def _mask_strings(value, depth=0):
    """Mask emails and CURPs in every string of a JSON-like structure."""
    if isinstance(value, str):
        return _CURP.sub("[CURP]", _EMAIL.sub("[email]", value))
    if depth >= _MAX_DEPTH:
        return value
    if isinstance(value, dict):
        return {key: _mask_strings(item, depth + 1) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_mask_strings(item, depth + 1) for item in value]
    return value


def _secret_route_values(path: str) -> dict[str, str]:
    """The secret route parameters of ``path`` (name -> value), if it resolves."""
    from django.urls import Resolver404, resolve

    try:
        match = resolve(path)
    except (Resolver404, ValueError, TypeError):
        return {}
    return {
        name: value
        for name, value in match.kwargs.items()
        if isinstance(value, str)
        and value
        and any(part in name.lower() for part in _SECRET_PARAM_PARTS)
    }


def mask_url(url: str) -> str:
    """``url`` without query string or fragment, secret path segments named."""
    if not isinstance(url, str) or not url:
        return url
    parts = urlsplit(url)
    path = parts.path
    for name, value in _secret_route_values(path).items():
        path = path.replace(value, f"[{name}]")
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def _scrub_request(request: dict) -> None:
    for key in ("data", "cookies", "query_string"):
        request.pop(key, None)
    if "url" in request:
        request["url"] = mask_url(request["url"])
    headers = request.get("headers")
    if isinstance(headers, dict):
        for key in list(headers):
            lowered = key.lower()
            if any(s in lowered for s in _SENSITIVE_KEYS + _IP_HEADER_PARTS):
                headers[key] = FILTERED
    env = request.get("env")
    if isinstance(env, dict):
        env.pop("REMOTE_ADDR", None)


def _scrub_breadcrumbs(event: dict) -> None:
    crumbs = event.get("breadcrumbs")
    values = crumbs.get("values") if isinstance(crumbs, dict) else crumbs
    if not isinstance(values, list):
        return
    for crumb in values:
        data = crumb.get("data") if isinstance(crumb, dict) else None
        if isinstance(data, dict) and isinstance(data.get("url"), str):
            data["url"] = mask_url(data["url"])
            data.pop("http.query", None)
            data.pop("http.fragment", None)


def scrub_event(event, _hint=None):
    """``before_send`` / ``before_send_transaction``: strip personal data and secrets."""
    request = event.get("request")
    if isinstance(request, dict):
        _scrub_request(request)
    extra = event.get("extra")
    if isinstance(extra, dict):
        for key in list(extra):
            lowered = key.lower()
            if lowered in _PII_KEYS or any(s in lowered for s in _SENSITIVE_KEYS):
                extra[key] = FILTERED
    # Keep only the opaque user id: never email, name, username or IP.
    user = event.get("user")
    if isinstance(user, dict):
        for key in list(user):
            if key != "id":
                user.pop(key, None)
    _scrub_breadcrumbs(event)
    return _mask_strings(event)


def init_sentry(dsn: str, *, environment: str, release: str | None, traces_sample_rate: float):
    """Start the SDK. Called from settings only when ``SENTRY_DSN`` is set."""
    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=dsn,
        integrations=[DjangoIntegration()],
        environment=environment,
        release=release or None,
        traces_sample_rate=traces_sample_rate,
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
    )
