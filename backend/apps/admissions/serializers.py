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


class RegistrationDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegistrationDocument
        fields = ['id', 'doc_type', 'filename', 'file_size', 'uploaded_at', 'is_verified']
        read_only_fields = ['id', 'uploaded_at', 'is_verified']


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
            'blood_type', 'allergies', 'medical_notes',
            'consent_photos_media', 'consent_medical_data', 'privacy_accepted_at',
            'status', 'submitted_at', 'created_at', 'documents',
        ]
        read_only_fields = ['id', 'status', 'submitted_at', 'created_at', 'documents',
                            'privacy_accepted_at']


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
