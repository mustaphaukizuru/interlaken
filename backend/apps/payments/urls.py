from django.urls import path

from . import views

urlpatterns = [
    path('initiate/',   views.PaymentInitiateView.as_view(),  name='payment-initiate'),
    path('webhook/',    views.PaymentWebhookView.as_view(),   name='payment-webhook'),
    path('webhook/global-payments/', views.GlobalPaymentsWebhookView.as_view(),
         name='payment-webhook-global-payments'),
    path('webhook/banorte/',         views.BanorteWebhookView.as_view(),
         name='payment-webhook-banorte'),
    path('sandbox/complete/', views.SandboxCompleteView.as_view(), name='payment-sandbox-complete'),
    path('history/',    views.PaymentHistoryView.as_view(),   name='payment-history'),
    path('history/export/', views.PaymentHistoryExportView.as_view(), name='payment-history-export'),
    path('summary/',    views.PaymentSummaryView.as_view(),   name='payment-summary'),
    path('<int:pk>/',   views.PaymentDetailView.as_view(),    name='payment-detail'),
]
