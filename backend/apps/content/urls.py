from django.urls import path

from .views import PublicSiteSettingsView

urlpatterns = [
    path('settings/', PublicSiteSettingsView.as_view(), name='site-settings'),
]
