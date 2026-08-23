from django.urls import path

from . import password_views, views
from .admin_password import AdminSetPasswordView
from .avatar import AvatarServeView, MyAvatarView
from .exports import AdminExportStudentsView
from .guardian_link import StudentGuardianDetailView, StudentGuardiansView
from .import_students import ImportStudentsView
from .loyverse_import import ImportLoyverseView
from .loyverse_link import LinkLoyverseView
from .merge import GuardianMergePreviewView, GuardianMergeView
from .password_requests import PasswordRequestDetailView, PasswordRequestListCreateView
from .school_year import SchoolYearPreviewView, SchoolYearRunView
from .security import (
    CloseOtherSessionsView,
    MySessionsView,
    TotpDisableView,
    TotpEnableView,
    TotpSetupView,
)
from .staff_users import StaffDetailView, StaffListCreateView, StaffResetPasswordView
from .student_admin import AdminStudentBulkView, AdminStudentCreateView, AdminStudentUpdateView

urlpatterns = [
    path('admin/import-students/', ImportStudentsView.as_view(), name='import-students'),
    path('admin/export/students/', AdminExportStudentsView.as_view(), name='export-students'),
    path('admin/import-loyverse/', ImportLoyverseView.as_view(), name='import-loyverse'),
    path('admin/link-loyverse/',   LinkLoyverseView.as_view(),   name='link-loyverse'),
    # Portal student editor (ownership map: people are edited in the portal only).
    path('admin/students/', AdminStudentCreateView.as_view(), name='admin-student-create'),
    path('admin/guardians/merge/preview/', GuardianMergePreviewView.as_view(), name='guardian-merge-preview'),
    path('admin/guardians/merge/', GuardianMergeView.as_view(), name='guardian-merge'),
    path('admin/school-year/preview/', SchoolYearPreviewView.as_view(), name='school-year-preview'),
    path('admin/school-year/run/', SchoolYearRunView.as_view(), name='school-year-run'),
    path('admin/students/bulk/', AdminStudentBulkView.as_view(), name='admin-student-bulk'),
    path('admin/students/<int:pk>/', AdminStudentUpdateView.as_view(), name='admin-student-update'),
    path('admin/students/<int:pk>/guardians/', StudentGuardiansView.as_view(),
         name='student-guardians'),
    path('admin/students/<int:pk>/guardians/<int:user_id>/',
         StudentGuardianDetailView.as_view(), name='student-guardian-detail'),
    # School policy: only an admin resets a family's password (the imported
    # accounts have no usable one and cannot receive reset mail).
    path('admin/users/<int:pk>/set-password/', AdminSetPasswordView.as_view(),
         name='admin-set-password'),
    # Staff user management (P1-H1).
    path('admin/staff/', StaffListCreateView.as_view(), name='admin-staff'),
    path('admin/staff/<int:pk>/', StaffDetailView.as_view(), name='admin-staff-detail'),
    path('admin/staff/<int:pk>/reset-password/', StaffResetPasswordView.as_view(), name='admin-staff-reset'),
    # Password request inbox (families ask by WhatsApp/email; admins resolve here).
    path('admin/password-requests/', PasswordRequestListCreateView.as_view(), name='password-requests'),
    path('admin/password-requests/<int:pk>/', PasswordRequestDetailView.as_view(), name='password-request-detail'),
    path('token/',           views.RateLimitedTokenObtainView.as_view(), name='token-obtain'),
    path('token/refresh/',   views.CookieTokenRefreshView.as_view(), name='token-refresh'),
    path('google/token/',    views.GoogleTokenView.as_view(),     name='google-token'),
    path('me/',              views.CurrentUserView.as_view(),     name='current-user'),
    path('me/sessions/',     MySessionsView.as_view(),            name='my-sessions'),
    path('me/sessions/close-others/', CloseOtherSessionsView.as_view(), name='close-other-sessions'),
    path('me/totp/setup/',   TotpSetupView.as_view(),             name='totp-setup'),
    path('me/totp/enable/',  TotpEnableView.as_view(),            name='totp-enable'),
    path('me/totp/disable/', TotpDisableView.as_view(),           name='totp-disable'),
    path('me/avatar/',       MyAvatarView.as_view(),              name='my-avatar'),
    path('avatar/<int:user_id>/<str:token>/', AvatarServeView.as_view(), name='avatar-serve'),
    # No self-service password reset/change (school policy): see admin-set-password.
    path('notification-preferences/', password_views.NotificationPreferenceView.as_view(), name='notification-preferences'),
    path('students/',        views.StudentListView.as_view(),     name='students'),
    path('students/<int:pk>/', views.StudentDetailView.as_view(), name='student-detail'),
]
