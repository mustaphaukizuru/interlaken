from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.admissions.models import Registration

from .models import ArcoRequest, ConsentRecord, PrivacyNoticeVersion


@admin.register(ArcoRequest)
class ArcoRequestAdmin(ModelAdmin):
    list_display = ('created_at', 'request_type', 'requester_email', 'status',
                    'statutory_deadline', 'resolved_at')
    list_filter = ('request_type', 'status')
    search_fields = ('requester_email', 'details')
    # Status is read-only: ARCO requests move through the portal (transition
    # table, resolution note, the requester's email and the audit row).
    readonly_fields = ('requester', 'requester_email', 'request_type', 'details', 'status',
                       'statutory_deadline', 'created_at', 'updated_at', 'resolved_at')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'


@admin.register(PrivacyNoticeVersion)
class PrivacyNoticeVersionAdmin(ModelAdmin):
    list_display = ('version', 'title', 'effective_date', 'is_active', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('version', 'title')
    ordering = ('-effective_date',)
    readonly_fields = ('created_at',)
    # Once a version has been in force (active, or accepted by anyone) its text
    # is legal evidence of what people agreed to: it is frozen and cannot be
    # deleted. Publish a new version instead. «Vigente» stays editable so it
    # can be retired when the next version goes live.
    FROZEN_FIELDS = ('version', 'title', 'body', 'integral_notice_url', 'effective_date', 'created_at')

    @staticmethod
    def is_published(obj) -> bool:
        return bool(obj and obj.pk and (
            obj.is_active
            or obj.consent_records.exists()
            or Registration.objects.filter(privacy_notice_version=obj).exists()
        ))

    def get_readonly_fields(self, request, obj=None):
        if self.is_published(obj):
            return self.FROZEN_FIELDS
        return super().get_readonly_fields(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj is not None and self.is_published(obj):
            return False
        return super().has_delete_permission(request, obj)


@admin.register(ConsentRecord)
class ConsentRecordAdmin(ModelAdmin):
    """Read-only: consent records are immutable (revocation is a new record)."""
    list_display = ('captured_at', 'guardian', 'student', 'purpose', 'granted',
                    'notice_version', 'capture_context')
    list_filter = ('purpose', 'granted', 'notice_version')
    search_fields = ('guardian__email', 'capture_context')
    readonly_fields = ('guardian', 'student', 'notice_version', 'purpose', 'granted',
                       'captured_at', 'capture_context', 'capture_ip')
    ordering = ('-captured_at',)
    date_hierarchy = 'captured_at'
    list_select_related = ('guardian', 'student__user', 'notice_version')
    actions = None

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
