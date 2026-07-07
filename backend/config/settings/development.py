from .base import *
import os

DEBUG = True
ALLOWED_HOSTS = ['*']

# If MySQL is unavailable locally, set env var SQLITE_LOCAL=1 to use SQLite
if os.getenv('SQLITE_LOCAL'):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': os.path.join(BASE_DIR.parent, 'db_local.sqlite3'),
        }
    }

EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
CORS_ALLOW_ALL_ORIGINS = True
