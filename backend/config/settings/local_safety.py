"""Keep a developer machine away from production (used by development.py only).

A developer's repo-root ``.env`` can hold PRODUCTION values: the Supabase DB_*,
the live Loyverse token, the school's Google Calendar key. development.py used
to take them as they were, so the only thing between a local ``runserver`` (or a
local copy of the database) and real families' wallets, calendar and phones was
remembering ``SQLITE_LOCAL=1``. These helpers make the safe choice the default;
each risky choice needs an explicit opt-in for that one command:

* ``DEV_ALLOW_REMOTE_DB=1``    use the database named in DB_* even when its host
                               is not this machine (e.g. a deliberate read-only
                               check against Supabase).
* ``DEV_LIVE_INTEGRATIONS=1``  keep the live keys below (Loyverse writes points,
                               Google writes the school calendar, push and
                               WhatsApp reach real families, Banorte charges cards).

production.py never imports this module.
"""

from __future__ import annotations

# Database hosts that are this machine or a throwaway local/CI container.
LOCAL_DB_HOSTS = frozenset({"", "localhost", "127.0.0.1", "::1", "postgres", "db"})

# Settings that let a local process change something outside this machine.
LIVE_INTEGRATION_SETTINGS = (
    "LOYVERSE_API_TOKEN",  # sets customer points in the school's POS
    "LOYVERSE_WEBHOOK_SECRET",
    "GOOGLE_CALENDAR_ID",  # writes visits into the school's calendar
    "GOOGLE_CALENDAR_SA_KEY",
    "WHATSAPP_TOKEN",  # messages real families
    "WHATSAPP_PHONE_ID",
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_VERIFY_TOKEN",
    "VAPID_PRIVATE_KEY",  # push notifications to real families' phones
    "BANORTE_MERCHANT_ID",  # real card charges
    "BANORTE_USER",
    "BANORTE_PASSWORD",
    "BANORTE_TERMINAL_ID",
    "BANORTE_CERT",
    "BANORTE_CERT_PATH",
    "BACKUP_S3_BUCKET",  # the off-site backup bucket
    "BACKUP_S3_ACCESS_KEY_ID",
    "BACKUP_S3_SECRET_ACCESS_KEY",
)

FILE_STORAGE = "django.core.files.storage.FileSystemStorage"


def is_remote_database(db: dict) -> bool:
    """True when ``db`` (a DATABASES entry) lives on another machine."""
    if "sqlite" in str(db.get("ENGINE", "")):
        return False
    return str(db.get("HOST") or "").strip().lower() not in LOCAL_DB_HOSTS


def blank_live_integrations(namespace: dict) -> list[str]:
    """Blank every live key in ``namespace`` (a settings module's globals).

    Also points media uploads back at the local disk when an object-storage
    bucket is configured, so a laptop never writes into the production bucket.
    Returns the names that held a value, for a one-line notice.
    """
    cleared = [name for name in LIVE_INTEGRATION_SETTINGS if namespace.get(name)]
    for name in LIVE_INTEGRATION_SETTINGS:
        if name in namespace:
            namespace[name] = ""
    if namespace.get("AWS_STORAGE_BUCKET_NAME"):
        cleared.append("AWS_STORAGE_BUCKET_NAME")
        namespace["AWS_STORAGE_BUCKET_NAME"] = ""
        storages = dict(namespace.get("STORAGES") or {})
        storages["default"] = {"BACKEND": FILE_STORAGE}
        namespace["STORAGES"] = storages
    return cleared
