"""
core/request_id.py — request-id propagation + structured logging helpers.

Zero-dependency observability plumbing (IK-OPS hardening):

* ``RequestIDMiddleware`` — reads an inbound ``X-Request-ID`` header (as set by
  a proxy/CDN) or mints a short random one, exposes it on ``request.request_id``,
  echoes it back on the response, and stashes it in a ``contextvars.ContextVar``
  so log records emitted anywhere in the request cycle can carry it.
* ``RequestIDFilter`` — logging filter that stamps ``record.request_id``.
* ``JSONFormatter`` — one JSON object per line for production stdout logs.

Everything is stdlib-only; wired up in ``config/settings/base.py`` (MIDDLEWARE +
LOGGING) with the JSON formatter enabled only in production.
"""
import contextvars
import json
import logging
import re
import uuid

_request_id: contextvars.ContextVar[str] = contextvars.ContextVar('request_id', default='-')

# Accept only header-safe, log-safe ids from the outside world.
_SAFE_ID = re.compile(r'[^A-Za-z0-9._-]')
_MAX_ID_LEN = 64

REQUEST_ID_HEADER = 'X-Request-ID'


def get_request_id() -> str:
    """The current request's id, or ``'-'`` outside a request (cron, shell)."""
    return _request_id.get()


def _incoming_or_new(request) -> str:
    raw = request.META.get('HTTP_X_REQUEST_ID', '') or ''
    cleaned = _SAFE_ID.sub('', raw)[:_MAX_ID_LEN]
    return cleaned or uuid.uuid4().hex[:16]


class RequestIDMiddleware:
    """Generate/propagate ``X-Request-ID`` and make it available to logging."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        rid = _incoming_or_new(request)
        request.request_id = rid
        token = _request_id.set(rid)
        try:
            response = self.get_response(request)
            response[REQUEST_ID_HEADER] = rid
        finally:
            _request_id.reset(token)
        return response


class RequestIDFilter(logging.Filter):
    """Inject the contextvar request id into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


class JSONFormatter(logging.Formatter):
    """Minimal JSON-lines formatter for production stdout (no extra deps)."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            'ts': self.formatTime(record, '%Y-%m-%dT%H:%M:%S'),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'request_id': getattr(record, 'request_id', '-'),
        }
        # django.request attaches the failing status code — keep it queryable.
        status_code = getattr(record, 'status_code', None)
        if status_code is not None:
            payload['status_code'] = status_code
        if record.exc_info:
            payload['exc_info'] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)
