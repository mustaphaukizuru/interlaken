"""Error alert emails (apps/core/error_alerts.py): inert by default, masked, throttled."""

import logging
import sys

import pytest
from django.core import mail
from django.test import RequestFactory, override_settings

from apps.core import error_alerts
from apps.core.error_alerts import ErrorAlertHandler


class _SyncThread:
    """Run the alert on the test's thread so ``mail.outbox`` sees it at once."""

    def __init__(self, target, args=(), **_kwargs):
        self._target, self._args = target, args

    def start(self):
        self._target(*self._args)


@pytest.fixture(autouse=True)
def _sync(monkeypatch):
    monkeypatch.setattr(error_alerts.threading, "Thread", _SyncThread)


def _record(
    msg="Internal Server Error: %s", args=("/x",), exc=None, request=None, name="django.request"
):
    exc_info = None
    if exc is not None:
        try:
            raise exc
        except type(exc):
            exc_info = sys.exc_info()
    record = logging.LogRecord(name, logging.ERROR, __file__, 1, msg, args, exc_info)
    if request is not None:
        record.request = request
        record.status_code = 500
    record.request_id = "abc123"
    return record


@override_settings(ERROR_ALERT_EMAILS=[])
def test_inert_without_recipients():
    ErrorAlertHandler().emit(_record(exc=ValueError("boom")))
    assert mail.outbox == []


@override_settings(ERROR_ALERT_EMAILS=["dev@example.com"], FRONTEND_URL="https://interlaken.edu.mx")
def test_sends_a_masked_email_without_query_string_or_body():
    request = RequestFactory().post(
        "/api/v1/cafeteria/admin/adjust/7/?token=SECRET", {"note": "privado"}
    )
    exc = ValueError("ana.perez@gmail.com tiene CURP PEPA100101HDFRRN09")
    ErrorAlertHandler().emit(
        _record(args=("/api/v1/cafeteria/admin/adjust/7/",), exc=exc, request=request)
    )

    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    assert message.to == ["dev@example.com"]
    assert message.subject == "Interlaken: error en el servidor (ValueError)"
    body = message.body
    assert "ValueError: [email] tiene CURP [CURP]" in body
    assert "POST /api/v1/cafeteria/admin/adjust/7/ (respuesta 500)" in body
    assert "id de la solicitud abc123" in body
    assert "interlaken.edu.mx" in body
    assert "apps/core/test_error_alerts.py" in body  # code location, relative path
    for leaked in ("SECRET", "token=", "privado", "ana.perez", "PEPA100101"):
        assert leaked not in body


@override_settings(ERROR_ALERT_EMAILS=["dev@example.com"])
def test_same_error_is_sent_once_per_hour():
    handler = ErrorAlertHandler()
    handler.emit(_record(exc=KeyError("a")))
    handler.emit(_record(args=("/other/",), exc=KeyError("b")))
    assert len(mail.outbox) == 1


@override_settings(ERROR_ALERT_EMAILS=["dev@example.com"])
def test_total_per_hour_is_capped():
    handler = ErrorAlertHandler()
    for i in range(error_alerts.MAX_PER_HOUR + 5):
        handler.emit(_record(msg=f"falló el trabajo {i}", args=(), name="apps.cafeteria"))
    assert len(mail.outbox) == error_alerts.MAX_PER_HOUR


@override_settings(ERROR_ALERT_EMAILS=["dev@example.com"])
def test_a_record_without_exception_uses_its_message():
    ErrorAlertHandler().emit(
        _record(msg="Sincronización fallida para %s", args=("x@y.com",), name="apps.cafeteria")
    )
    assert len(mail.outbox) == 1
    assert "Qué falló: Sincronización fallida para [email]" in mail.outbox[0].body
    assert mail.outbox[0].subject == "Interlaken: error en el servidor (ERROR)"


@override_settings(ERROR_ALERT_EMAILS=["dev@example.com"])
def test_a_failing_smtp_never_raises(monkeypatch):
    def broken(*_args, **_kwargs):
        raise OSError("smtp down")

    monkeypatch.setattr("django.core.mail.send_mail", broken)
    ErrorAlertHandler().emit(_record(exc=RuntimeError("x")))  # no exception


def test_fingerprint_ignores_values_but_not_the_error_kind():
    a = error_alerts.fingerprint(_record(args=("/a/",), exc=ValueError("1")))
    b = error_alerts.fingerprint(_record(args=("/b/",), exc=ValueError("2")))
    c = error_alerts.fingerprint(_record(args=("/a/",), exc=TypeError("1")))
    assert a == b
    assert a != c
