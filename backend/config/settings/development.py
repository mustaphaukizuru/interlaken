import os
import sys

from .base import *

DEBUG = True
ALLOWED_HOSTS = ['*']

# Use SQLite when MySQL is unavailable locally (SQLITE_LOCAL=1) or whenever a
# test run is in progress (pytest / `manage.py test`). Detecting the test run
# here guarantees the suite never touches MySQL even if the env var is set too
# late for the settings import (pytest-django imports settings very early).
_RUNNING_TESTS = 'pytest' in sys.modules or 'test' in sys.argv
if os.getenv('SQLITE_LOCAL') or _RUNNING_TESTS:
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
