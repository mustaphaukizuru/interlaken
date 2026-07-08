from django.urls import path

from .views import WhatsAppWebhookView

urlpatterns = [
    path('webhook/', WhatsAppWebhookView.as_view(), name='whatsapp-webhook'),
]
