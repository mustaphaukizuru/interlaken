"""
payments/models.py — Global Payments / school fee transactions
"""
from django.db import models
from django.utils import timezone

from apps.accounts.models import User


class Payment(models.Model):
    class Status(models.TextChoices):
        PENDING   = 'pending',   'Pendiente'
        PROCESSING= 'processing','Procesando'
        SUCCESS   = 'success',   'Exitoso'
        FAILED    = 'failed',    'Fallido'
        REFUNDED  = 'refunded',  'Devuelto'

    class Type(models.TextChoices):
        TUITION    = 'tuition',    'Colegiatura'
        ENROLLMENT = 'enrollment', 'Inscripción'
        CAFETERIA  = 'cafeteria',  'Recarga Cafetería'
        OTHER      = 'other',      'Otro'

    user          = models.ForeignKey(User, on_delete=models.SET_NULL, null=True,
                                      related_name='payments')
    payment_type  = models.CharField(max_length=20, choices=Type.choices)
    amount        = models.DecimalField(max_digits=12, decimal_places=2)
    currency      = models.CharField(max_length=3, default='MXN')
    status        = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    description   = models.CharField(max_length=255, blank=True)

    # Gateway fields
    gateway       = models.CharField(max_length=50, default='global_payments')
    gateway_tx_id = models.CharField(max_length=255, blank=True, unique=True, null=True)
    gateway_ref   = models.CharField(max_length=255, blank=True)
    gateway_raw   = models.JSONField(default=dict, blank=True)  # Full gateway response

    # Timestamps
    created_at    = models.DateTimeField(default=timezone.now)
    updated_at    = models.DateTimeField(auto_now=True)
    completed_at  = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Pago'
        verbose_name_plural = 'Pagos'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_payment_type_display()} — ${self.amount} {self.currency} ({self.status})'

    def mark_success(self, gateway_tx_id, raw_response=None):
        self.status = self.Status.SUCCESS
        self.gateway_tx_id = gateway_tx_id
        self.gateway_raw = raw_response or {}
        self.completed_at = timezone.now()
        self.save()
