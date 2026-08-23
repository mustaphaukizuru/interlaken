from rest_framework import serializers

from .models import ArcoRequest, ConsentPurpose, PrivacyNoticeVersion


class PrivacyNoticeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrivacyNoticeVersion
        fields = ['version', 'title', 'body', 'integral_notice_url', 'effective_date']


class ConsentInputSerializer(serializers.Serializer):
    """`{purposes: {<purpose>: bool, ...}, student?: <id>}`."""
    purposes = serializers.DictField(child=serializers.BooleanField())
    student = serializers.IntegerField(required=False, allow_null=True)

    def validate_purposes(self, value):
        if not value:
            raise serializers.ValidationError('Indique al menos un propósito.')
        valid = {p.value for p in ConsentPurpose}
        invalid = set(value) - valid
        if invalid:
            raise serializers.ValidationError(f'Propósitos inválidos: {sorted(invalid)}')
        return value


class ArcoRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ArcoRequest
        fields = ['id', 'requester_email', 'requester_name', 'channel', 'request_type', 'details', 'status',
                  'resolution_note', 'statutory_deadline', 'created_at', 'resolved_at', 'is_overdue', 'days_left']
        read_only_fields = ['id', 'requester_email', 'requester_name', 'channel', 'status', 'resolution_note',
                            'statutory_deadline', 'created_at', 'resolved_at', 'is_overdue', 'days_left']

    is_overdue = serializers.SerializerMethodField()
    days_left = serializers.SerializerMethodField()

    def get_is_overdue(self, obj):
        from django.utils import timezone
        return obj.status in ('received', 'in_review') and obj.statutory_deadline < timezone.localdate()

    def get_days_left(self, obj):
        from django.utils import timezone
        return (obj.statutory_deadline - timezone.localdate()).days


class ArcoIntakeSerializer(serializers.Serializer):
    """Admin records a request that arrived by email/WhatsApp/in person (P5-5)."""
    requester_email = serializers.EmailField()
    requester_name = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    request_type = serializers.ChoiceField(choices=ArcoRequest.Type.choices)
    channel = serializers.ChoiceField(choices=ArcoRequest.Channel.choices, default=ArcoRequest.Channel.EMAIL)
    details = serializers.CharField(required=False, allow_blank=True, default='')


class ArcoStatusInputSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=ArcoRequest.Status.choices)
    resolution_note = serializers.CharField(required=False, allow_blank=True, default='')
