from rest_framework import serializers

from .models import Announcement, AnnouncementComment, Notification


class AnnouncementSerializer(serializers.ModelSerializer):
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = ['id', 'title', 'body', 'audience', 'created_at', 'comment_count', 'requires_ack', 'attachments', 'acknowledged']

    requires_ack = serializers.BooleanField(read_only=True)
    attachments = serializers.JSONField(read_only=True)
    acknowledged = serializers.SerializerMethodField()

    def get_acknowledged(self, obj):
        # Prefer the queryset annotation (see AnnouncementListView); the per-row
        # EXISTS below is only for callers that don't annotate.
        annotated = getattr(obj, 'acknowledged_ann', None)
        if annotated is not None:
            return bool(annotated)
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not getattr(user, 'is_authenticated', False):
            return False
        return obj.reads.filter(user=user, acknowledged_at__isnull=False).exists()

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
    ack_count = serializers.SerializerMethodField()

    def get_ack_count(self, obj):
        annotated = getattr(obj, 'ack_count_ann', None)
        if annotated is not None:
            return annotated
        return obj.reads.filter(acknowledged_at__isnull=False).count()

    def validate_attachments(self, value):
        from apps.content.media import MediaAsset
        if not isinstance(value, list) or len(value) > 10:
            raise serializers.ValidationError('Máximo 10 adjuntos.')
        ids = [a.get('id') for a in value if isinstance(a, dict)]
        found = {m.pk: m for m in MediaAsset.objects.filter(pk__in=[i for i in ids if isinstance(i, int)])}
        out = []
        for a in value:
            m = found.get(a.get('id')) if isinstance(a, dict) else None
            if m is None:
                raise serializers.ValidationError('Adjunto no encontrado en la biblioteca de medios.')
            out.append({'id': m.pk, 'name': (a.get('name') or m.filename)[:120], 'url': m.public_url('original')})
        return out

    class Meta:
        model = Announcement
        fields = ['id', 'title', 'body', 'audience', 'is_active', 'push_enabled',
                  'show_on_site', 'site_until', 'site_link', 'publish_at', 'requires_ack', 'attachments', 'ack_count',
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
        fields = ['id', 'notif_type', 'title', 'message', 'is_read', 'created_at', 'announcement']


class NotificationDetailSerializer(serializers.ModelSerializer):
    """One notification, opened on its own page.

    The list view truncates the message to two lines and drops everything about
    delivery, so an 'info' notification with a long body had nowhere to be read
    in full. This adds the announcement's title (so the link says what it points
    at instead of 'ver comunicado') and the delivery stamp.
    """
    announcement_title = serializers.SerializerMethodField()
    type_label = serializers.CharField(source='get_notif_type_display', read_only=True)

    class Meta:
        model = Notification
        fields = ['id', 'notif_type', 'type_label', 'title', 'message', 'is_read',
                  'created_at', 'delivered_at', 'announcement', 'announcement_title']

    def get_announcement_title(self, obj):
        return obj.announcement.title if obj.announcement_id and obj.announcement else ''
