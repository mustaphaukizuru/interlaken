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
        fields = ['id', 'requester_email', 'request_type', 'details', 'status',
                  'resolution_note', 'statutory_deadline', 'created_at', 'resolved_at']
        read_only_fields = ['id', 'requester_email', 'status', 'resolution_note',
                            'statutory_deadline', 'created_at', 'resolved_at']


class ArcoStatusInputSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=ArcoRequest.Status.choices)
    resolution_note = serializers.CharField(required=False, allow_blank=True, default='')
