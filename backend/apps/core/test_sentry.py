"""
Error alerts (apps/core/sentry.py): inert without SENTRY_DSN, and no personal
data or secret leaves with an event when it is set.
"""

import sentry_sdk

from apps.core import sentry as ik_sentry
from apps.core.sentry import FILTERED, mask_url, scrub_event


def _django_event():
    """The shape the Django integration builds for a failed payments request."""
    return {
        "level": "error",
        "request": {
            "url": "https://interlaken.edu.mx/api/v1/payments/admin/7/banorte-verify/",
            "method": "POST",
            "query_string": "token=abc123&email=mama%40example.com",
            "data": {"referencia": "123456", "amount": "500.00", "email": "mama@example.com"},
            "cookies": {"sessionid": "s3cr3t", "refresh_token": "r3fr3sh"},
            "headers": {
                "Authorization": "Bearer eyJ.secret",
                "X-Real-Ip": "201.141.1.2",
                "X-Forwarded-For": "201.141.1.2",
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0",
            },
            "env": {"REMOTE_ADDR": "201.141.1.2", "SERVER_NAME": "app"},
        },
        "user": {
            "id": 42,
            "email": "mama@example.com",
            "username": "mama",
            "ip_address": "1.2.3.4",
        },
        "extra": {"email": "mama@example.com", "payment_id": 7, "api_token": "t"},
        "exception": {
            "values": [
                {
                    "type": "IntegrityError",
                    "value": "duplicate key: Key (email)=(mama@example.com) curp GOMA850101HDFRRN09",
                    "stacktrace": {"frames": [{"function": "post", "lineno": 227}]},
                }
            ]
        },
        "breadcrumbs": {
            "values": [
                {"category": "django", "message": "login failed for papa.lopez@example.mx"},
                {
                    "category": "httplib",
                    "data": {
                        "url": "https://api.loyverse.com/v1.0/customers?email=a@b.mx",
                        "http.query": "email=a@b.mx",
                    },
                },
            ]
        },
    }


def test_sentry_is_active_only_with_a_dsn(settings):
    # CI has no SENTRY_DSN, so settings never called init_sentry and the SDK
    # is inert. (A developer .env with a DSN would make it active, and say so.)
    assert sentry_sdk.get_client().is_active() is bool(settings.SENTRY_DSN)


def test_request_body_cookies_query_and_ip_never_leave():
    event = scrub_event(_django_event())
    request = event["request"]
    assert "data" not in request
    assert "cookies" not in request
    assert "query_string" not in request
    assert "REMOTE_ADDR" not in request["env"]
    assert request["headers"]["Authorization"] == FILTERED
    assert request["headers"]["X-Real-Ip"] == FILTERED
    assert request["headers"]["X-Forwarded-For"] == FILTERED
    assert request["headers"]["Content-Type"] == "application/json"


def test_user_is_only_its_opaque_id_and_pii_extras_go():
    event = scrub_event(_django_event())
    assert event["user"] == {"id": 42}
    assert event["extra"]["email"] == FILTERED
    assert event["extra"]["api_token"] == FILTERED
    assert event["extra"]["payment_id"] == 7


def test_emails_and_curps_are_masked_everywhere():
    event = scrub_event(_django_event())
    flat = repr(event)
    assert "@example" not in flat
    assert "a@b.mx" not in flat
    assert "GOMA850101HDFRRN09" not in flat
    value = event["exception"]["values"][0]["value"]
    assert "[email]" in value and "[CURP]" in value
    assert event["breadcrumbs"]["values"][0]["message"] == "login failed for [email]"
    crumb = event["breadcrumbs"]["values"][1]["data"]
    assert crumb["url"] == "https://api.loyverse.com/v1.0/customers"
    assert "http.query" not in crumb


def test_the_loyverse_webhook_secret_never_appears_in_a_url():
    url = "https://interlaken.edu.mx/api/v1/cafeteria/loyverse/webhook/Zx9-super-secret/?a=1#f"
    assert mask_url(url) == "https://interlaken.edu.mx/api/v1/cafeteria/loyverse/webhook/[token]/"


def test_a_plain_url_keeps_its_path_and_loses_its_query():
    url = "https://interlaken.edu.mx/api/v1/payments/admin/7/banorte-verify/?x=1"
    assert mask_url(url) == "https://interlaken.edu.mx/api/v1/payments/admin/7/banorte-verify/"
    assert mask_url("https://example.com/no/route/here?q=1") == "https://example.com/no/route/here"


def test_init_sends_no_pii_bodies_or_locals_and_tags_environment_and_release(monkeypatch):
    seen = {}
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: seen.update(kwargs))
    ik_sentry.init_sentry(
        "https://public@o0.ingest.sentry.io/0",
        environment="production",
        release="c2f06024",
        traces_sample_rate=0.0,
    )
    assert seen["send_default_pii"] is False
    assert seen["max_request_body_size"] == "never"
    assert seen["include_local_variables"] is False
    assert seen["before_send"] is scrub_event
    assert seen["before_send_transaction"] is scrub_event
    assert seen["environment"] == "production"
    assert seen["release"] == "c2f06024"


def test_a_blank_release_is_left_unset(monkeypatch):
    seen = {}
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: seen.update(kwargs))
    ik_sentry.init_sentry(
        "https://public@o0.ingest.sentry.io/0",
        environment="production",
        release="",
        traces_sample_rate=0.0,
    )
    assert seen["release"] is None
