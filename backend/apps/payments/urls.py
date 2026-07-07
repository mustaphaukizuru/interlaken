from django.urls import path

from . import views

urlpatterns = [
    path('initiate/',   views.PaymentInitiateView.as_view(),  name='payment-initiate'),
    path('webhook/',    views.PaymentWebhookView.as_view(),   name='payment-webhook'),
    path('history/',    views.PaymentHistoryView.as_view(),   name='payment-history'),
    path('<int:pk>/',   views.PaymentDetailView.as_view(),    name='payment-detail'),
]
