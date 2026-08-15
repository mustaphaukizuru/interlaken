"""
Core API routes (mounted at /api/v1/core/). Kept separate from core/urls.py,
which only carries the SPA catch-all + WhatsApp redirect.
"""
from django.urls import path

from . import views

urlpatterns = [
    path('admin/audit/', views.AdminAuditLogView.as_view(), name='core-admin-audit'),
]
