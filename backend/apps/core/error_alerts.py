"""
core/error_alerts.py — email the people who maintain the site when it logs an error.

Sentry (apps/core/sentry.py) is the better tool but needs an account and a DSN.
Until it is switched on, a 500 or a failed background job was only visible to
whoever happened to read the container log. ``ErrorAlertHandler`` closes that
gap with the app's own SMTP: production.py attaches it to ``django.request``
(unhandled exceptions, 5xx) and to the project's ``apps`` loggers when
``ERROR_ALERT_EMAILS`` is set, and it is inert otherwise.

What leaves the server: the exception type, a message cut to 300 characters
with emails and CURPs masked, the method and path (no query string, secret path
segments named, see ``mask_url``), the request id and the code locations of the
traceback. Never request bodies, headers, cookies or local variables.

Throttled per worker process: one email per distinct error per hour and at most
``MAX_PER_HOUR`` in total, so a crash loop cannot flood the inbox or the SMTP
quota. Sent on a background thread, so SMTP never delays the failing request.
"""

from __future__ import annotations

import logging
import threading
import time
import traceback

WINDOW_SECONDS = 3600
MAX_PER_HOUR = 10
MESSAGE_LIMIT = 300
FRAME_LIMIT = 8


def _recipients() -> list[str]:
    from django.conf import settings

    return [e for e in getattr(settings, "ERROR_ALERT_EMAILS", []) if e]


def _mask(text: str) -> str:
    from apps.core.sentry import _mask_strings

    return _mask_strings(text)


def _short_path(filename: str) -> str:
    """``/app/backend/apps/x/y.py`` -> ``apps/x/y.py``; packages keep their name."""
    normalized = filename.replace("\\", "/")
    for marker in ("/site-packages/", "/backend/"):
        if marker in normalized:
            return normalized.split(marker, 1)[1]
    return normalized.rsplit("/", 1)[-1]


def fingerprint(record: logging.LogRecord) -> str:
    """Same error = same fingerprint, whatever the path or values involved."""
    parts = [record.name, str(record.msg)]
    if record.exc_info and record.exc_info[0] is not None:
        exc_type, _exc, tb = record.exc_info
        parts.append(exc_type.__name__)
        frames = traceback.extract_tb(tb) if tb else []
        if frames:
            last = frames[-1]
            parts.append(f"{_short_path(last.filename)}:{last.lineno}")
    return "|".join(parts)


def render(record: logging.LogRecord) -> tuple[str, str]:
    """``(subject, body)`` in Spanish, with no personal data beyond masked text."""
    from django.conf import settings
    from django.utils import timezone

    from apps.core.sentry import mask_url

    exc_type = None
    detail = ""
    frames: list[str] = []
    if record.exc_info and record.exc_info[0] is not None:
        exc_type, exc, tb = record.exc_info
        detail = str(exc)
        for frame in (traceback.extract_tb(tb) if tb else [])[-FRAME_LIMIT:]:
            frames.append(f"  {_short_path(frame.filename)}:{frame.lineno} en {frame.name}")
    else:
        try:
            detail = record.getMessage()
        except Exception:  # noqa: BLE001 - a broken format string must not stop the alert
            detail = str(record.msg)
    detail = _mask(detail)[:MESSAGE_LIMIT]

    request = getattr(record, "request", None)
    where = ""
    if request is not None:
        method = getattr(request, "method", "") or ""
        path = mask_url(getattr(request, "path", "") or "")
        where = f"{method} {path}".strip()

    site = (getattr(settings, "FRONTEND_URL", "") or "").replace("https://", "").rstrip("/")
    when = timezone.localtime().strftime("%d/%m/%Y %H:%M")
    what = f"{exc_type.__name__}: {detail}" if exc_type else detail
    status = getattr(record, "status_code", None)

    subject = (
        f"Interlaken: error en el servidor ({exc_type.__name__ if exc_type else record.levelname})"
    )
    lines = [
        f'Se registró un error en {site or "el sitio"} el {when}.',
        "",
        f"Qué falló: {what}",
    ]
    if where:
        lines.append(f"Dónde: {where}" + (f" (respuesta {status})" if status else ""))
    lines.append(
        f'Registro: {record.name} · id de la solicitud {getattr(record, "request_id", "-")}'
    )
    if frames:
        lines += ["", "Código (últimos pasos):", *frames]
    lines += [
        "",
        "Este aviso se envía como máximo una vez por hora para el mismo error. "
        "El detalle completo está en el registro del servidor, por ejemplo:",
        '  journalctl -t interlaken-app --since "1 hour ago" | grep ERROR',
    ]
    return subject, "\n".join(lines)


def _send(subject: str, body: str, recipients: list[str]) -> None:
    from django.conf import settings
    from django.core.mail import send_mail

    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, recipients, fail_silently=True)
    except Exception:  # noqa: BLE001 - an alert must never raise in its thread
        pass


class ErrorAlertHandler(logging.Handler):
    """Logging handler: a throttled, masked email per distinct ERROR record."""

    def __init__(self, level=logging.ERROR):
        super().__init__(level)
        self._guard = threading.Lock()
        self._last_sent: dict[str, float] = {}
        self._recent: list[float] = []

    def _allow(self, key: str, now: float) -> bool:
        with self._guard:
            self._recent = [t for t in self._recent if now - t < WINDOW_SECONDS]
            last = self._last_sent.get(key)
            if last is not None and now - last < WINDOW_SECONDS:
                return False
            if len(self._recent) >= MAX_PER_HOUR:
                return False
            if len(self._last_sent) > 500:  # bounded memory over a long uptime
                self._last_sent = {
                    k: v for k, v in self._last_sent.items() if now - v < WINDOW_SECONDS
                }
            self._last_sent[key] = now
            self._recent.append(now)
            return True

    def emit(self, record: logging.LogRecord) -> None:
        try:
            recipients = _recipients()
            if not recipients or not self._allow(fingerprint(record), time.monotonic()):
                return
            subject, body = render(record)
            threading.Thread(
                target=_send, args=(subject, body, recipients), name="error-alert", daemon=True
            ).start()
        except Exception:  # noqa: BLE001 - logging must never break the request
            self.handleError(record)
