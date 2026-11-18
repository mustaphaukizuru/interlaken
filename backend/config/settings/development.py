import os
import sys

import environ
from django.core.exceptions import ImproperlyConfigured

from .base import *

DEBUG = True
ALLOWED_HOSTS = ['*']

# Use SQLite locally (SQLITE_LOCAL=1) or whenever a test run is in progress
# (pytest / `manage.py test`). Detecting the test run here guarantees the suite
# never touches Postgres even if the env var is set too late for the settings
# import (pytest-django imports settings very early).
_RUNNING_TESTS = 'pytest' in sys.modules or 'test' in sys.argv

# The one exception, opt-in: TEST_DATABASE_URL runs the TEST SUITE on a
# PostgreSQL server (CI's "Backend on PostgreSQL" job, or a throwaway local
# container). SQLite ignores row locks, so a ``select_for_update`` PostgreSQL
# refuses (outer join, GROUP BY) only ever failed in production. Read only while
# tests run: runserver and every other command keep their database, and
# production.py never loads this module.
#   TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55441/ik pytest
# pytest-django creates and drops ``test_<name>`` on that server, so only a
# local or CI host is accepted: never point it at Supabase or the VPS.
_TEST_DB_HOSTS = ('localhost', '127.0.0.1', '::1', 'postgres')
_TEST_DATABASE_URL = os.getenv('TEST_DATABASE_URL', '').strip() if _RUNNING_TESTS else ''
if _TEST_DATABASE_URL:
    _test_db = environ.Env.db_url_config(_TEST_DATABASE_URL)
    if 'postgresql' not in _test_db.get('ENGINE', ''):
        raise ImproperlyConfigured('TEST_DATABASE_URL must be a postgres:// URL.')
    if _test_db.get('HOST') not in _TEST_DB_HOSTS:
        raise ImproperlyConfigured(
            'TEST_DATABASE_URL must point at a local or CI PostgreSQL '
            f'({", ".join(_TEST_DB_HOSTS)}): the tests create and drop a database there.')
    DATABASES = {'default': _test_db}
elif os.getenv('SQLITE_LOCAL') or _RUNNING_TESTS:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': os.path.join(BASE_DIR.parent, 'db_local.sqlite3'),
        }
    }

EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
CORS_ALLOW_ALL_ORIGINS = True

# The Playwright E2E suite logs in through the real UI once per test — well past
# the 10/min per-IP login rate limit. Let the e2e run opt out via env, exactly
# like conftest.py does for pytest (dev-only module; production.py never loads
# this file).
if os.getenv('RATELIMIT_DISABLE'):
    RATELIMIT_ENABLE = False
