from django.urls import path

from . import views

urlpatterns = [
    path('balance/',                     views.MyBalanceView.as_view(),           name='cafeteria-balance'),
    path('transactions/',                views.MyTransactionsView.as_view(),      name='cafeteria-transactions'),
    path('topup/',                       views.TopUpRequestCreateView.as_view(),  name='cafeteria-topup'),
    path('admin/balances/',              views.AdminBalancesView.as_view(),       name='admin-balances'),
    path('admin/topup/<int:pk>/apply/',  views.AdminApplyTopUpView.as_view(),     name='admin-apply-topup'),
    path('admin/sync/<int:pk>/',         views.AdminSyncBalanceView.as_view(),    name='admin-sync-balance'),
    path('admin/sync-all/',              views.AdminSyncAllView.as_view(),        name='admin-sync-all'),
]
