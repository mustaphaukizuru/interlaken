from rest_framework import serializers

from .models import Announcement, Notification


class AnnouncementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Announcement
        fields = ['id', 'title', 'body', 'audience', 'created_at']


class AnnouncementAdminSerializer(serializers.ModelSerializer):
    """Admin write/read shape for the Comunicados console (incl. inactive + stats)."""
    created_by_name = serializers.SerializerMethodField()
    read_count = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = ['id', 'title', 'body', 'audience', 'is_active',
                  'created_at', 'created_by_name', 'read_count']
        read_only_fields = ['id', 'created_at', 'created_by_name', 'read_count']

    def get_created_by_name(self, obj):
        return obj.created_by.full_name if obj.created_by else '—'

    def get_read_count(self, obj):
        return obj.reads.count()


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'notif_type', 'title', 'message', 'is_read', 'created_at']
