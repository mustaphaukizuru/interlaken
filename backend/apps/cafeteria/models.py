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
        PURCHASE   = 'purchase',   'Compra'
        TOPUP      = 'topup',      'Recarga'
        REFUND     = 'refund',     'Devolución'
        ADJUSTMENT = 'adjustment', 'Ajuste'

    student             = models.ForeignKey(
                              StudentProfile, on_delete=models.CASCADE,
                              related_name='cafeteria_transactions')
    transaction_type    = models.CharField(max_length=20, choices=TxType.choices)
    amount              = models.DecimalField(max_digits=10, decimal_places=2)
    description         = models.CharField(max_length=255, blank=True)
    date                = models.DateTimeField(default=timezone.now)
    loyverse_receipt_id = models.CharField(max_length=100, blank=True, unique=True)
    # Itemized receipt lines from Loyverse (F2): [{name, quantity, total}, ...].
    items               = models.JSONField(default=list, blank=True)
    # Running balance snapshot right after this transaction was applied.
    balance_after       = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

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


class BalanceAdjustment(models.Model):
    """Audit trail for every **manual** admin change to a cafeteria balance.

    Covers two admin actions (spec §5 F5): a manual credit/debit ("adjustment")
    and a transaction reversal ("refund"). One row is written for each, capturing
    *who* did it, *when*, the signed *amount* applied to the local ledger, the
    *reason*, and the resulting balance — so every financial mutation is traceable
    (spec constraint: all financial mutations audited).
    """

    class Kind(models.TextChoices):
        ADJUSTMENT = 'adjustment', 'Ajuste manual'
        REFUND     = 'refund',     'Devolución'

    student       = models.ForeignKey(
                        StudentProfile, on_delete=models.CASCADE,
                        related_name='balance_adjustments')
    admin         = models.ForeignKey(
                        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
                        related_name='cafeteria_adjustments')
    kind          = models.CharField(max_length=20, choices=Kind.choices, default=Kind.ADJUSTMENT)
    # Signed delta applied to the local ledger: positive = credit, negative = debit.
    amount        = models.DecimalField(max_digits=10, decimal_places=2)
    reason        = models.TextField()
    balance_after = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # The ledger transaction this audit row produced (and, for a refund, it also
    # points at the transaction being reversed via ``source_transaction``).
    transaction        = models.ForeignKey(
                             CafeteriaTransaction, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name='adjustments')
    source_transaction = models.ForeignKey(
                             CafeteriaTransaction, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name='reversals')
    created_at    = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'Ajuste de Saldo'
        verbose_name_plural = 'Ajustes de Saldo'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.student} — {self.get_kind_display()} ${self.amount}'
