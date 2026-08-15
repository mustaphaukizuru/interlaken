from rest_framework import serializers

from .models import AuditLog, ContactMessage


class ContactMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactMessage
        fields = ['id', 'name', 'email', 'subject', 'message', 'created_at']
        read_only_fields = ['id', 'created_at']


class AuditLogSerializer(serializers.ModelSerializer):
    """Read-only row for the admin audit viewer (append-only log)."""
    action_display = serializers.CharField(source='get_action_display', read_only=True)

    class Meta:
        model = AuditLog
        fields = ['id', 'actor', 'actor_label', 'action', 'action_display',
                  'object_type', 'object_id', 'changes', 'context', 'created_at']
        read_only_fields = fields
