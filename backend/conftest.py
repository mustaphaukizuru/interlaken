"""
Root pytest configuration for the Interlaken backend.

Tests always run against SQLite with the *development* settings module and a set
of throwaway secrets. Environment defaults are established here — before Django
is configured — so the suite runs identically on a developer laptop (where a real
``.env`` exists) and in CI (where it does not). ``setdefault`` never clobbers a
value a developer or CI job has already exported.
"""

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")
os.environ.setdefault("SQLITE_LOCAL", "1")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("DB_NAME", "test_interlaken")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-client-secret")
# Ensure no test can accidentally reach a real Sentry project.
os.environ.pop("SENTRY_DSN", None)

import pytest
from rest_framework.test import APIClient


@pytest.fixture(autouse=True)
def _test_settings(settings):
    """Neutralise environment-specific settings that would make tests flaky:

    * Rate limiting shares a process-wide cache across tests → disable it so
      repeated hits to login/webhook endpoints don't bleed into each other.
      (RATELIMIT_ENABLE=False also disables the DRF SharedScopedRateThrottle.)
    * The LocMem cache outlives each test's DB rollback → clear it so the
      public micro-caches (availability, open-school, legal notice, settings)
      never serve one test's data to the next.
    * Login lockout (django-axes) would trip on tests that intentionally send
      wrong credentials → disable globally; the dedicated lockout tests
      re-enable it with override_settings.
    * The manifest static-files storage raises on any missing asset; use the
      plain storage so views that render templates don't blow up in CI.
    """
    from django.core.cache import cache

    cache.clear()
    settings.RATELIMIT_ENABLE = False
    settings.AXES_ENABLED = False
    settings.STORAGES = {
        **getattr(settings, "STORAGES", {}),
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
    settings.STATICFILES_STORAGE = "django.contrib.staticfiles.storage.StaticFilesStorage"


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def parent_user(db):
    from apps.accounts.models import User

    return User.objects.create_user(
        email="parent@test.mx",
        password="parent-pass-123",
        first_name="Paula",
        last_name="Padre",
        role=User.Role.PARENT,
    )


@pytest.fixture
def admin_user(db):
    from apps.accounts.models import User

    return User.objects.create_user(
        email="admin@test.mx",
        password="admin-pass-123",
        first_name="Ada",
        last_name="Admin",
        role=User.Role.ADMIN,
        is_staff=True,
    )


@pytest.fixture
def student_user(db):
    from apps.accounts.models import User

    return User.objects.create_user(
        email="student@test.mx",
        password="student-pass-123",
        first_name="Sam",
        last_name="Alumno",
        role=User.Role.STUDENT,
    )


@pytest.fixture
def auth_client(api_client, parent_user):
    api_client.force_authenticate(user=parent_user)
    return api_client


@pytest.fixture
def admin_client(api_client, admin_user):
    api_client.force_authenticate(user=admin_user)
    return api_client
