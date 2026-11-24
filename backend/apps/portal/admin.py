from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.core.plurals import count as plural

from .models import Announcement, AnnouncementComment, Notification


@admin.register(Announcement)
class AnnouncementAdmin(ModelAdmin):
    list_display = ('title', 'audience', 'created_by', 'is_active', 'created_at')
    list_filter = ('audience', 'is_active')
    search_fields = ('title', 'body')
    date_hierarchy = 'created_at'
    list_select_related = ('created_by',)
    # «Activo» is read-only here: activating a comunicado from the Django admin
    # skipped its fan-out (no notice, no email, no push). It is published and
    # retired from the console (/admin/comunicados), which runs the fan-out.
    readonly_fields = ('is_active', 'created_at', 'updated_at')

    # Comunicados are authored and dispatched (email/WhatsApp/push) from the
    # portal (/admin/comunicados); creating one here would skip delivery.
    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AnnouncementComment)
class AnnouncementCommentAdmin(ModelAdmin):
    list_display = ('announcement', 'author', 'short_body', 'is_hidden', 'created_at')
    list_filter = ('is_hidden', 'created_at')
    list_editable = ('is_hidden',)
    search_fields = ('body', 'author__email', 'announcement__title')
    date_hierarchy = 'created_at'
    list_select_related = ('announcement', 'author')
    readonly_fields = ('created_at',)
    actions = ('hide_comments', 'unhide_comments')

    @admin.display(description='Comentario')
    def short_body(self, obj):
        return (obj.body[:60] + '…') if len(obj.body) > 60 else obj.body

    @admin.action(description='Ocultar comentarios seleccionados')
    def hide_comments(self, request, queryset):
        n = queryset.update(is_hidden=True)
        self.message_user(request, f'{plural(n, "comentario ocultado", "comentarios ocultados")}.')

    @admin.action(description='Mostrar comentarios seleccionados')
    def unhide_comments(self, request, queryset):
        n = queryset.update(is_hidden=False)
        self.message_user(request, f'{plural(n, "comentario visible", "comentarios visibles")}.')


@admin.register(Notification)
class NotificationAdmin(ModelAdmin):
    """Read-only delivery log. A row added here has ``delivered_at=NULL``, so
    ``dispatch_pending_notifications`` would email and push it to the family
    within 5 minutes: notices are created only by the services and the console."""
    list_display = ('user', 'title', 'notif_type', 'is_read', 'email_status', 'created_at')
    list_filter = ('notif_type', 'is_read', 'email_status')
    search_fields = ('user__email', 'title')
    date_hierarchy = 'created_at'
    list_select_related = ('user',)
    actions = None

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
