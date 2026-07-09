"""
Portal models: announcements and per-user notifications.
"""
from django.conf import settings
from django.db import models


class Announcement(models.Model):
    class Audience(models.TextChoices):
        ALL      = 'all',      'Todos'
        PARENTS  = 'parents',  'Padres'
        STUDENTS = 'students', 'Alumnos'
        STAFF    = 'staff',    'Personal'

    title      = models.CharField(max_length=200)
    body       = models.TextField()
    audience   = models.CharField(max_length=20, choices=Audience.choices, default=Audience.ALL)
    created_by = models.ForeignKey(
                     settings.AUTH_USER_MODEL,
                     on_delete=models.SET_NULL, null=True,
                     related_name='announcements')
    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Comunicado'
        verbose_name_plural = 'Comunicados'

    def __str__(self):
        return self.title


class Notification(models.Model):
    class NotifType(models.TextChoices):
        INFO      = 'info',      'Información'
        WARNING   = 'warning',   'Advertencia'
        PAYMENT   = 'payment',   'Pago'
        CAFETERIA = 'cafeteria', 'Cafetería'

    user       = models.ForeignKey(
                     settings.AUTH_USER_MODEL,
                     on_delete=models.CASCADE,
                     related_name='notifications')
    notif_type = models.CharField(max_length=20, choices=NotifType.choices, default=NotifType.INFO)
    title      = models.CharField(max_length=200)
    message    = models.TextField()
    is_read    = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Notificación'
        verbose_name_plural = 'Notificaciones'

    def __str__(self):
        return f'{self.user.email} — {self.title}'


class PushSubscription(models.Model):
    """One browser/device Web-Push subscription for a user (opt-in)."""
    user       = models.ForeignKey(
                     settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                     related_name='push_subscriptions')
    endpoint   = models.URLField(max_length=500, unique=True)
    p256dh     = models.CharField(max_length=255)
    auth       = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Suscripción push'
        verbose_name_plural = 'Suscripciones push'

    def __str__(self):
        return f'{self.user.email} — {self.endpoint[:40]}…'


class AnnouncementRead(models.Model):
    """One row per user per announcement — feeds the staff read-rate KPI."""
    announcement = models.ForeignKey(
                       Announcement, on_delete=models.CASCADE, related_name='reads')
    user         = models.ForeignKey(
                       settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                       related_name='announcement_reads')
    read_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=['announcement', 'user'], name='uniq_announcement_read')]
        verbose_name = 'Lectura de comunicado'
        verbose_name_plural = 'Lecturas de comunicados'

    def __str__(self):
        return f'{self.user.email} → {self.announcement_id}'
