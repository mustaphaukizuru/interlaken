from django.contrib import admin
from unfold.admin import ModelAdmin

# OpenSchoolDay is retired for publishing — live /puertas-abiertas reads
# bookings.AvailabilitySlot(visit_type=open_class). Manage dates in
# /admin/visitas (React) or bookings.AvailabilitySlot.
from .models import PreRegistration, Registration, RegistrationDocument


@admin.register(PreRegistration)
class PreRegistrationAdmin(ModelAdmin):
    list_display = ('child_first_name', 'child_last_name', 'parent_email',
                    'grade_applying', 'status', 'created_at')
    list_filter = ('status', 'level', 'cycle')
    search_fields = ('child_first_name', 'child_last_name', 'parent_name',
                     'parent_email', 'parent_phone')
    ordering = ('-created_at',)
    list_editable = ('status',)
    date_hierarchy = 'created_at'
    readonly_fields = ('created_at', 'updated_at')


@admin.register(Registration)
class RegistrationAdmin(ModelAdmin):
    list_display = ('child_first_name', 'child_last_name', 'parent1_email',
                    'grade_applying', 'status', 'submitted_at', 'created_at')
    list_filter = ('status', 'level', 'cycle')
    search_fields = ('child_first_name', 'child_last_name', 'parent1_email',
                     'parent1_phone', 'child_curp')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'
    # Access tokens and consent capture are audit data — never hand-edited.
    readonly_fields = ('access_token', 'invite_token_hash', 'invite_expires_at',
                       'invite_used_at', 'session_token_hash', 'session_expires_at',
                       'privacy_notice_version', 'privacy_accepted_at',
                       'submitted_at', 'created_at', 'updated_at')


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

