from django.contrib import admin
from unfold.admin import ModelAdmin

# OpenSchoolDay is retired for publishing — live /puertas-abiertas reads
# bookings.AvailabilitySlot(visit_type=open_class). Manage dates in
# /admin/visitas (React) or bookings.AvailabilitySlot.
from .models import (
    AdmissionDiscount,
    EnrollmentPayment,
    PreRegistration,
    Registration,
    RegistrationDocument,
    RegistrationGuardian,
)


class RegistrationGuardianInline(admin.StackedInline):
    model = RegistrationGuardian
    extra = 0
    max_num = 2


@admin.register(PreRegistration)
class PreRegistrationAdmin(ModelAdmin):
    list_display = ('child_first_name', 'child_last_name', 'parent_email',
                    'grade_applying', 'status', 'created_at')
    list_filter = ('status', 'level', 'cycle')
    search_fields = ('child_first_name', 'child_last_name', 'parent_name',
                     'parent_email', 'parent_phone')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'
    # Status changes only from the portal (admissions.services.change_status:
    # transition table, emails and audit row), never by hand here.
    readonly_fields = ('status', 'created_at', 'updated_at')


@admin.register(Registration)
class RegistrationAdmin(ModelAdmin):
    list_display = ('child_first_name', 'child_last_name', 'parent1_email',
                    'grade_applying', 'status', 'submitted_at', 'created_at')
    list_filter = ('status', 'level', 'cycle')
    search_fields = ('child_first_name', 'child_last_name', 'parent1_email',
                     'parent1_phone', 'child_curp')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'
    # Access tokens and consent capture are audit data, never hand-edited.
    # Status moves only through the portal (transition table, outcome emails,
    # the convert path that creates the student and logins, audit row).
    readonly_fields = ('status', 'access_token', 'invite_token_hash', 'invite_expires_at',
                       'invite_used_at', 'session_token_hash', 'session_expires_at',
                       'privacy_notice_version', 'privacy_accepted_at',
                       'signed_name', 'signed_at', 'signed_ip',
                       'submitted_at', 'created_at', 'updated_at')
    inlines = [RegistrationGuardianInline]


@admin.register(RegistrationDocument)
class RegistrationDocumentAdmin(ModelAdmin):
    list_display = ('registration', 'doc_type', 'filename', 'is_verified', 'uploaded_at')
    list_filter = ('doc_type', 'is_verified')
    list_editable = ('is_verified',)
    search_fields = ('filename', 'registration__child_first_name',
                     'registration__child_last_name')
    date_hierarchy = 'uploaded_at'
    raw_id_fields = ('registration',)
    list_select_related = ('registration',)
    readonly_fields = ('filename', 'file_size', 'uploaded_at')


class _ExpedienteRecordAdmin(ModelAdmin):
    """Becas/descuentos and inscripción payments of the Expediente (Fase 5):
    a read-only system-of-record view. They are written in /admin/admisiones/<id>
    (validation, audit row per change) and never deleted: «Anular» voids them
    there, so the case history keeps them. See docs/ADMIN-VS-PORTAL.md."""

    list_select_related = ('pre_registration',)
    raw_id_fields = ('pre_registration',)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AdmissionDiscount)
class AdmissionDiscountAdmin(_ExpedienteRecordAdmin):
    list_display = ('pre_registration', 'kind', 'percent', 'amount', 'duration',
                    'authorized_by', 'created_at', 'voided_at')
    list_filter = ('kind', 'duration', ('voided_at', admin.EmptyFieldListFilter))
    search_fields = ('pre_registration__child_first_name', 'pre_registration__child_last_name',
                     'pre_registration__parent_name', 'authorized_by')
    date_hierarchy = 'created_at'
    readonly_fields = ('pre_registration', 'kind', 'percent', 'amount', 'duration', 'start_month',
                       'end_month', 'authorized_by', 'note', 'created_by', 'created_at',
                       'updated_at', 'voided_at', 'void_reason')


@admin.register(EnrollmentPayment)
class EnrollmentPaymentAdmin(_ExpedienteRecordAdmin):
    list_display = ('pre_registration', 'paid_on', 'amount', 'method', 'reference',
                    'recorded_by', 'voided_at')
    list_filter = ('method', ('voided_at', admin.EmptyFieldListFilter))
    search_fields = ('pre_registration__child_first_name', 'pre_registration__child_last_name',
                     'pre_registration__parent_name', 'reference')
    date_hierarchy = 'paid_on'
    readonly_fields = ('pre_registration', 'paid_on', 'amount', 'method', 'reference', 'note',
                       'recorded_by', 'created_at', 'updated_at', 'voided_at', 'void_reason')
