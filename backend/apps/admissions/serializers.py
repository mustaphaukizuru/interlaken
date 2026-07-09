from rest_framework import serializers

from .models import OpenSchoolDay, PreRegistration, Registration, RegistrationDocument


class PreRegistrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PreRegistration
        fields = [
            'id', 'child_first_name', 'child_last_name', 'child_dob',
            'level', 'grade_applying', 'cycle',
            'parent_name', 'parent_email', 'parent_phone', 'relationship',
            'referral_source', 'message', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class PreRegistrationAdminSerializer(serializers.ModelSerializer):
    """Read-only list shape for the admin Admisiones console."""
    child_name = serializers.SerializerMethodField()

    class Meta:
        model = PreRegistration
        fields = [
            'id', 'child_name', 'level', 'grade_applying',
            'parent_name', 'parent_email', 'parent_phone',
            'status', 'created_at',
        ]

    def get_child_name(self, obj):
        return f'{obj.child_first_name} {obj.child_last_name}'.strip()


class RegistrationDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegistrationDocument
        fields = ['id', 'doc_type', 'filename', 'file_size', 'uploaded_at', 'is_verified']
        read_only_fields = ['id', 'uploaded_at', 'is_verified']


MEDICAL_FIELDS = ('blood_type', 'allergies', 'medical_notes', 'estatura', 'peso')


class RegistrationSerializer(serializers.ModelSerializer):
    documents = RegistrationDocumentSerializer(many=True, read_only=True)

    class Meta:
        model = Registration
        fields = [
            'id', 'child_first_name', 'child_last_name', 'child_dob',
            'child_curp', 'child_nationality', 'level', 'grade_applying', 'cycle',
            'parent1_name', 'parent1_email', 'parent1_phone', 'parent1_occupation',
            'parent2_name', 'parent2_email', 'parent2_phone',
            'emergency_name', 'emergency_phone', 'emergency_rel',
            'blood_type', 'allergies', 'medical_notes', 'estatura', 'peso',
            'consent_photos_media', 'consent_medical_data', 'privacy_accepted_at',
            'status', 'submitted_at', 'created_at', 'documents',
        ]
        read_only_fields = ['id', 'status', 'submitted_at', 'created_at', 'documents',
                            'privacy_accepted_at']

    def _can_read_medical(self, instance) -> bool:
        """Medical fields are readable only by the owning applicant (valid session)
        or by staff/admin AND only when MEDICAL_DATA consent is present (B4)."""
        request = self.context.get('request')
        if request is None:
            return False
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated and (
                user.is_staff or getattr(user, 'role', '') == 'admin'):
            return bool(instance.consent_medical_data)
        # Non-staff callers reach a registration only with a valid session token.
        from .tokens import session_valid
        token = request.headers.get('X-Session-Token') or request.data.get('session_token', '')
        return session_valid(instance, token)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self._can_read_medical(instance):
            for field in MEDICAL_FIELDS:
                if field in data:
                    data[field] = None
        return data


class OpenSchoolDaySerializer(serializers.ModelSerializer):
    class Meta:
        model = OpenSchoolDay
        fields = [
            'id', 'event_date', 'event_time', 'event_name',
            'parent_name', 'parent_email', 'parent_phone',
            'child_name', 'child_age', 'level_interest', 'message',
            'status', 'created_at',
        ]
        read_only_fields = ['id', 'status', 'created_at']


class OpenSchoolDayEventSerializer(serializers.Serializer):
    event_date  = serializers.DateField()
    event_time  = serializers.CharField()
    event_name  = serializers.CharField()
