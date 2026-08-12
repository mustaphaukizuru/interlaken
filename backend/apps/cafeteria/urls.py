from django.urls import path

from . import views

urlpatterns = [
    path('balance/',                     views.MyBalanceView.as_view(),           name='cafeteria-balance'),
    path('transactions/',                views.MyTransactionsView.as_view(),      name='cafeteria-transactions'),
    path('spending-trend/',              views.MySpendingTrendView.as_view(),     name='cafeteria-spending-trend'),
    path('spending-categories/',         views.MySpendingCategoriesView.as_view(), name='cafeteria-spending-categories'),
    # Digital student card(s): code for QR/barcode + balance + Loyverse stats.
    path('cards/',                       views.MyCardsView.as_view(),             name='cafeteria-cards'),
    # Read-only recent purchases pulled live from Loyverse (does not touch ledger).
    path('loyverse-history/',            views.MyLoyverseHistoryView.as_view(),   name='cafeteria-loyverse-history'),
    path('balance/<int:student_pk>/threshold/', views.UpdateLowBalanceThresholdView.as_view(), name='cafeteria-threshold'),
    path('balance/<int:student_pk>/budget/',    views.UpdateSpendLimitsView.as_view(),         name='cafeteria-budget'),
    path('topup/',                       views.TopUpRequestCreateView.as_view(),  name='cafeteria-topup'),
    # Near-real-time Loyverse receipt push (shared-secret header, fail-closed).
    path('loyverse/webhook/',            views.LoyverseWebhookView.as_view(),     name='cafeteria-loyverse-webhook'),
    # Parent family statement (CSV of children's cafeteria transactions).
    path('export/',                      views.ParentExportView.as_view(),        name='cafeteria-export'),
    # On-demand Loyverse poll (parents/staff) — does not wait for cron.
    path('refresh/',                     views.RefreshFromLoyverseView.as_view(), name='cafeteria-refresh'),
    path('admin/balances/',              views.AdminBalancesView.as_view(),       name='admin-balances'),
    path('admin/topup/<int:pk>/apply/',  views.AdminApplyTopUpView.as_view(),     name='admin-apply-topup'),
    path('admin/topup/<int:pk>/pos-loaded/', views.AdminMarkTopUpPosLoadedView.as_view(),
         name='admin-topup-pos-loaded'),
    path('admin/topup/<int:pk>/pos-unloaded/', views.AdminMarkTopUpPosUnloadedView.as_view(),
         name='admin-topup-pos-unloaded'),
    path('admin/sync/<int:pk>/',         views.AdminSyncBalanceView.as_view(),    name='admin-sync-balance'),
    path('admin/sync-all/',              views.AdminSyncAllView.as_view(),        name='admin-sync-all'),

    # Phase D — admin console
    path('admin/topups/',                views.AdminTopUpLogView.as_view(),       name='admin-topups'),
    path('admin/student/<int:pk>/',      views.AdminStudentDetailView.as_view(),  name='admin-student-detail'),
    path('admin/adjust/<int:student_pk>/', views.AdminAdjustBalanceView.as_view(), name='admin-adjust'),
    path('admin/refund/<int:tx_pk>/',    views.AdminRefundView.as_view(),         name='admin-refund'),
    path('admin/reconcile/',             views.AdminReconcileView.as_view(),      name='admin-reconcile'),
    path('admin/low-balance/',           views.AdminLowBalanceView.as_view(),     name='admin-low-balance'),
    path('admin/export/student/<int:pk>/', views.AdminExportStudentView.as_view(), name='admin-export-student'),
    path('admin/export/school/',         views.AdminExportSchoolView.as_view(),   name='admin-export-school'),
]
