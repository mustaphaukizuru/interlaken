from django.urls import path

from . import views

urlpatterns = [
    # Public
    path('availability/',            views.AvailabilityView.as_view(),      name='bookings-availability'),
    path('',                         views.BookingCreateView.as_view(),     name='bookings-create'),
    path('<int:pk>/',                views.BookingDetailView.as_view(),     name='bookings-detail'),
    path('<int:pk>/cancel/',         views.BookingCancelView.as_view(),     name='bookings-cancel'),

    # Admin
    path('admin/bookings/',                    views.AdminBookingsView.as_view(),      name='bookings-admin-list'),
    path('admin/bookings/<int:pk>/<str:action>/', views.AdminBookingActionView.as_view(), name='bookings-admin-action'),
]
