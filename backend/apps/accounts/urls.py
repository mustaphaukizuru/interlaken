from django.urls import path

from . import views

urlpatterns = [
    path('google/',          views.GoogleLoginView.as_view(),    name='google-login'),
    path('google/callback/', views.GoogleCallbackView.as_view(), name='google-callback'),
    path('logout/',          views.LogoutView.as_view(),         name='logout'),
]
