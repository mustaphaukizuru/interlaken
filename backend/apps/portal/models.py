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
    # Set when the audience has been fan-out notified (create or first activate).
    # Prevents re-notify on deactivate→reactivate (GO-LIVE-AUDIT #16 follow-up).
    fanout_at  = models.DateTimeField(null=True, blank=True)
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
    # NULL until email + web-push for this notification have been dispatched.
    # notify() (per-user) sends inline and stamps this immediately; bulk fan-out
    # (fanout_announcement) leaves it NULL for the dispatch_notifications cron to
    # deliver in batches — a school-wide blast can't run inside a web request.
    delivered_at = models.DateTimeField(null=True, blank=True, db_index=True)
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


class AnnouncementComment(models.Model):
    """A reply from a family (or staff) on a comunicado.

    Families are a merged parent/student account (a self-guardian student is in
    its own ``parents`` set), so any authenticated family member who can see the
    comunicado can reply. Comments are soft-moderated: an admin can hide one
    (``is_hidden``) without deleting the thread. ``author`` is SET_NULL so
    removing a user never erases the discussion.
    """
    announcement = models.ForeignKey(
                       Announcement, on_delete=models.CASCADE, related_name='comments')
    author       = models.ForeignKey(
                       settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                       related_name='announcement_comments')
    body         = models.TextField()
    is_hidden    = models.BooleanField(default=False)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        verbose_name = 'Comentario de comunicado'
        verbose_name_plural = 'Comentarios de comunicados'
        indexes = [models.Index(fields=['announcement', 'created_at'])]

    def __str__(self):
        who = self.author.email if self.author else 'anónimo'
        return f'{who} → {self.announcement_id}'
