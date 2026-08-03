from django.urls import path

from .views import AdminSiteSettingsView, PublicSiteSettingsView, PublicTuitionCostsView

urlpatterns = [
    path('settings/', PublicSiteSettingsView.as_view(), name='site-settings'),
    path('costs/', PublicTuitionCostsView.as_view(), name='tuition-costs'),
    path('admin/settings/', AdminSiteSettingsView.as_view(), name='admin-site-settings'),
]
