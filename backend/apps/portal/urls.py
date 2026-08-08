from django.urls import path

from . import views
from .analytics import StaffAnalyticsView
from .push import PushSubscribeView, PushUnsubscribeView

urlpatterns = [
    path('dashboard/',                   views.DashboardView.as_view(),             name='dashboard'),
    path('analytics/',                   StaffAnalyticsView.as_view(),               name='staff-analytics'),
    path('announcements/',               views.AnnouncementListView.as_view(),       name='announcements'),
    path('announcements/mark-read/',     views.AnnouncementMarkReadView.as_view(),   name='announcements-mark-read'),
    path('announcements/<int:pk>/',      views.AnnouncementDetailView.as_view(),     name='announcement-detail'),
    path('announcements/<int:pk>/comments/', views.AnnouncementCommentListCreateView.as_view(), name='announcement-comments'),
    path('admin/announcements/',         views.AnnouncementAdminListCreateView.as_view(), name='admin-announcements'),
    path('admin/announcements/<int:pk>/', views.AnnouncementAdminDetailView.as_view(),   name='admin-announcement-detail'),
    path('admin/broadcast/',             views.EmergencyBroadcastView.as_view(),         name='admin-broadcast'),
    path('notifications/',               views.NotificationListView.as_view(),       name='notifications'),
    path('notifications/mark-all-read/', views.NotificationMarkAllReadView.as_view(), name='notifications-mark-all-read'),
    path('notifications/<int:pk>/read/', views.NotificationMarkReadView.as_view(),   name='notification-read'),
    path('push/subscribe/',              PushSubscribeView.as_view(),                name='push-subscribe'),
    path('push/unsubscribe/',            PushUnsubscribeView.as_view(),              name='push-unsubscribe'),
]
