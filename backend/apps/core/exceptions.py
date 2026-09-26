"""
core/exceptions.py — one error shape for the API (Data Ops C1).

DRF already answers with ``{"detail": "..."}`` for raised exceptions and with a
``{field: [msg, ...]}`` dict for serializer errors; both shapes are kept. What
this module adds:

* ``handler`` (``REST_FRAMEWORK['EXCEPTION_HANDLER']``): converts a Django
  ``ValidationError`` (model ``clean()``, transition guards) to a 400 with the
  DRF shape, and folds any stray ``{'error': ...}`` body into ``{'detail'}``.
* ``error_response`` / ``error_body``: what a view uses instead of hand-writing
  ``Response({'error': msg})``. The body is ``{"detail": msg}``; a machine code
  a client branches on (OAuth ``not_invited``, webhook ``invalid_signature``)
  travels in ``code``. The legacy ``error`` alias was removed in Data Ops
  Phase 10 (``LEGACY_ERROR_KEY = False``) once every page read errors through
  ``frontend/src/lib/apiErrors.ts``.
* ``PayloadTooLarge``: the 413 every cap in the round answers with, body
  ``{"detail": "Acote los filtros: el límite es N filas."}``.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

# Flipped in Data Ops Phase 10: no response carries the old ``error`` key any more.
# Kept as a flag (not deleted) so a rollback is one line.
LEGACY_ERROR_KEY = False


def cap_message(limit: int, *, noun: str = "filas", verb: str = "Acote los filtros") -> str:
    """``'Acote los filtros: el límite es 10,000 filas.'`` (es-MX thousands separator)."""
    return f"{verb}: el límite es {limit:,} {noun}."


class PayloadTooLarge(APIException):
    """HTTP 413 for every row/size cap of the Data Ops round."""

    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    default_detail = cap_message(10_000)
    default_code = "too_large"

    def __init__(self, limit: int | None = None, detail: str | None = None, **kwargs):
        if detail is None and limit is not None:
            detail = cap_message(limit, **kwargs)
        super().__init__(detail=detail)


def error_body(message: str, *, code: str | None = None, **extra) -> dict:
    """``{'detail': message, ...extra}``; ``code`` adds a machine-readable ``code`` key."""
    body = {"detail": message}
    if code:
        body["code"] = code
    if LEGACY_ERROR_KEY:
        body["error"] = message
    body.update(extra)
    return body


def error_response(
    message: str, status_code: int = status.HTTP_400_BAD_REQUEST, **extra
) -> Response:
    return Response(error_body(message, **extra), status=status_code)


def _django_validation_detail(exc: DjangoValidationError):
    if hasattr(exc, "message_dict"):
        return {k: [str(m) for m in v] for k, v in exc.message_dict.items()}
    messages = [str(m) for m in exc.messages]
    return {"detail": messages[0] if len(messages) == 1 else messages}


def handler(exc, context):
    """``REST_FRAMEWORK['EXCEPTION_HANDLER']``: DRF shapes kept, extras normalised."""
    if isinstance(exc, DjangoValidationError):
        return Response(_django_validation_detail(exc), status=status.HTTP_400_BAD_REQUEST)

    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    data = response.data
    if isinstance(data, dict) and "error" in data and "detail" not in data:
        message = data["error"]
        rest = {k: v for k, v in data.items() if k != "error"}
        response.data = error_body(message if isinstance(message, str) else str(message), **rest)
    return response
