from rest_framework import serializers

from .models import AuditLog, ContactMessage

# Public free-text fields: a message far beyond any real one is refused instead
# of filling the inbox and the staff e-mail (QA sweep 2026-11-24).
PUBLIC_TEXT_MAX = 5000
# CR, LF and the other characters str.splitlines() treats as a line end.
LINE_BREAKS = frozenset('\r\n\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029')


def reject_line_breaks(value: str) -> str:
    """A value that goes into an e-mail header (the subject) or a one-line field
    must not carry a line break: header injection."""
    if any(ch in value for ch in LINE_BREAKS):
        raise serializers.ValidationError('Escríbalo en una sola línea, sin saltos de línea.')
    return value


class ContactMessageSerializer(serializers.ModelSerializer):
    message = serializers.CharField(max_length=PUBLIC_TEXT_MAX)

    class Meta:
        model = ContactMessage
        fields = ['id', 'name', 'email', 'subject', 'message', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate_name(self, value):
        return reject_line_breaks(value)

    def validate_subject(self, value):
        return reject_line_breaks(value)


class AuditLogSerializer(serializers.ModelSerializer):
    """Read-only row for the admin audit viewer (append-only log)."""
    action_display = serializers.CharField(source='get_action_display', read_only=True)
    # Sensitive values masked, also on rows stored before they were registered.
    changes = serializers.SerializerMethodField()

    def get_changes(self, obj):
        from .audit import redacted_changes
        return redacted_changes(obj)

    class Meta:
        model = AuditLog
        fields = ['id', 'actor', 'actor_label', 'action', 'action_display',
                  'object_type', 'object_id', 'changes', 'context', 'created_at']
        read_only_fields = fields


class ContactMessageAdminSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactMessage
        # ack_sent_at: when a facturación request's family got its confirmation
        # («Atendido», core.facturacion); null for contact messages.
        fields = ['id', 'name', 'email', 'subject', 'message', 'is_handled', 'created_at', 'ack_sent_at']
