"""
Core models: public-facing site data (contact form submissions) + audit log.
"""
from django.conf import settings
from django.db import IntegrityError, models
from django.utils import timezone


class ContactMessage(models.Model):
    """A message sent from the public Contacto form."""
    name       = models.CharField('Nombre', max_length=120)
    email      = models.EmailField('Correo')
    subject    = models.CharField('Asunto', max_length=200)
    message    = models.TextField('Mensaje')
    is_handled = models.BooleanField('Atendido', default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Mensaje de contacto'
        verbose_name_plural = 'Mensajes de contacto'

    def __str__(self):
        return f'{self.name} — {self.subject}'


class AuditLogQuerySet(models.QuerySet):
    """Append-only: bulk update/delete are refused at the manager layer."""

    def update(self, *args, **kwargs):
        raise IntegrityError('AuditLog is append-only; bulk update is not allowed.')

    def delete(self, *args, **kwargs):
        raise IntegrityError('AuditLog is append-only; delete is not allowed.')


class AuditLog(models.Model):
    """Immutable record of a security-relevant mutation (IK-SEC A3).

    Append-only: instances cannot be modified or deleted, and neither can the
    queryset (`.update()`/`.delete()` raise). Created via `apps.core.audit.record`.
    """

    class Action(models.TextChoices):
        CREATE     = 'create',     'Creación'
        UPDATE     = 'update',     'Modificación'
        DELETE     = 'delete',     'Eliminación'
        PERMISSION = 'permission', 'Cambio de permisos'

    # Null actor = automated/system action; actor_label carries e.g. 'system:webhook'
    # or a snapshot of the acting user's email (kept even if the user is deleted).
    actor       = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name='audit_entries')
    actor_label = models.CharField(max_length=150, blank=True, default='')
    action      = models.CharField(max_length=20, choices=Action.choices)
    object_type = models.CharField(max_length=100)   # 'app_label.model'
    object_id   = models.CharField(max_length=64)
    changes     = models.JSONField(default=dict, blank=True)   # {field: [old, new]}
    context     = models.CharField(max_length=200, blank=True, default='')
    created_at  = models.DateTimeField(default=timezone.now, db_index=True)

    objects = AuditLogQuerySet.as_manager()

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Registro de auditoría'
        verbose_name_plural = 'Registros de auditoría'
        indexes = [models.Index(fields=['object_type', 'object_id'])]

    def __str__(self):
        return f'{self.created_at:%Y-%m-%d %H:%M} {self.action} {self.object_type}#{self.object_id}'

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise IntegrityError('AuditLog is append-only; entries cannot be modified.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise IntegrityError('AuditLog is append-only; entries cannot be deleted.')
