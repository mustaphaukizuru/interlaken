from rest_framework import serializers

from .models import NotificationPreference, ParentProfile, StudentProfile, User


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ['email_enabled', 'in_app_enabled', 'push_enabled',
                  'cat_cafeteria', 'cat_payment', 'cat_info', 'updated_at']
        read_only_fields = ['updated_at']


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.ReadOnlyField()
    has_usable_password = serializers.SerializerMethodField()
    notif_prefs = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'email', 'first_name', 'last_name', 'full_name', 'role',
            'avatar', 'whatsapp', 'has_usable_password', 'notif_prefs', 'last_login',
        ]
        read_only_fields = ['id', 'email', 'role', 'has_usable_password', 'notif_prefs', 'last_login']

    def get_has_usable_password(self, obj):
        return obj.has_usable_password()

    def get_notif_prefs(self, obj):
        # ``for_user`` is a get_or_create (a write on a read path), so it is
        # gated: only direct-user views (/accounts/me/, login) pass
        # ``include_prefs``. Nested users (student rosters, balance lists) get
        # null and stay O(1) — the frontend only reads prefs from /me.
        if not self.context.get('include_prefs'):
            return None
        prefs = NotificationPreference.for_user(obj)
        return NotificationPreferenceSerializer(prefs).data


MEDICAL_FIELDS = ('blood_type', 'allergies', 'medical_notes')


class StudentProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    age = serializers.ReadOnlyField()

    class Meta:
        model = StudentProfile
        fields = ['id', 'user', 'student_id', 'grade', 'group', 'loyverse_id',
                  'enrollment_date', 'is_active', 'status',
                  'birth_date', 'age', 'curp', 'emergency_name', 'emergency_phone', 'emergency_rel',
                  'blood_type', 'allergies', 'medical_notes']

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Medical data only for admins and the student's own family (LFPDPPP);
        # rosters/lists pass include_medical=False and never carry it.
        if not self.context.get('include_medical'):
            for f in MEDICAL_FIELDS:
                data.pop(f, None)
        return data


class ParentProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    # A parent's children come via the reverse of StudentProfile.parents (related_name='children').
    students = StudentProfileSerializer(many=True, read_only=True, source='user.children')

    class Meta:
        model = ParentProfile
        fields = ['id', 'user', 'phone', 'relationship', 'students']
