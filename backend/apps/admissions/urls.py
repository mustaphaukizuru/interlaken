from django.urls import path

from . import ficha_views, process_views, required_docs_views, views
from .bulk import DocumentBulkView, PreRegistrationBulkView, RegistrationBulkView
from .exports import PreRegistrationExportView, RegistrationExportView
from .ficha_export import views as ficha_export
from .imports import PreRegistrationImportTemplateView, PreRegistrationImportView
from .pipeline import ConvertView, PipelineView, RequestDocsView, TemplatesView

urlpatterns = [
    path('pre-register/export/',       PreRegistrationExportView.as_view(),          name='pre-register-export'),
    path('pre-register/',              views.PreRegistrationListCreateView.as_view(), name='pre-register'),
    path('pre-register/<int:pk>/',     views.PreRegistrationDetailView.as_view(),     name='pre-register-detail'),
    path('pre-register/<int:pk>/invite/', views.PreRegistrationInviteView.as_view(),  name='pre-register-invite'),
    path('my-registrations/',          views.MyRegistrationsView.as_view(),         name='my-registrations'),
    path('register/export/',           RegistrationExportView.as_view(),             name='register-export'),
    path('register/',                  views.RegistrationListCreateView.as_view(),  name='register-create'),
    path('register/resume/',           ficha_views.RegistrationResumeView.as_view(), name='register-resume'),
    path('ficha/schema/',              ficha_views.FichaSchemaView.as_view(),        name='ficha-schema'),
    path('register/<int:pk>/ficha/',   ficha_views.FichaView.as_view(),              name='register-ficha'),
    # Fase 3 downloads; before the <slug:section> route, which would swallow «export».
    path('register/<int:pk>/ficha/export/', ficha_export.FichaExportView.as_view(), name='register-ficha-export'),
    path('register/fichas/export/',    ficha_export.FichasZipView.as_view(),         name='register-fichas-export'),
    path('register/fichas/concentrado/', ficha_export.FichaConcentradoView.as_view(),
         name='register-fichas-concentrado'),
    path('ficha/blank/',               ficha_export.BlankFichaView.as_view(),        name='ficha-blank'),
    path('register/<int:pk>/ficha/<slug:section>/', ficha_views.FichaSectionView.as_view(),
         name='register-ficha-section'),
    path('register/<int:pk>/access/',  views.RegistrationAccessView.as_view(),      name='register-access'),
    path('register/<int:pk>/status/',  views.RegistrationStatusView.as_view(),      name='register-status'),
    path('register/<int:pk>/',         views.RegistrationDetailView.as_view(),      name='register-detail'),
    path('register/<int:pk>/submit/',  views.RegistrationSubmitView.as_view(),      name='register-submit'),
    path('register/<int:pk>/documents/', required_docs_views.DocumentUploadView.as_view(), name='register-docs'),
    path('register/<int:pk>/documents/list/', required_docs_views.DocumentListView.as_view(),
         name='register-docs-list'),
    path('register/<int:pk>/documents-link/', views.DocumentsLinkView.as_view(),   name='register-docs-link'),
    # «Pedir un enlace nuevo» (public, from a used or expired documents link).
    path('documents/new-link/', required_docs_views.DocumentsNewLinkView.as_view(),
         name='documents-new-link'),
    path('documents/<int:pk>/verify/', views.DocumentVerifyView.as_view(),          name='document-verify'),
    path('documents/<int:pk>/download/', views.DocumentDownloadView.as_view(),      name='document-download'),
    path('admin/pre-registrations/bulk/', PreRegistrationBulkView.as_view(),         name='pre-register-bulk'),
    path('admin/pre-registrations/import/', PreRegistrationImportView.as_view(),     name='pre-register-import'),
    path('admin/pre-registrations/import/template/', PreRegistrationImportTemplateView.as_view(),
         name='pre-register-import-template'),
    path('admin/registrations/bulk/',  RegistrationBulkView.as_view(),               name='register-bulk'),
    path('admin/documents/bulk/',      DocumentBulkView.as_view(),                   name='document-bulk'),
    path('admin/pipeline/',            PipelineView.as_view(),                       name='admissions-pipeline'),
    path('admin/templates/',           TemplatesView.as_view(),                      name='admissions-templates'),
    path('admin/register/<int:pk>/request-docs/', RequestDocsView.as_view(),         name='register-request-docs'),
    path('admin/register/<int:pk>/convert/', ConvertView.as_view(),                  name='register-convert'),
    # Fase 4: required documents by level.
    path('required-documents/',        required_docs_views.PublicRequiredDocumentsView.as_view(),
         name='required-documents'),
    path('admin/required-documents/',  required_docs_views.RequiredDocumentListCreateView.as_view(),
         name='admin-required-documents'),
    path('admin/required-documents/reorder/', required_docs_views.RequiredDocumentReorderView.as_view(),
         name='admin-required-documents-reorder'),
    path('admin/required-documents/<int:pk>/', required_docs_views.RequiredDocumentDetailView.as_view(),
         name='admin-required-document'),
    path('admin/register/<int:pk>/checklist/', required_docs_views.RegistrationChecklistView.as_view(),
         name='register-checklist'),
    path('admin/register/<int:pk>/checklist/reminder/',
         required_docs_views.RegistrationDocumentsReminderView.as_view(), name='register-checklist-reminder'),
    path('admin/register/<int:pk>/checklist/<slug:key>/state/',
         required_docs_views.RegistrationDocumentStateView.as_view(), name='register-checklist-state'),
    path('open-school/',               views.OpenSchoolDayListView.as_view(),       name='open-school-list'),
    path('open-school/signup/',        views.OpenSchoolDaySignUpView.as_view(),     name='open-school-signup'),
]

# ── Expediente de admisión (Fase 5): admissions/process_views.py ───────────
pv = process_views
urlpatterns += [
    path('admin/cases/',                          pv.CaseListCreateView.as_view(), name='cases'),
    path('admin/cases/templates/',                pv.CaseTemplatesView.as_view(),  name='cases-templates'),
    path('admin/cases/<int:pk>/',                 pv.CaseDetailView.as_view(),     name='case-detail'),
    path('admin/cases/<int:pk>/move/',            pv.CaseMoveView.as_view(),       name='case-move'),
    path('admin/cases/<int:pk>/close/',           pv.CaseCloseView.as_view(),      name='case-close'),
    path('admin/cases/<int:pk>/reopen/',          pv.CaseReopenView.as_view(),     name='case-reopen'),
    path('admin/cases/<int:pk>/enroll/',          pv.CaseEnrollView.as_view(),     name='case-enroll'),
    path('admin/cases/<int:pk>/actions/<slug:action>/', pv.CaseActionView.as_view(), name='case-action'),
    path('admin/cases/<int:pk>/discounts/',       pv.DiscountListView.as_view(),   name='case-discounts'),
    path('admin/cases/<int:pk>/discounts/<int:item>/', pv.DiscountDetailView.as_view(),
         name='case-discount-detail'),
    path('admin/cases/<int:pk>/payments/',        pv.PaymentListView.as_view(),    name='case-payments'),
    path('admin/cases/<int:pk>/payments/<int:item>/', pv.PaymentDetailView.as_view(),
         name='case-payment-detail'),
    path('admin/cases/<int:pk>/visita/',          pv.CaseVisitStageView.as_view(), name='case-stage-visita'),
    path('admin/cases/<int:pk>/<slug:stage>/',    pv.CaseStageView.as_view(),      name='case-stage'),
    path('admin/exams/',                          pv.ExamsView.as_view(),          name='case-exams'),
    path('admin/cuotas/<slug:level>.pdf',         pv.CuotasPdfPreviewView.as_view(), name='cuotas-pdf-preview'),
    path('cuotas/<slug:level>.pdf',               pv.CuotasPdfView.as_view(),      name='cuotas-pdf'),
]
