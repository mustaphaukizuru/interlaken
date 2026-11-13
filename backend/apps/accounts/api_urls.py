from django.urls import path

from . import password_views, views
from .admin_password import AdminSetPasswordView
from .avatar import AvatarServeView, MyAvatarView
from .exports import AdminStudentExportView
from .families_admin import (
    FamilyBulkView,
    FamilyDetailView,
    FamilyExportView,
    FamilyLinkView,
    FamilyListView,
    FamilyStudentDetailView,
    FamilySuggestionsBulkView,
    FamilySuggestionsView,
    StudentFamilyView,
)
from .family_self import MyFamilyAddView, MyFamilyConfirmView, MyFamilyView
from .guardian_link import StudentGuardianDetailView, StudentGuardiansView
from .import_students import ImportStudentsTemplateView, ImportStudentsView
from .loyverse_import import ImportLoyverseView
from .loyverse_link import LinkLoyverseView
from .merge import GuardianMergePreviewView, GuardianMergeView
from .notify_email import NotifyEmailConfirmView, NotifyEmailVerifyView, NotifyEmailView
from .password_requests import (
    PasswordRequestBulkView,
    PasswordRequestDetailView,
    PasswordRequestExportView,
    PasswordRequestListCreateView,
)
from .school_year import SchoolYearPreviewView, SchoolYearRunView
from .security import (
    CloseOtherSessionsView,
    MySessionsView,
    TotpDisableView,
    TotpEnableView,
    TotpSetupView,
)
from .staff_users import (
    StaffActivityView,
    StaffBulkView,
    StaffDetailView,
    StaffExportView,
    StaffImportTemplateView,
    StaffImportView,
    StaffListCreateView,
    StaffResetPasswordView,
)
from .student_admin import (
    AdminStudentBulkView,
    AdminStudentCreateView,
    AdminStudentHistoryView,
    AdminStudentUpdateView,
)

urlpatterns = [
    # Data Ops (C3/C4/C5): export, import and bulk on the roster.
    path('admin/students/export/', AdminStudentExportView.as_view(), name='export-students'),
    path('admin/students/import/', ImportStudentsView.as_view(), name='import-students'),
    path('admin/students/import/template/', ImportStudentsTemplateView.as_view(),
         name='import-students-template'),
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
    path('admin/students/<int:pk>/history/', AdminStudentHistoryView.as_view(),
         name='admin-student-history'),
    # Families (hermanos), 2026-11-13: accounts.families_admin.
    path('admin/families/', FamilyListView.as_view(), name='admin-families'),
    path('admin/families/export/', FamilyExportView.as_view(), name='admin-families-export'),
    path('admin/families/bulk/', FamilyBulkView.as_view(), name='admin-families-bulk'),
    path('admin/families/link/', FamilyLinkView.as_view(), name='admin-families-link'),
    path('admin/families/suggestions/', FamilySuggestionsView.as_view(), name='admin-family-suggestions'),
    path('admin/families/suggestions/bulk/', FamilySuggestionsBulkView.as_view(),
         name='admin-family-suggestions-bulk'),
    path('admin/families/<int:pk>/', FamilyDetailView.as_view(), name='admin-family-detail'),
    path('admin/families/<int:pk>/students/<int:student_id>/', FamilyStudentDetailView.as_view(),
         name='admin-family-student'),
    path('admin/students/<int:pk>/family/', StudentFamilyView.as_view(), name='admin-student-family'),
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
    path('admin/staff/export/', StaffExportView.as_view(), name='admin-staff-export'),
    path('admin/staff/bulk/', StaffBulkView.as_view(), name='admin-staff-bulk'),
    path('admin/staff/import/', StaffImportView.as_view(), name='admin-staff-import'),
    path('admin/staff/import/template/', StaffImportTemplateView.as_view(),
         name='admin-staff-import-template'),
    path('admin/staff/<int:pk>/', StaffDetailView.as_view(), name='admin-staff-detail'),
    path('admin/staff/<int:pk>/reset-password/', StaffResetPasswordView.as_view(), name='admin-staff-reset'),
    path('admin/staff/<int:pk>/activity/', StaffActivityView.as_view(), name='admin-staff-activity'),
    # Password request inbox (families ask by WhatsApp/email; admins resolve here).
    path('admin/password-requests/', PasswordRequestListCreateView.as_view(), name='password-requests'),
    path('admin/password-requests/export/', PasswordRequestExportView.as_view(),
         name='password-requests-export'),
    path('admin/password-requests/bulk/', PasswordRequestBulkView.as_view(),
         name='password-requests-bulk'),
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
    # Personal email for notifications, confirmed by a signed link (owner, 2026-10-20).
    path('me/notify-email/',  NotifyEmailView.as_view(),          name='my-notify-email'),
    # A family adds another child itself (code to that child's mailbox), 2026-11-13.
    path('me/family/',         MyFamilyView.as_view(),         name='my-family'),
    path('me/family/add/',     MyFamilyAddView.as_view(),      name='my-family-add'),
    path('me/family/confirm/', MyFamilyConfirmView.as_view(),  name='my-family-confirm'),
    path('me/notify-email/verify/', NotifyEmailVerifyView.as_view(), name='my-notify-email-verify'),
    path('notify-email/confirm/', NotifyEmailConfirmView.as_view(), name='notify-email-confirm'),
    path('avatar/<int:user_id>/<str:token>/', AvatarServeView.as_view(), name='avatar-serve'),
    # No self-service password reset/change (school policy): see admin-set-password.
    path('notification-preferences/', password_views.NotificationPreferenceView.as_view(), name='notification-preferences'),
    path('students/',        views.StudentListView.as_view(),     name='students'),
    path('students/<int:pk>/', views.StudentDetailView.as_view(), name='student-detail'),
]
