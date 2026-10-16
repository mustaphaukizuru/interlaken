from django.urls import path

from . import views

urlpatterns = [
    path('initiate/',   views.PaymentInitiateView.as_view(),  name='payment-initiate'),
    path('availability/', views.PaymentAvailabilityView.as_view(), name='payment-availability'),
    path('banorte/result/', views.BanorteResultView.as_view(), name='payment-banorte-result'),
    path('sandbox/complete/', views.SandboxCompleteView.as_view(), name='payment-sandbox-complete'),
    path('history/',    views.PaymentHistoryView.as_view(),   name='payment-history'),
    path('history/export/', views.PaymentHistoryExportView.as_view(), name='payment-history-export'),
    path('summary/',    views.PaymentSummaryView.as_view(),   name='payment-summary'),
    path('admin/',      views.AdminPaymentsView.as_view(),    name='admin-payments'),
    path('admin/export/', views.AdminPaymentsExportView.as_view(), name='admin-payments-export'),
    path('admin/summary/', views.AdminPaymentsSummaryView.as_view(), name='admin-payments-summary'),
    path('admin/<int:pk>/banorte-verify/', views.AdminBanorteVerifyView.as_view(),
         name='admin-payment-banorte-verify'),
    path('admin/<int:pk>/banorte-reconcile/', views.AdminBanorteReconcileView.as_view(),
         name='admin-payment-banorte-reconcile'),
    path('<int:pk>/',   views.PaymentDetailView.as_view(),    name='payment-detail'),
    path('<int:pk>/receipt/', views.PaymentReceiptView.as_view(), name='payment-receipt'),
]
