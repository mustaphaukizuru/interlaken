from django.urls import path

from . import views

urlpatterns = [
    path('pre-register/',              views.PreRegistrationListCreateView.as_view(), name='pre-register'),
    path('pre-register/<int:pk>/',     views.PreRegistrationDetailView.as_view(),     name='pre-register-detail'),
    path('pre-register/<int:pk>/invite/', views.PreRegistrationInviteView.as_view(),  name='pre-register-invite'),
    path('register/',                  views.RegistrationListCreateView.as_view(),  name='register-create'),
    path('register/<int:pk>/access/',  views.RegistrationAccessView.as_view(),      name='register-access'),
    path('register/<int:pk>/status/',  views.RegistrationStatusView.as_view(),      name='register-status'),
    path('register/<int:pk>/',         views.RegistrationDetailView.as_view(),      name='register-detail'),
    path('register/<int:pk>/submit/',  views.RegistrationSubmitView.as_view(),      name='register-submit'),
    path('register/<int:pk>/documents/', views.DocumentUploadView.as_view(),        name='register-docs'),
    path('documents/<int:pk>/verify/', views.DocumentVerifyView.as_view(),          name='document-verify'),
    path('open-school/',               views.OpenSchoolDayListView.as_view(),       name='open-school-list'),
    path('open-school/signup/',        views.OpenSchoolDaySignUpView.as_view(),     name='open-school-signup'),
]
