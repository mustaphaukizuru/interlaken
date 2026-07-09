from django.urls import path

from . import views
from .import_students import ImportStudentsView

urlpatterns = [
    path('admin/import-students/', ImportStudentsView.as_view(), name='import-students'),
    path('token/',           views.RateLimitedTokenObtainView.as_view(), name='token-obtain'),
    path('token/refresh/',   views.CookieTokenRefreshView.as_view(), name='token-refresh'),
    path('google/token/',    views.GoogleTokenView.as_view(),     name='google-token'),
    path('me/',              views.CurrentUserView.as_view(),     name='current-user'),
    path('students/',        views.StudentListView.as_view(),     name='students'),
    path('students/<int:pk>/', views.StudentDetailView.as_view(), name='student-detail'),
]
