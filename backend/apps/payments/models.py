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

    class Gateway(models.TextChoices):
        GLOBAL_PAYMENTS = 'global_payments', 'Global Payments'
        BANORTE         = 'banorte',         'Banorte'

    user          = models.ForeignKey(User, on_delete=models.SET_NULL, null=True,
                                      related_name='payments')
    payment_type  = models.CharField(max_length=20, choices=Type.choices)
    amount        = models.DecimalField(max_digits=12, decimal_places=2)
    currency      = models.CharField(max_length=3, default='MXN')
    status        = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    description   = models.CharField(max_length=255, blank=True)

    # Links a cafeteria top-up payment back to its TopUpRequest (spec §2.2). The
    # webhook uses this to credit the right student's local ledger on success.
    related_topup = models.ForeignKey('cafeteria.TopUpRequest', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='payments')

    # Gateway fields
    gateway       = models.CharField(max_length=50, choices=Gateway.choices,
                                     default=Gateway.GLOBAL_PAYMENTS)
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

    # Local soft-fails: HPP may still complete after expire/supersede, or never
    # started (create_checkout). Distinct from a gateway DECLINED webhook.
    SOFT_FAIL_STAGES = frozenset({'expire', 'supersede', 'create_checkout'})

    def mark_failed(self, error='', stage=''):
        """Mark the payment failed, preserving the error for reconciliation.

        Used when a gateway call fails during checkout creation so we never leave
        an unreachable PENDING row (no hosted-page URL was ever issued), and when
        local expiry/supersede clears an open session.
        """
        self.status = self.Status.FAILED
        raw = dict(self.gateway_raw or {})
        raw['error'] = str(error)
        if stage:
            raw['stage'] = stage
        self.gateway_raw = raw
        self.save(update_fields=['status', 'gateway_raw', 'updated_at'])

    def is_soft_failed(self) -> bool:
        """True when FAILED only by local expiry/supersede/checkout abort.

        A soft-failed payment may still receive a late SUCCESS webhook if the
        parent completes an abandoned or superseded hosted-payment page.
        """
        if self.status != self.Status.FAILED:
            return False
        raw = self.gateway_raw if isinstance(self.gateway_raw, dict) else {}
        return raw.get('stage') in self.SOFT_FAIL_STAGES
