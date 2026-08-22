from django.urls import path

from .media import MediaDetailView, MediaListCreateView, MediaServeView
from .views import (
    AdminCalendarDetailView,
    AdminCalendarView,
    AdminSiteSettingsView,
    AdminTestimonialDetailView,
    AdminTestimonialsView,
    PublicCalendarView,
    PublicPricingView,
    PublicSiteSettingsView,
    PublicTestimonialsView,
    PublicTuitionCostsView,
)

urlpatterns = [
    path('settings/', PublicSiteSettingsView.as_view(), name='site-settings'),
    path('costs/', PublicTuitionCostsView.as_view(), name='tuition-costs'),
    path('pricing/', PublicPricingView.as_view(), name='pricing-bundle'),
    path('admin/settings/', AdminSiteSettingsView.as_view(), name='admin-site-settings'),
    path('calendar/', PublicCalendarView.as_view(), name='school-calendar'),
    path('testimonials/', PublicTestimonialsView.as_view(), name='testimonials'),
    path('media/<int:pk>/<str:variant>/', MediaServeView.as_view(), name='media-serve'),
    path('admin/media/', MediaListCreateView.as_view(), name='admin-media'),
    path('admin/media/<int:pk>/', MediaDetailView.as_view(), name='admin-media-detail'),
    path('admin/testimonials/', AdminTestimonialsView.as_view(), name='admin-testimonials'),
    path('admin/testimonials/<int:pk>/', AdminTestimonialDetailView.as_view(), name='admin-testimonial-detail'),
    path('admin/calendar/', AdminCalendarView.as_view(), name='admin-calendar'),
    path('admin/calendar/<int:pk>/', AdminCalendarDetailView.as_view(), name='admin-calendar-detail'),
]
