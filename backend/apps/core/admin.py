from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import AuditLog, ContactMessage


@admin.register(ContactMessage)
class ContactMessageAdmin(ModelAdmin):
    list_display = ('name', 'email', 'subject', 'is_handled', 'created_at')
    list_filter = ('is_handled', 'created_at')
    list_editable = ('is_handled',)
    search_fields = ('name', 'email', 'subject', 'message')
    readonly_fields = ('name', 'email', 'subject', 'message', 'created_at')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'


@admin.register(AuditLog)
class AuditLogAdmin(ModelAdmin):
    """Strictly read-only view of the append-only audit trail."""
    list_display = ('created_at', 'action', 'object_type', 'object_id',
                    'actor_label', 'context')
    list_filter = ('action', 'object_type', 'created_at')
    search_fields = ('object_type', 'object_id', 'actor_label', 'context')
    readonly_fields = ('actor', 'actor_label', 'action', 'object_type', 'object_id',
                       'changes', 'context', 'created_at')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'
    actions = None

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
