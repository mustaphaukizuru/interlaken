from rest_framework import serializers

from .models import Announcement, AnnouncementComment, Notification


class AnnouncementSerializer(serializers.ModelSerializer):
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = ['id', 'title', 'body', 'audience', 'created_at', 'comment_count']

    def get_comment_count(self, obj):
        # Prefer the annotation set by the list/detail queryset (avoids N+1);
        # fall back to a count for callers that don't annotate (e.g. dashboard).
        annotated = getattr(obj, 'visible_comment_count', None)
        if annotated is not None:
            return annotated
        return obj.comments.filter(is_hidden=False).count()


class AnnouncementCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    body = serializers.CharField(max_length=2000, trim_whitespace=True)

    class Meta:
        model = AnnouncementComment
        fields = ['id', 'body', 'author_name', 'created_at']
        read_only_fields = ['id', 'author_name', 'created_at']

    def get_author_name(self, obj):
        return obj.author.full_name if obj.author else 'Usuario'


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
        # Prefer the admin list/detail queryset annotation; fall back to a count
        # for unannotated instances (e.g. the row just created by POST).
        annotated = getattr(obj, 'read_count_ann', None)
        if annotated is not None:
            return annotated
        return obj.reads.count()


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'notif_type', 'title', 'message', 'is_read', 'created_at']
