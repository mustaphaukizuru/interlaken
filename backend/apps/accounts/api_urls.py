from django.urls import path

from . import password_views, views
from .admin_password import AdminSetPasswordView
from .exports import AdminExportStudentsView
from .guardian_link import StudentGuardianDetailView, StudentGuardiansView
from .import_students import ImportStudentsView
from .loyverse_import import ImportLoyverseView
from .loyverse_link import LinkLoyverseView

urlpatterns = [
    path('admin/import-students/', ImportStudentsView.as_view(), name='import-students'),
    path('admin/export/students/', AdminExportStudentsView.as_view(), name='export-students'),
    path('admin/import-loyverse/', ImportLoyverseView.as_view(), name='import-loyverse'),
    path('admin/link-loyverse/',   LinkLoyverseView.as_view(),   name='link-loyverse'),
    path('admin/students/<int:pk>/guardians/', StudentGuardiansView.as_view(),
         name='student-guardians'),
    path('admin/students/<int:pk>/guardians/<int:user_id>/',
         StudentGuardianDetailView.as_view(), name='student-guardian-detail'),
    # School policy: only an admin resets a family's password (the imported
    # accounts have no usable one and cannot receive reset mail).
    path('admin/users/<int:pk>/set-password/', AdminSetPasswordView.as_view(),
         name='admin-set-password'),
    path('token/',           views.RateLimitedTokenObtainView.as_view(), name='token-obtain'),
    path('token/refresh/',   views.CookieTokenRefreshView.as_view(), name='token-refresh'),
    path('google/token/',    views.GoogleTokenView.as_view(),     name='google-token'),
    path('me/',              views.CurrentUserView.as_view(),     name='current-user'),
    path('password-reset/',  password_views.PasswordResetRequestView.as_view(), name='password-reset'),
    path('password-reset/confirm/', password_views.PasswordResetConfirmView.as_view(), name='password-reset-confirm'),
    path('set-password/',    password_views.SetPasswordView.as_view(), name='set-password'),
    path('notification-preferences/', password_views.NotificationPreferenceView.as_view(), name='notification-preferences'),
    path('students/',        views.StudentListView.as_view(),     name='students'),
    path('students/<int:pk>/', views.StudentDetailView.as_view(), name='student-detail'),
]
