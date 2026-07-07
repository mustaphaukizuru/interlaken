"""
GoDaddy Passenger WSGI entry point.
Set DJANGO_SETTINGS_MODULE to production before deploying.
"""
import os
import sys

# Add the project root to sys.path
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')

from django.core.wsgi import get_wsgi_application

application = get_wsgi_application()
