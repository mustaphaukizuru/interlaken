from django.urls import path

from .views import PublicSiteSettingsView, PublicTuitionCostsView

urlpatterns = [
    path('settings/', PublicSiteSettingsView.as_view(), name='site-settings'),
    path('costs/', PublicTuitionCostsView.as_view(), name='tuition-costs'),
]
