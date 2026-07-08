from rest_framework import serializers

from .models import ConsentPurpose, PrivacyNoticeVersion


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
