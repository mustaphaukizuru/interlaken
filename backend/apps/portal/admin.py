from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Announcement, AnnouncementComment, Notification


@admin.register(Announcement)
class AnnouncementAdmin(ModelAdmin):
    list_display = ('title', 'audience', 'created_by', 'is_active', 'created_at')
    list_filter = ('audience', 'is_active')
    list_editable = ('is_active',)
    search_fields = ('title', 'body')
    date_hierarchy = 'created_at'
    list_select_related = ('created_by',)
    readonly_fields = ('created_at', 'updated_at')


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
        self.message_user(request, f'{n} comentario(s) ocultado(s).')

    @admin.action(description='Mostrar comentarios seleccionados')
    def unhide_comments(self, request, queryset):
        n = queryset.update(is_hidden=False)
        self.message_user(request, f'{n} comentario(s) visible(s).')


@admin.register(Notification)
class NotificationAdmin(ModelAdmin):
    list_display = ('user', 'title', 'notif_type', 'is_read', 'created_at')
    list_filter = ('notif_type', 'is_read')
    search_fields = ('user__email', 'title')
    date_hierarchy = 'created_at'
    list_select_related = ('user',)
    readonly_fields = ('created_at',)
