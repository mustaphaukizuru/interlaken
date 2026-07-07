from django.urls import path
from . import views

urlpatterns = [
    path('dashboard/',                   views.DashboardView.as_view(),             name='dashboard'),
    path('announcements/',               views.AnnouncementListView.as_view(),       name='announcements'),
    path('notifications/',               views.NotificationListView.as_view(),       name='notifications'),
    path('notifications/<int:pk>/read/', views.NotificationMarkReadView.as_view(),   name='notification-read'),
]
