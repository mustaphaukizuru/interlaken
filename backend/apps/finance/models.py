"""
finance/models.py — recurring tuition (colegiatura) billing.

Money model (all MXN, ``Decimal`` throughout — never float):

- ``FeeSchedule`` — the *rule* for a grade/level: monthly amount, the day of the
  month payment is due, and how a late fee is charged. ``generate_invoices`` reads
  the matching schedule for each student to mint that month's invoice.
- ``Discount`` — a per-student adjustment (sibling/family discount, scholarship /
  *beca*) that generation applies as a negative line item. Keeping these as data
  (not hardcoded) means becas are auditable and change without a deploy.
- ``Invoice`` — one student's charge for one billing ``period`` ("YYYY-MM"). Its
  ``amount`` is the sum of its ``InvoiceLineItem`` rows (tuition + late fees minus
  discounts); ``amount_paid`` tracks money received. ``(student, period)`` is
  unique so generation is idempotent.
- ``InvoiceLineItem`` — an itemised, signed charge/credit on an invoice.
- ``InvoicePayment`` — links a successful ``payments.Payment`` to the invoice it
  settled (the signed webhook flips the invoice to *paid* through this row).
- ``InvoiceAdjustment`` — audit trail for every **manual** admin change
  (mark-paid, adjust, cancel), mirroring cafeteria's ``BalanceAdjustment``.
"""
from decimal import Decimal

from django.db import models
from django.utils import timezone

from apps.accounts.models import StudentProfile

TWO_PLACES = Decimal('0.01')


def q2(value) -> Decimal:
    """Quantise any money value to 2 decimal places as a ``Decimal``."""
    return Decimal(str(value or 0)).quantize(TWO_PLACES)


class FeeSchedule(models.Model):
    """A monthly-tuition rule for a grade (or a school-wide default).

    Matching (see ``services.match_schedule``): the active schedule whose ``grade``
    equals the student's grade wins; otherwise the active schedule with a blank
    ``grade`` (the default) applies. Optional ``level`` is informational for admins.
    """

    class LateFeeType(models.TextChoices):
        NONE    = 'none',    'Sin recargo'
        FIXED   = 'fixed',   'Monto fijo (MXN)'
        PERCENT = 'percent', 'Porcentaje (%)'

    name           = models.CharField(max_length=120)
    level          = models.CharField(max_length=30, blank=True,
                                      help_text='Preescolar / Primaria / Secundaria (informativo).')
    grade          = models.CharField(max_length=20, blank=True,
                                      help_text='Grado exacto (ej. "3° Primaria"). Vacío = regla '
                                                'predeterminada para toda la escuela.')
    monthly_amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency       = models.CharField(max_length=3, default='MXN')
    due_day        = models.PositiveSmallIntegerField(
                         default=5, help_text='Día del mes en que vence la colegiatura (1-28).')

    late_fee_type      = models.CharField(max_length=10, choices=LateFeeType.choices,
                                          default=LateFeeType.NONE)
    # For FIXED this is MXN; for PERCENT it is a whole-number percentage (e.g. 10 = 10%).
    late_fee_amount    = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    late_fee_grace_days= models.PositiveSmallIntegerField(
                             default=0, help_text='Días de gracia tras el vencimiento antes del recargo.')

    active         = models.BooleanField(default=True)
    created_at     = models.DateTimeField(default=timezone.now)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Plan de Colegiatura'
        verbose_name_plural = 'Planes de Colegiatura'
        ordering = ['-active', 'grade', 'name']

    def __str__(self):
        target = self.grade or 'Predeterminado'
        return f'{self.name} — {target} (${self.monthly_amount:.2f})'

    def compute_late_fee(self, base_amount) -> Decimal:
        """Late fee this schedule charges on ``base_amount`` (the tuition due)."""
        base_amount = q2(base_amount)
        if self.late_fee_type == self.LateFeeType.FIXED:
            return q2(self.late_fee_amount)
        if self.late_fee_type == self.LateFeeType.PERCENT:
            return q2(base_amount * q2(self.late_fee_amount) / Decimal('100'))
        return Decimal('0.00')


class Discount(models.Model):
    """A recurring per-student credit applied at invoice generation.

    Models sibling/family discounts and scholarships (*becas*) as data so they are
    auditable and editable without code changes. ``percent`` applies to the tuition
    subtotal; ``fixed`` is a flat MXN credit. Optional ``start_period``/
    ``end_period`` ("YYYY-MM") bound when it applies.
    """

    class Kind(models.TextChoices):
        SIBLING     = 'sibling',     'Descuento por hermanos'
        FAMILY      = 'family',      'Descuento familiar'
        SCHOLARSHIP = 'scholarship', 'Beca'
        OTHER       = 'other',       'Otro'

    class Method(models.TextChoices):
        PERCENT = 'percent', 'Porcentaje (%)'
        FIXED   = 'fixed',   'Monto fijo (MXN)'

    student      = models.ForeignKey(StudentProfile, on_delete=models.CASCADE,
                                     related_name='tuition_discounts')
    name         = models.CharField(max_length=120)
    kind         = models.CharField(max_length=20, choices=Kind.choices, default=Kind.OTHER)
    method       = models.CharField(max_length=10, choices=Method.choices, default=Method.PERCENT)
    # PERCENT: whole-number percentage (10 = 10%). FIXED: MXN credit.
    value        = models.DecimalField(max_digits=10, decimal_places=2)
    active       = models.BooleanField(default=True)
    start_period = models.CharField(max_length=7, blank=True, help_text='YYYY-MM (inclusive).')
    end_period   = models.CharField(max_length=7, blank=True, help_text='YYYY-MM (inclusive).')
    note         = models.CharField(max_length=255, blank=True)
    created_at   = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'Descuento / Beca'
        verbose_name_plural = 'Descuentos / Becas'
        ordering = ['student', 'name']

    def __str__(self):
        return f'{self.student} — {self.name}'

    def applies_to_period(self, period: str) -> bool:
        """True when this active discount is in force for billing ``period`` (YYYY-MM)."""
        if not self.active:
            return False
        if self.start_period and period < self.start_period:
            return False
        if self.end_period and period > self.end_period:
            return False
        return True

    def compute_credit(self, subtotal) -> Decimal:
        """Positive credit amount this discount grants on the tuition ``subtotal``."""
        subtotal = q2(subtotal)
        if self.method == self.Method.PERCENT:
            credit = q2(subtotal * q2(self.value) / Decimal('100'))
        else:
            credit = q2(self.value)
        # Never credit more than the subtotal.
        return min(credit, subtotal) if credit > 0 else Decimal('0.00')


class Invoice(models.Model):
    """One student's tuition charge for one billing period ("YYYY-MM")."""

    class Status(models.TextChoices):
        PENDING   = 'pending',   'Pendiente'
        PAID      = 'paid',      'Pagada'
        OVERDUE   = 'overdue',   'Vencida'
        CANCELLED = 'cancelled', 'Cancelada'

    # PROTECT: tuition history must survive a student delete — deleting a student
    # with invoices raises ProtectedError instead of silently erasing the record.
    student       = models.ForeignKey(StudentProfile, on_delete=models.PROTECT,
                                      related_name='invoices')
    fee_schedule  = models.ForeignKey(FeeSchedule, on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='invoices')
    period        = models.CharField(max_length=7, help_text='Periodo de facturación YYYY-MM.')
    issue_date    = models.DateField(default=timezone.localdate)
    due_date      = models.DateField()
    currency      = models.CharField(max_length=3, default='MXN')

    # Totals — all derived from the line items by ``recalculate`` (kept denormalised
    # for cheap listing/aggregation). ``amount`` is the total due.
    subtotal      = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount_total= models.DecimalField(max_digits=10, decimal_places=2, default=0)
    late_fee_total= models.DecimalField(max_digits=10, decimal_places=2, default=0)
    amount        = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    amount_paid   = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    status        = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    # Idempotency guard for ``apply_late_fees`` — a fee is added at most once.
    late_fee_applied      = models.BooleanField(default=False)
    # Dedup guards for ``send_payment_reminders`` (one of each kind per invoice).
    reminder_before_sent_at  = models.DateTimeField(null=True, blank=True)
    reminder_overdue_sent_at = models.DateTimeField(null=True, blank=True)

    paid_at       = models.DateTimeField(null=True, blank=True)
    notes         = models.CharField(max_length=255, blank=True)
    created_at    = models.DateTimeField(default=timezone.now)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Colegiatura (Factura)'
        verbose_name_plural = 'Colegiaturas (Facturas)'
        ordering = ['-period', 'student']
        constraints = [
            models.UniqueConstraint(fields=['student', 'period'], name='uniq_invoice_student_period'),
        ]
        indexes = [
            models.Index(fields=['status', 'due_date']),
            models.Index(fields=['period']),
            models.Index(fields=['status', 'late_fee_applied']),
        ]

    def __str__(self):
        return f'{self.student} — {self.period} (${self.amount:.2f} {self.status})'

    @property
    def balance_due(self) -> Decimal:
        return q2(self.amount) - q2(self.amount_paid)

    @property
    def is_settled(self) -> bool:
        return self.balance_due <= 0

    def recalculate(self, *, save: bool = True):
        """Recompute the denormalised totals from the current line items.

        Does **not** change ``status`` (that is driven by payments/generation);
        it only keeps ``subtotal``/``discount_total``/``late_fee_total``/``amount``
        in sync with the itemised charges.
        """
        subtotal = discount = late_fee = Decimal('0.00')
        for li in self.line_items.all():
            amt = q2(li.amount)
            if li.kind == InvoiceLineItem.Kind.TUITION:
                subtotal += amt
            elif li.kind == InvoiceLineItem.Kind.DISCOUNT:
                discount += -amt if amt < 0 else amt
            elif li.kind == InvoiceLineItem.Kind.LATE_FEE:
                late_fee += amt
            else:  # ADJUSTMENT — signed, folds into the total directly
                subtotal += amt
        self.subtotal = q2(subtotal)
        self.discount_total = q2(discount)
        self.late_fee_total = q2(late_fee)
        self.amount = q2(self.subtotal - self.discount_total + self.late_fee_total)
        if save:
            self.save(update_fields=['subtotal', 'discount_total', 'late_fee_total',
                                     'amount', 'updated_at'])


class InvoiceLineItem(models.Model):
    """An itemised, signed charge/credit on an invoice (MXN)."""

    class Kind(models.TextChoices):
        TUITION    = 'tuition',    'Colegiatura'
        DISCOUNT   = 'discount',   'Descuento'
        LATE_FEE   = 'late_fee',   'Recargo por mora'
        ADJUSTMENT = 'adjustment', 'Ajuste'

    invoice     = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='line_items')
    kind        = models.CharField(max_length=12, choices=Kind.choices, default=Kind.TUITION)
    description = models.CharField(max_length=200)
    # Signed MXN: tuition/late-fee positive, discount negative.
    amount      = models.DecimalField(max_digits=10, decimal_places=2)
    created_at  = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'Concepto de Factura'
        verbose_name_plural = 'Conceptos de Factura'
        ordering = ['id']

    def __str__(self):
        return f'{self.get_kind_display()}: {self.description} (${self.amount:.2f})'


class InvoicePayment(models.Model):
    """Links a successful ``payments.Payment`` to the invoice it settled.

    The signed, idempotent payment webhook creates/uses this row to flip the
    invoice to *paid* — one ``Payment`` settles at most one invoice (OneToOne).
    """
    invoice    = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='invoice_payments')
    payment    = models.OneToOneField('payments.Payment', on_delete=models.CASCADE,
                                      related_name='invoice_payment')
    amount     = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(default=timezone.now)
    # Set once the credit has been posted to the invoice. Gives per-payment
    # idempotency: a distinct second payment on an already-paid invoice is
    # recorded (as an overpayment) rather than silently dropped, while a replay
    # of the same payment stays a no-op.
    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Pago de Colegiatura'
        verbose_name_plural = 'Pagos de Colegiatura'
        ordering = ['-created_at']

    def __str__(self):
        return f'Factura #{self.invoice_id} ← Pago #{self.payment_id} (${self.amount:.2f})'


class InvoiceAdjustment(models.Model):
    """Audit trail for every **manual** admin change to an invoice.

    Mirrors cafeteria's ``BalanceAdjustment``: who / when / what / why, so every
    manual mark-paid, adjustment or cancellation is traceable (spec: audited
    manual changes).
    """

    class Kind(models.TextChoices):
        MARK_PAID = 'mark_paid', 'Marcada como pagada'
        ADJUST    = 'adjust',    'Ajuste de monto'
        CANCEL    = 'cancel',    'Cancelación'
        DISCOUNT  = 'discount',  'Descuento manual'
        REFUND    = 'refund',    'Devolución'

    invoice    = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='adjustments')
    admin      = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='invoice_adjustments')
    kind       = models.CharField(max_length=12, choices=Kind.choices)
    # Signed MXN delta this action applied to the invoice (0 for status-only changes).
    amount     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    reason     = models.TextField()
    # Snapshots after the action, for the audit record.
    status_after      = models.CharField(max_length=12, blank=True)
    amount_after      = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    amount_paid_after = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'Ajuste de Factura'
        verbose_name_plural = 'Ajustes de Factura'
        ordering = ['-created_at']

    def __str__(self):
        return f'Factura #{self.invoice_id} — {self.get_kind_display()} (${self.amount:.2f})'
