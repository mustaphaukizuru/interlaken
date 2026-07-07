from django.contrib import admin
from .models import Announcement, Notification

@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ('title', 'audience', 'is_active', 'created_at')
    list_filter = ('audience', 'is_active')
    list_editable = ('is_active',)
    search_fields = ('title', 'body')

@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('user', 'title', 'notif_type', 'is_read', 'created_at')
    list_filter = ('notif_type', 'is_read')
    search_fields = ('user__email', 'title')
