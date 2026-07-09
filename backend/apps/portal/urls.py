from django.urls import path

from . import views
from .analytics import StaffAnalyticsView

urlpatterns = [
    path('dashboard/',                   views.DashboardView.as_view(),             name='dashboard'),
    path('analytics/',                   StaffAnalyticsView.as_view(),               name='staff-analytics'),
    path('announcements/',               views.AnnouncementListView.as_view(),       name='announcements'),
    path('announcements/mark-read/',     views.AnnouncementMarkReadView.as_view(),   name='announcements-mark-read'),
    path('notifications/',               views.NotificationListView.as_view(),       name='notifications'),
    path('notifications/<int:pk>/read/', views.NotificationMarkReadView.as_view(),   name='notification-read'),
]
