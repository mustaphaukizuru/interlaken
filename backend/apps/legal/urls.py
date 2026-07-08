from django.urls import path

from . import views

urlpatterns = [
    path('notice/',  views.CurrentNoticeView.as_view(), name='legal-notice'),
    path('consent/', views.ConsentView.as_view(),       name='legal-consent'),
]
