from django.urls import path

from . import views

urlpatterns = [
    path('notice/',  views.CurrentNoticeView.as_view(), name='legal-notice'),
    path('consent/', views.ConsentView.as_view(),       name='legal-consent'),

    # ARCO rights (B3)
    path('arco/',              views.ArcoRequestView.as_view(),     name='legal-arco'),
    path('arco/export/',       views.ArcoExportView.as_view(),      name='legal-arco-export'),
    path('admin/arco/',        views.AdminArcoListView.as_view(),   name='legal-admin-arco'),
    path('admin/arco/<int:pk>/status/', views.AdminArcoStatusView.as_view(),
         name='legal-admin-arco-status'),
]
