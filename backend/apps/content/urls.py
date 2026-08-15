from django.urls import path

from .views import (
    AdminSiteSettingsView, PublicPricingView, PublicSiteSettingsView,
    PublicTuitionCostsView,
)

urlpatterns = [
    path('settings/', PublicSiteSettingsView.as_view(), name='site-settings'),
    path('costs/', PublicTuitionCostsView.as_view(), name='tuition-costs'),
    path('pricing/', PublicPricingView.as_view(), name='pricing-bundle'),
    path('admin/settings/', AdminSiteSettingsView.as_view(), name='admin-site-settings'),
]
