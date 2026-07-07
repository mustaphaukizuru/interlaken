"""
cafeteria/models.py — Loyverse cafeteria integration & balance tracking.
1 Loyverse point = 1 MXN peso.
"""
from django.db import models
from django.utils import timezone

from apps.accounts.models import StudentProfile


class CafeteriaBalance(models.Model):
    """
    Cached balance from Loyverse loyalty points.
    Synced periodically via Loyverse API.
    """
    student              = models.OneToOneField(
                               StudentProfile, on_delete=models.CASCADE,
                               related_name='cafeteria_balance')
    balance              = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    low_balance_threshold= models.DecimalField(max_digits=8, decimal_places=2, default=50)
    last_synced          = models.DateTimeField(null=True, blank=True)
    # When the last low-balance alert was sent, so the daily cron doesn't spam.
    # Cleared once the balance recovers above the threshold (see low_balance_alerts).
    last_low_balance_alert_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Saldo de Cafetería'

    def __str__(self):
        return f'{self.student} — ${self.balance:.2f}'

    @property
    def is_low_balance(self):
        return self.balance <= self.low_balance_threshold


class CafeteriaTransaction(models.Model):
    """Loyverse transaction log synced from API."""

    class TxType(models.TextChoices):
        PURCHASE = 'purchase', 'Compra'
        TOPUP    = 'topup',    'Recarga'
        REFUND   = 'refund',   'Devolución'

    student             = models.ForeignKey(
                              StudentProfile, on_delete=models.CASCADE,
                              related_name='cafeteria_transactions')
    transaction_type    = models.CharField(max_length=20, choices=TxType.choices)
    amount              = models.DecimalField(max_digits=10, decimal_places=2)
    description         = models.CharField(max_length=255, blank=True)
    date                = models.DateTimeField(default=timezone.now)
    loyverse_receipt_id = models.CharField(max_length=100, blank=True, unique=True)

    class Meta:
        verbose_name = 'Transacción de Cafetería'
        verbose_name_plural = 'Transacciones de Cafetería'
        ordering = ['-date']

    def __str__(self):
        return f'{self.student} — {self.transaction_type} ${self.amount}'


class TopUpRequest(models.Model):
    """
    When a parent requests a balance top-up.
    Admin applies it to Loyverse via the admin panel or portal.
    """
    class Status(models.TextChoices):
        PENDING   = 'pending',   'Pendiente'
        COMPLETED = 'completed', 'Completado'
        FAILED    = 'failed',    'Fallido'

    class Method(models.TextChoices):
        ONLINE = 'online', 'Pago en Línea'
        OFFICE = 'office', 'Caja Escolar'

    student      = models.ForeignKey(
                       StudentProfile, on_delete=models.CASCADE,
                       related_name='topup_requests')
    amount       = models.DecimalField(max_digits=10, decimal_places=2)
    method       = models.CharField(max_length=20, choices=Method.choices, default=Method.OFFICE)
    status       = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    payment_ref  = models.CharField(max_length=200, blank=True)
    created_at   = models.DateTimeField(default=timezone.now)
    processed_at = models.DateTimeField(null=True, blank=True)
    notes        = models.TextField(blank=True)

    class Meta:
        verbose_name = 'Solicitud de Recarga'
        verbose_name_plural = 'Solicitudes de Recarga'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.student} — ${self.amount} ({self.status})'
