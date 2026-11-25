"""config/settings/local_safety.py: a developer machine never reaches production by accident."""

from config.settings.local_safety import (
    FILE_STORAGE,
    LIVE_INTEGRATION_SETTINGS,
    blank_live_integrations,
    is_remote_database,
)


def test_remote_hosts_are_detected():
    pg = "django.db.backends.postgresql"
    assert is_remote_database({"ENGINE": pg, "HOST": "aws-0-us-east-1.pooler.supabase.com"})
    assert is_remote_database({"ENGINE": pg, "HOST": "93.188.162.163"})
    for local in ("localhost", "127.0.0.1", "::1", "postgres", "db", "", None, " LOCALHOST "):
        assert not is_remote_database({"ENGINE": pg, "HOST": local}), local
    assert not is_remote_database({"ENGINE": "django.db.backends.sqlite3", "HOST": "anything"})


def test_live_keys_are_blanked_and_reported():
    namespace = {name: "" for name in LIVE_INTEGRATION_SETTINGS}
    namespace.update(
        LOYVERSE_API_TOKEN="live-token", GOOGLE_CALENDAR_SA_KEY='{"k": 1}', OTHER="kept"
    )
    cleared = blank_live_integrations(namespace)
    assert cleared == ["LOYVERSE_API_TOKEN", "GOOGLE_CALENDAR_SA_KEY"]
    assert all(namespace[name] == "" for name in LIVE_INTEGRATION_SETTINGS)
    assert namespace["OTHER"] == "kept"


def test_media_never_goes_to_the_production_bucket():
    namespace = {
        "AWS_STORAGE_BUCKET_NAME": "prod-media",
        "STORAGES": {
            "default": {"BACKEND": "storages.backends.s3boto3.S3Boto3Storage"},
            "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
        },
    }
    assert blank_live_integrations(namespace) == ["AWS_STORAGE_BUCKET_NAME"]
    assert namespace["AWS_STORAGE_BUCKET_NAME"] == ""
    assert namespace["STORAGES"]["default"] == {"BACKEND": FILE_STORAGE}
    assert namespace["STORAGES"]["staticfiles"]["BACKEND"].startswith("whitenoise")


def test_nothing_to_clear_is_quiet():
    assert blank_live_integrations({"LOYVERSE_API_TOKEN": ""}) == []
