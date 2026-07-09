"""
core/environment.py — environment marker for the unfold admin header/title.

Makes it impossible to confuse a development admin with production: a colored
label next to the user links and a title prefix on every tab.
"""
from django.conf import settings


def environment_callback(request):
    if settings.DEBUG:
        return ['Desarrollo', 'success']
    return ['Producción', 'danger']


def environment_title_prefix(request):
    return '[DEV]' if settings.DEBUG else ''
