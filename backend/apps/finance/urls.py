from django.urls import path

from . import views

urlpatterns = [
    # Parent portal
    path('invoices/',                    views.MyInvoicesView.as_view(),      name='finance-invoices'),
    path('invoices/<int:pk>/',           views.InvoiceDetailView.as_view(),   name='finance-invoice-detail'),
    path('invoices/<int:pk>/pay/',       views.InvoicePayView.as_view(),      name='finance-invoice-pay'),
    path('invoices/<int:pk>/receipt/',   views.InvoiceReceiptView.as_view(),  name='finance-invoice-receipt'),

    # Admin finance console
    path('admin/dashboard/',             views.AdminDashboardView.as_view(),      name='finance-admin-dashboard'),
    path('admin/invoices/',              views.AdminInvoiceListView.as_view(),    name='finance-admin-invoices'),
    path('admin/invoices/<int:pk>/',     views.AdminInvoiceDetailView.as_view(),  name='finance-admin-invoice'),
    path('admin/invoices/<int:pk>/mark-paid/', views.AdminMarkPaidView.as_view(), name='finance-admin-mark-paid'),
    path('admin/invoices/<int:pk>/adjust/',    views.AdminAdjustInvoiceView.as_view(), name='finance-admin-adjust'),
    path('admin/invoices/<int:pk>/cancel/',    views.AdminCancelInvoiceView.as_view(), name='finance-admin-cancel'),
    path('admin/student/<int:pk>/',      views.AdminStudentLedgerView.as_view(),  name='finance-admin-student'),
    path('admin/generate/',              views.AdminGenerateInvoicesView.as_view(), name='finance-admin-generate'),
    path('admin/bulk/',                  views.AdminBulkActionView.as_view(),     name='finance-admin-bulk'),
    path('admin/fee-schedules/',         views.AdminFeeScheduleListCreateView.as_view(), name='finance-admin-fees'),
    path('admin/fee-schedules/<int:pk>/', views.AdminFeeScheduleDetailView.as_view(),    name='finance-admin-fee-detail'),
]
