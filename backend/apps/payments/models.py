"""
payments/models.py — online gateway transactions (cafetería top-ups).

The app only sells cafetería wallet top-ups; tuition (colegiatura) and
enrollment (inscripción) are NOT billed through the app. Rows are created by
the top-up flow and settled from Banorte's encrypted checkout result (see
``BanorteCheckout``), never by hand in the admin.

Banorte is the only payment gateway (decision 2026-10-13).
"""
from django.core.exceptions import ObjectDoesNotExist
from django.db import models
from django.utils import timezone

from apps.accounts.models import User
from apps.core.fields import EncryptedTextField

# Why a FAILED payment failed, shown to staff and families instead of a bare
# "Fallido" (keys are the API's ``failure_reason``).
FAILURE_LABELS = {
    'cancelled': 'Cancelado por el usuario',
    'expired': 'Expirado',
    'superseded': 'Reemplazado por otro intento',
    'declined': 'Rechazado por el banco',
    # The school's afiliación accepts Visa and Mastercard only (no Amex).
    'card_not_accepted': 'Tarjeta no aceptada (American Express)',
    'bank_timeout': 'Sin respuesta del banco',
    'config_error': 'Error de configuración',
    'not_found': 'No aparece en MultiCobros',
}
_STAGE_REASONS = {
    'cancel': 'cancelled',
    'expire': 'expired',
    'supersede': 'superseded',
    'create_checkout': 'config_error',
    'bank_timeout': 'bank_timeout',
    'not_found': 'not_found',
}


def is_amex(brand) -> bool:
    """Payworks ``marcaTarjeta`` of an American Express card."""
    brand = str(brand or '').upper().replace(' ', '')
    return 'AMEX' in brand or 'AMERICAN' in brand


def failure_reason_for(stage, resultado_payw) -> str:
    """``FAILURE_LABELS`` key of a FAILED payment from its stage and Payworks result.

    Local stages win; a bank answer without a stage is a decline, except
    Payworks R (rejected: merchant set-up, e.g. PAYW-3008 unknown terminal) and
    E (Banorte internal error), which never reached the card issuer.
    """
    if stage and stage in _STAGE_REASONS:
        return _STAGE_REASONS[stage]
    if resultado_payw in ('R', 'E'):
        return 'config_error'
    return 'declined'


class Payment(models.Model):
    class Status(models.TextChoices):
        PENDING   = 'pending',   'Pendiente'
        PROCESSING= 'processing','Procesando'
        SUCCESS   = 'success',   'Exitoso'
        FAILED    = 'failed',    'Fallido'
        REFUNDED  = 'refunded',  'Devuelto'

    class Type(models.TextChoices):
        CAFETERIA  = 'cafeteria',  'Recarga Cafetería'
        # Legacy bucket: pre-existing rows of retired types were folded here by
        # migration 0004; no new flow creates it.
        OTHER      = 'other',      'Otro'

    class Gateway(models.TextChoices):
        BANORTE         = 'banorte',         'Banorte'
        # Retired 2026-10-13: Banorte is the only gateway. The value stays so
        # historical rows keep a readable label; nothing creates it any more.
        GLOBAL_PAYMENTS = 'global_payments', 'Global Payments (retirado)'

    user          = models.ForeignKey(User, on_delete=models.SET_NULL, null=True,
                                      related_name='payments')
    payment_type  = models.CharField(max_length=20, choices=Type.choices)
    amount        = models.DecimalField(max_digits=12, decimal_places=2)
    currency      = models.CharField(max_length=3, default='MXN')
    status        = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    description   = models.CharField(max_length=255, blank=True)

    # Links a cafeteria top-up payment back to its TopUpRequest (spec §2.2). The
    # settlement uses this to credit the right student's local ledger on success.
    related_topup = models.ForeignKey('cafeteria.TopUpRequest', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='payments')

    # Gateway fields
    gateway       = models.CharField(max_length=50, choices=Gateway.choices,
                                     default=Gateway.BANORTE)
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
        indexes = [
            models.Index(fields=['status', 'created_at']),
            models.Index(fields=['status', 'completed_at']),
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['payment_type', 'status']),
            # Admin pagos list and summary by date range (Data Ops Phase 1).
            models.Index(fields=['created_at'], name='pay_payment_created'),
        ]

    def __str__(self):
        return f'{self.get_payment_type_display()} — ${self.amount} {self.currency} ({self.status})'

    def mark_success(self, gateway_tx_id, raw_response=None):
        self.status = self.Status.SUCCESS
        self.gateway_tx_id = gateway_tx_id
        self.gateway_raw = raw_response or {}
        self.completed_at = timezone.now()
        self.save()

    # Local soft-fails: the checkout may still complete after expire/supersede,
    # never started (create_checkout), was cancelled in the lightbox before a
    # result (cancel), the bank timed out (bank_timeout), or staff found no such
    # operation in MultiCobros (not_found: closed for staff, but a genuine late
    # approval is still credited). Distinct from a bank DECLINED result, which
    # is final.
    SOFT_FAIL_STAGES = frozenset({
        'expire', 'supersede', 'create_checkout', 'cancel', 'bank_timeout', 'not_found'})

    FAILURE_LABELS = FAILURE_LABELS

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

        A soft-failed payment may still receive a late SUCCESS result if the
        parent completes an abandoned or superseded hosted-payment page.
        """
        if self.status != self.Status.FAILED:
            return False
        raw = self.gateway_raw if isinstance(self.gateway_raw, dict) else {}
        return raw.get('stage') in self.SOFT_FAIL_STAGES

    def failure_stage(self) -> str:
        raw = self.gateway_raw if isinstance(self.gateway_raw, dict) else {}
        return str(raw.get('stage') or '')

    def failure_reason(self) -> str:
        """Key of ``FAILURE_LABELS`` for a FAILED payment, ``''`` otherwise."""
        if self.status != self.Status.FAILED:
            return ''
        stage = self.failure_stage()
        if stage in _STAGE_REASONS:
            return _STAGE_REASONS[stage]
        checkout = self.banorte_checkout()
        reason = failure_reason_for(stage, checkout.resultado_payw if checkout else '')
        if reason in ('declined', 'config_error') and checkout is not None \
                and is_amex(checkout.marca_tarjeta):
            return 'card_not_accepted'
        return reason

    def failure_label(self) -> str:
        return self.FAILURE_LABELS.get(self.failure_reason(), '')

    def banorte_checkout(self):
        """The ``BanorteCheckout`` of this payment, or ``None``."""
        try:
            return self.banorte
        except ObjectDoesNotExist:
            return None

    def needs_bank_verification(self) -> bool:
        """A real Banorte approval staff have not yet matched in MultiCobros."""
        checkout = self.banorte_checkout()
        return bool(checkout and checkout.needs_verification)

    def is_simulation(self) -> bool:
        """A Payworks simulation (AUT/DEC/RND): no money moved, never loaded into the POS."""
        checkout = self.banorte_checkout()
        return bool(checkout and not checkout.is_live)


class BanorteCheckout(models.Model):
    """One Banorte "Ventana de Comercio Electrónico" (VCE) attempt for a Payment.

    Holds what the encrypted flow needs server-side: the single-use control
    number sent to Payworks and the AES key material that decrypts Banorte's
    answer (encrypted at rest, wiped once the payment reaches a final state).
    The decrypted Payworks result is copied into typed columns for the admin
    and for the certification test matrix.

    ``verified_at`` records a staff check of the operation in MultiCobros. The
    result reaches us through the parent's browser and Banorte's cipher has no
    integrity check, so a browser-reported approval is credited to the local
    ledger but must be verified before the money is loaded into the POS.
    """

    class Result(models.TextChoices):
        # Payworks ``resultadoPayw`` values (manual v1.7, p. 12).
        APPROVED  = 'A', 'Aprobada'
        DECLINED  = 'D', 'Declinada'
        REJECTED  = 'R', 'Rechazada'
        TIMEOUT   = 'T', 'Sin respuesta del autorizador'
        NOT_SENT  = 'N', 'No enviada (3D Secure / Cybersource)'
        ERROR     = 'E', 'Error interno de Banorte'

    payment        = models.OneToOneField(Payment, on_delete=models.CASCADE,
                                          related_name='banorte')
    control_number = models.CharField(max_length=30, unique=True)
    # AUT/DEC/RND are Payworks simulations (no money moves); PRD is real.
    mode           = models.CharField(max_length=3)
    key_material   = EncryptedTextField(blank=True)
    cert_fingerprint = models.CharField(max_length=64, blank=True)
    created_at     = models.DateTimeField(default=timezone.now)

    # Last browser event and the decrypted Payworks result.
    event          = models.CharField(max_length=20, blank=True)
    result_at      = models.DateTimeField(null=True, blank=True)
    resultado_payw = models.CharField(max_length=1, blank=True, choices=Result.choices)
    referencia     = models.CharField(max_length=20, blank=True, db_index=True)
    codigo_aut     = models.CharField(max_length=10, blank=True)
    resultado_aut  = models.CharField(max_length=10, blank=True)
    codigo_payw    = models.CharField(max_length=12, blank=True)
    texto          = models.CharField(max_length=255, blank=True)
    banco_emisor   = models.CharField(max_length=40, blank=True)
    marca_tarjeta  = models.CharField(max_length=40, blank=True)
    tipo_tarjeta   = models.CharField(max_length=40, blank=True)
    fecha_rsp_cte  = models.CharField(max_length=30, blank=True)
    status_3d      = models.CharField(max_length=10, blank=True)
    eci            = models.CharField(max_length=5, blank=True)
    last_error     = models.CharField(max_length=255, blank=True)

    verified_at    = models.DateTimeField(null=True, blank=True)
    verified_by    = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='verified_banorte_checkouts')

    class Meta:
        verbose_name = 'Operación Banorte'
        verbose_name_plural = 'Operaciones Banorte'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.control_number} ({self.resultado_payw or "sin resultado"})'

    @property
    def is_live(self) -> bool:
        return self.mode == 'PRD'

    @property
    def needs_verification(self) -> bool:
        """Approved real money that staff have not yet matched in MultiCobros."""
        return (self.resultado_payw == self.Result.APPROVED and self.is_live
                and self.verified_at is None)
