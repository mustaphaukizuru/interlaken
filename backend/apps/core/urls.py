"""
Core: SPA catch-all + WhatsApp redirect.
Include this LAST in config/urls.py so it doesn't shadow API routes.
"""
from django.urls import path, re_path
from django.conf import settings
from django.views.generic import TemplateView
from django.http import HttpResponseRedirect
import urllib.parse


def whatsapp_redirect(request):
    number = getattr(settings, 'WHATSAPP_NUMBER', '5215512345678')
    message = urllib.parse.quote('Hola, me gustaría obtener más información sobre el Colegio Interlaken.')
    return HttpResponseRedirect(f'https://wa.me/{number}?text={message}')


urlpatterns = [
    path('whatsapp/', whatsapp_redirect, name='whatsapp-redirect'),
    # React SPA catch-all — must be last
    re_path(
        r'^(?!api/|admin/|auth/|static/|media/).*$',
        TemplateView.as_view(template_name='index.html'),
        name='spa-index',
    ),
]
