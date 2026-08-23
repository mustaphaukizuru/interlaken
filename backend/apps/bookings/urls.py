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
    path('admin/bookings/export/',             views.AdminBookingsExportView.as_view(), name='bookings-admin-export'),
    path('admin/bookings/<int:pk>/reschedule/', views.AdminBookingRescheduleView.as_view(), name='bookings-admin-reschedule'),
    path('admin/bookings/<int:pk>/outcome/', views.AdminBookingOutcomeView.as_view(), name='bookings-admin-outcome'),
    path('admin/week/',                        views.AdminWeekView.as_view(),          name='bookings-admin-week'),
    path('admin/bookings/<int:pk>/<str:action>/', views.AdminBookingActionView.as_view(), name='bookings-admin-action'),
    path('admin/slots/',                       views.AdminSlotListView.as_view(),      name='bookings-admin-slots'),
    path('admin/slots/<int:pk>/',              views.AdminSlotDetailView.as_view(),    name='bookings-admin-slot-detail'),
]
