from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import ArcoRequest, ConsentRecord, PrivacyNoticeVersion


@admin.register(ArcoRequest)
class ArcoRequestAdmin(ModelAdmin):
    list_display = ('created_at', 'request_type', 'requester_email', 'status',
                    'statutory_deadline', 'resolved_at')
    list_filter = ('request_type', 'status')
    search_fields = ('requester_email', 'details')
    readonly_fields = ('requester', 'requester_email', 'request_type', 'details',
                       'statutory_deadline', 'created_at', 'updated_at', 'resolved_at')
    ordering = ('-created_at',)


@admin.register(PrivacyNoticeVersion)
class PrivacyNoticeVersionAdmin(ModelAdmin):
    list_display = ('version', 'title', 'effective_date', 'is_active', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('version', 'title')
    ordering = ('-effective_date',)


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

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
