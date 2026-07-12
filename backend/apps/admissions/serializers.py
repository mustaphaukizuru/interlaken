from django.utils import timezone
from rest_framework import serializers

from .models import OpenSchoolDay, PreRegistration, Registration, RegistrationDocument


def current_school_cycle() -> str:
    """Admissions cycle string, e.g. '2026-2027' — the cycle the public form
    advertises. Matches the frontend `CURRENT_CYCLE` (current calendar year →
    next) so a pre-registration records exactly the cycle the applicant saw."""
    year = timezone.localdate().year
    return f'{year}-{year + 1}'


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


class PublicPreRegistrationSerializer(serializers.Serializer):
    """Write serializer for the PUBLIC pre-registro form.

    Keeps the public contract stable and decoupled from the internal model:
    accepts a single `child_name`, `email`/`phone`, a grade string and
    `how_did_you_hear`, then maps them to the model — splitting the name,
    deriving `level` from the grade, and stamping the running cycle.
    """
    child_name       = serializers.CharField(max_length=200)
    child_dob        = serializers.DateField()
    grade_applying   = serializers.CharField(max_length=30)
    parent_name      = serializers.CharField(max_length=200)
    email            = serializers.EmailField()
    phone            = serializers.CharField(max_length=20)
    how_did_you_hear = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    message          = serializers.CharField(required=False, allow_blank=True, default='')

    _LEVEL_KEYWORDS = (
        ('preescolar', PreRegistration.Level.PRESCHOOL),
        ('primaria',   PreRegistration.Level.PRIMARY),
        ('secundaria', PreRegistration.Level.SECONDARY),
    )

    def _derive_level(self, grade: str) -> str:
        g = (grade or '').lower()
        for keyword, level in self._LEVEL_KEYWORDS:
            if keyword in g:
                return level
        return PreRegistration.Level.PRIMARY  # safe fallback; admin can correct

    def create(self, validated):
        name = validated['child_name'].strip()
        parts = name.split()
        first = parts[0] if parts else name
        last = ' '.join(parts[1:]) if len(parts) > 1 else ''
        return PreRegistration.objects.create(
            child_first_name=first,
            child_last_name=last,
            child_dob=validated['child_dob'],
            level=self._derive_level(validated['grade_applying']),
            grade_applying=validated['grade_applying'],
            cycle=current_school_cycle(),
            parent_name=validated['parent_name'],
            parent_email=validated['email'],
            parent_phone=validated['phone'],
            referral_source=validated.get('how_did_you_hear', ''),
            message=validated.get('message', ''),
        )

    def to_representation(self, instance):
        return {'id': instance.id, 'status': instance.status,
                'created_at': instance.created_at}


class PreRegistrationAdminSerializer(serializers.ModelSerializer):
    """Read-only list shape for the admin Admisiones console."""
    child_name = serializers.SerializerMethodField()

    class Meta:
        model = PreRegistration
        fields = [
            'id', 'child_name', 'level', 'grade_applying',
            'parent_name', 'parent_email', 'parent_phone',
            'status', 'notes', 'created_at',
        ]

    def get_child_name(self, obj):
        return f'{obj.child_first_name} {obj.child_last_name}'.strip()


class PreRegistrationStatusSerializer(serializers.ModelSerializer):
    """Admin write: move a pre-registration through the pipeline + jot notes."""
    class Meta:
        model = PreRegistration
        fields = ['id', 'status', 'notes']


class RegistrationDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegistrationDocument
        fields = ['id', 'doc_type', 'filename', 'file_size', 'uploaded_at', 'is_verified']
        read_only_fields = ['id', 'uploaded_at', 'is_verified']


class DocumentVerifySerializer(serializers.ModelSerializer):
    """Admin write: mark an uploaded document as verified (or un-verify)."""
    class Meta:
        model = RegistrationDocument
        fields = ['id', 'is_verified']


class RegistrationAdminListSerializer(serializers.ModelSerializer):
    """Light list shape for the admin Inscripciones console.

    Deliberately excludes the encrypted medical fields — the list never needs to
    decrypt them, and they stay gated behind the detail view + consent check.
    """
    child_name  = serializers.SerializerMethodField()
    doc_count   = serializers.SerializerMethodField()
    doc_verified = serializers.SerializerMethodField()

    class Meta:
        model = Registration
        fields = [
            'id', 'child_name', 'level', 'grade_applying', 'cycle',
            'parent1_name', 'parent1_email', 'parent1_phone',
            'status', 'submitted_at', 'created_at', 'doc_count', 'doc_verified',
        ]

    def get_child_name(self, obj):
        return f'{obj.child_first_name} {obj.child_last_name}'.strip()

    def get_doc_count(self, obj):
        return obj.documents.count()

    def get_doc_verified(self, obj):
        return sum(1 for d in obj.documents.all() if d.is_verified)


class RegistrationStatusSerializer(serializers.ModelSerializer):
    """Admin write: move a registration through review (approve/reject) + notes."""
    class Meta:
        model = Registration
        fields = ['id', 'status', 'admin_notes']


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
