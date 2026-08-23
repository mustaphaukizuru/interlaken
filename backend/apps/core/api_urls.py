"""
Core API routes (mounted at /api/v1/core/). Kept separate from core/urls.py,
which only carries the SPA catch-all + WhatsApp redirect.
"""
from django.urls import path

from . import views

urlpatterns = [
    path('admin/audit/', views.AdminAuditLogView.as_view(), name='core-admin-audit'),
    path('admin/audit/export/', views.AdminAuditExportView.as_view(), name='core-admin-audit-export'),
    path('badges/', views.PortalBadgesView.as_view(), name='core-badges'),
    path('admin/contact-messages/', views.ContactInboxView.as_view(), name='core-contact-inbox'),
    path('admin/contact-messages/<int:pk>/', views.ContactMessageHandleView.as_view(), name='core-contact-handle'),
]
