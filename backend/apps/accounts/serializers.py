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
    students = StudentProfileSerializer(many=True, read_only=True, source='user.parents.through')

    class Meta:
        model = ParentProfile
        fields = ['id', 'user', 'phone', 'relationship']
