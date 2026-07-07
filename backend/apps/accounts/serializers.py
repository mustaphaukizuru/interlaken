from rest_framework import serializers
from .models import User, StudentProfile, ParentProfile


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.ReadOnlyField()

    class Meta:
        model = User
        fields = ['id', 'email', 'first_name', 'last_name', 'full_name', 'role', 'avatar', 'whatsapp']
        read_only_fields = ['id', 'email', 'role']


class StudentProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = StudentProfile
        fields = ['id', 'user', 'student_id', 'grade', 'group', 'loyverse_id']


class ParentProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    # A parent's children come via the reverse of StudentProfile.parents (related_name='children').
    students = StudentProfileSerializer(many=True, read_only=True, source='user.children')

    class Meta:
        model = ParentProfile
        fields = ['id', 'user', 'phone', 'relationship', 'students']
