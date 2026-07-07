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
