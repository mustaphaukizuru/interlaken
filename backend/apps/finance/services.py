"""
finance/services.py — tuition billing operations (all money atomic, MXN, Decimal).

The critical money paths mirror the cafeteria pattern:

- **generation** (``generate_invoices``) is idempotent per ``(student, period)``
  via the unique constraint + ``get_or_create``.
- **payment** reuses the Prompt 10 gateway/webhook layer: ``start_invoice_payment``
  creates a pending ``Payment`` + ``InvoicePayment`` link and returns the hosted
  page URL; the **signed** webhook later calls ``complete_invoice_payment`` to flip
  the invoice to *paid* — atomically and idempotently (a replayed webhook is a
  no-op). We never mark an invoice paid from the browser return.
- **manual admin changes** (``mark_invoice_paid``, ``adjust_invoice``,
  ``cancel_invoice``) are audited via ``InvoiceAdjustment``.
"""
import calendar
import logging
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from .models import (Discount, FeeSchedule, Invoice, InvoiceAdjustment,
                     InvoiceLineItem, InvoicePayment, q2)

logger = logging.getLogger(__name__)


# ── period helpers ────────────────────────────────────────────────────────────

def current_period() -> str:
    """The current billing period as ``"YYYY-MM"`` (school-local time)."""
    return timezone.localdate().strftime('%Y-%m')


def period_due_date(period: str, due_day: int) -> date:
    """The due date for ``period`` ("YYYY-MM") clamped to the month's last day."""
    year, month = (int(x) for x in period.split('-'))
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(max(int(due_day or 1), 1), last_day))


def _period_label(period: str) -> str:
    """Human month label, e.g. ``"2025-08" → "Agosto 2025"`` (Spanish UI)."""
    months = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
              'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
    try:
        year, month = (int(x) for x in period.split('-'))
        return f'{months[month]} {year}'
    except (ValueError, IndexError):
        return period


# ── schedule matching ─────────────────────────────────────────────────────────

def match_schedule(student, schedules=None):
    """Return the ``FeeSchedule`` that applies to ``student`` (or ``None``).

    A schedule whose ``grade`` matches the student's grade wins; otherwise the
    active default schedule (blank ``grade``) applies. ``schedules`` may be a
    pre-fetched active list to avoid a query per student during generation.
    """
    if schedules is None:
        schedules = list(FeeSchedule.objects.filter(active=True))
    grade = (student.grade or '').strip()
    specific = next((s for s in schedules if (s.grade or '').strip() == grade and s.grade), None)
    if specific:
        return specific
    return next((s for s in schedules if not (s.grade or '').strip()), None)


# ── generation ────────────────────────────────────────────────────────────────

def _student_discounts(student, period):
    """Active discounts for ``student`` in force for ``period`` (uses prefetch if present)."""
    discounts = getattr(student, '_prefetched_objects_cache', {}).get('tuition_discounts')
    if discounts is None:
        discounts = student.tuition_discounts.filter(active=True)
    return [d for d in discounts if d.applies_to_period(period)]


@transaction.atomic
def generate_invoice_for_student(student, period, schedule):
    """Create one invoice for ``(student, period)`` from ``schedule``; idempotent.

    Returns ``(invoice, created)``. On a re-run the existing invoice is returned
    untouched (``created=False``) — never duplicated, never re-priced.
    """
    invoice, created = Invoice.objects.get_or_create(
        student=student,
        period=period,
        defaults={
            'fee_schedule': schedule,
            'currency': schedule.currency,
            'due_date': period_due_date(period, schedule.due_day),
            'issue_date': timezone.localdate(),
            'status': Invoice.Status.PENDING,
        },
    )
    if not created:
        return invoice, False

    subtotal = q2(schedule.monthly_amount)
    InvoiceLineItem.objects.create(
        invoice=invoice,
        kind=InvoiceLineItem.Kind.TUITION,
        description=f'Colegiatura {_period_label(period)}',
        amount=subtotal,
    )

    for d in _student_discounts(student, period):
        credit = d.compute_credit(subtotal)
        if credit <= 0:
            continue
        InvoiceLineItem.objects.create(
            invoice=invoice,
            kind=InvoiceLineItem.Kind.DISCOUNT,
            description=f'{d.get_kind_display()}: {d.name}',
            amount=-credit,
        )

    invoice.recalculate()
    return invoice, True


def generate_invoices(period=None):
    """Generate the period's invoices for every active student. Idempotent.

    Called by the ``generate_invoices`` cron command (monthly). Students with no
    matching ``FeeSchedule`` are skipped (and counted) rather than erroring.
    Returns a summary dict.
    """
    from apps.accounts.models import StudentProfile

    period = period or current_period()
    schedules = list(FeeSchedule.objects.filter(active=True))
    if not schedules:
        logger.warning('generate_invoices: no active FeeSchedule — nothing to generate.')
        return {'period': period, 'students': 0, 'created': 0, 'existing': 0, 'skipped': 0}

    students = (StudentProfile.objects.filter(is_active=True)
                .select_related('user')
                .prefetch_related('tuition_discounts'))

    created = existing = skipped = 0
    for student in students:
        schedule = match_schedule(student, schedules)
        if schedule is None:
            skipped += 1
            continue
        _, was_created = generate_invoice_for_student(student, period, schedule)
        created += int(was_created)
        existing += int(not was_created)

    logger.info(
        f'generate_invoices[{period}]: {created} created, {existing} existing, '
        f'{skipped} skipped (no schedule).'
    )
    return {'period': period, 'students': created + existing,
            'created': created, 'existing': existing, 'skipped': skipped}


# ── late fees ─────────────────────────────────────────────────────────────────

def apply_late_fees(as_of=None):
    """Add a one-time late fee to overdue, unpaid invoices past their grace window.

    Idempotent via ``Invoice.late_fee_applied``. An invoice becomes *overdue* here
    and gets a ``LATE_FEE`` line item per its schedule's rule. Returns a summary.
    Called by the ``apply_late_fees`` cron command.
    """
    today = as_of or timezone.localdate()

    candidates = (Invoice.objects
                  .filter(status__in=[Invoice.Status.PENDING, Invoice.Status.OVERDUE],
                          late_fee_applied=False)
                  .select_related('fee_schedule', 'student__user'))

    charged = overdue = 0
    fee_invoices = []
    for invoice in candidates:
        if invoice.is_settled:
            continue
        schedule = invoice.fee_schedule
        grace = schedule.late_fee_grace_days if schedule else 0
        # An invoice is late once today is past due_date + grace.
        if (today - invoice.due_date).days <= grace:
            continue

        with transaction.atomic():
            inv = (Invoice.objects.select_for_update()
                   .select_related('fee_schedule').get(pk=invoice.pk))
            if inv.late_fee_applied or inv.status in (Invoice.Status.PAID, Invoice.Status.CANCELLED):
                continue

            fee = inv.fee_schedule.compute_late_fee(inv.subtotal) if inv.fee_schedule else Decimal('0')
            if fee > 0:
                InvoiceLineItem.objects.create(
                    invoice=inv,
                    kind=InvoiceLineItem.Kind.LATE_FEE,
                    description=f'Recargo por pago tardío ({_period_label(inv.period)})',
                    amount=fee,
                )
                charged += 1
            inv.late_fee_applied = True
            inv.status = Invoice.Status.OVERDUE
            inv.recalculate(save=False)
            inv.save(update_fields=['late_fee_applied', 'status', 'subtotal',
                                    'discount_total', 'late_fee_total', 'amount', 'updated_at'])
            overdue += 1
            if fee > 0:
                fee_invoices.append(inv.pk)

    # Best-effort notify parents that a late fee was applied (outside the locks).
    notified = 0
    for pk in fee_invoices:
        inv = Invoice.objects.select_related('student__user').get(pk=pk)
        notified += _notify_invoice(
            inv, 'Recargo por colegiatura vencida',
            (f'Se aplicó un recargo por mora a la colegiatura de {_period_label(inv.period)} '
             f'de {inv.student.user.full_name}. Saldo actual: ${inv.balance_due:.2f}. '
             f'Le recomendamos pagar a la brevedad para evitar recargos adicionales.'))

    logger.info(f'apply_late_fees[{today}]: {overdue} marked overdue, {charged} fees, '
                f'{notified} notification(s).')
    return {'overdue': overdue, 'charged': charged, 'notified': notified}


# ── reminders ─────────────────────────────────────────────────────────────────

def send_payment_reminders(as_of=None):
    """Remind parents before the due date and after an invoice goes overdue.

    Two deduped reminders per invoice (guarded by ``reminder_before_sent_at`` /
    ``reminder_overdue_sent_at``). Windows come from ``TUITION_REMINDER_BEFORE_DAYS``
    / ``TUITION_REMINDER_OVERDUE_DAYS``. Called by the ``send_payment_reminders``
    cron command. Returns a summary.
    """
    today = as_of or timezone.localdate()
    now = timezone.now()
    before_days = getattr(settings, 'TUITION_REMINDER_BEFORE_DAYS', 3)
    overdue_days = getattr(settings, 'TUITION_REMINDER_OVERDUE_DAYS', 1)

    unpaid = (Invoice.objects
              .filter(status__in=[Invoice.Status.PENDING, Invoice.Status.OVERDUE])
              .select_related('student__user'))

    before = overdue = 0
    for invoice in unpaid:
        if invoice.is_settled:
            continue
        days_to_due = (invoice.due_date - today).days

        # Pre-due reminder: within the window and not yet reminded.
        if (invoice.reminder_before_sent_at is None
                and 0 <= days_to_due <= before_days):
            _notify_invoice(
                invoice, 'Recordatorio de colegiatura',
                (f'La colegiatura de {_period_label(invoice.period)} de '
                 f'{invoice.student.user.full_name} vence el '
                 f'{invoice.due_date.strftime("%d/%m/%Y")}. Monto: '
                 f'${invoice.balance_due:.2f}. Puede pagarla en línea desde el portal.'),
                whatsapp=True)
            invoice.reminder_before_sent_at = now
            invoice.save(update_fields=['reminder_before_sent_at', 'updated_at'])
            before += 1
            continue

        # Overdue reminder: past due by the configured margin and not yet reminded.
        if (invoice.reminder_overdue_sent_at is None
                and -days_to_due >= overdue_days):
            _notify_invoice(
                invoice, 'Colegiatura vencida',
                (f'La colegiatura de {_period_label(invoice.period)} de '
                 f'{invoice.student.user.full_name} venció el '
                 f'{invoice.due_date.strftime("%d/%m/%Y")} y presenta un saldo de '
                 f'${invoice.balance_due:.2f}. Le pedimos regularizar su pago.'),
                whatsapp=True)
            invoice.reminder_overdue_sent_at = now
            invoice.save(update_fields=['reminder_overdue_sent_at', 'updated_at'])
            overdue += 1

    logger.info(f'send_payment_reminders[{today}]: {before} pre-due, {overdue} overdue.')
    return {'before': before, 'overdue': overdue}


# ── online payment (reuses Prompt 10 gateway/webhook) ─────────────────────────

def start_invoice_payment(invoice, user, gateway_name=None):
    """Create a pending ``Payment`` + ``InvoicePayment`` link and return its HPP URL.

    Reuses the Prompt 10 gateway abstraction. The invoice is credited later by the
    **signed** webhook (``complete_invoice_payment``), never here. Returns
    ``(payment, redirect_url)``. Raises ``ValueError`` if the invoice isn't payable.
    """
    from apps.payments.gateways import GATEWAY_CHOICES, get_gateway
    from apps.payments.models import Payment

    if invoice.status == Invoice.Status.CANCELLED:
        raise ValueError('La factura está cancelada.')
    if invoice.is_settled:
        raise ValueError('La factura ya está pagada.')

    if gateway_name and gateway_name.lower() not in GATEWAY_CHOICES:
        raise ValueError('Pasarela de pago no válida.')
    gateway = get_gateway((gateway_name or '').lower() or None)

    payment = Payment.objects.create(
        user=user,
        payment_type=Payment.Type.TUITION,
        amount=invoice.balance_due,
        currency=invoice.currency,
        description=f'Colegiatura {_period_label(invoice.period)} — {invoice.student.user.full_name}',
        gateway=gateway.name,
        status=Payment.Status.PENDING,
    )
    InvoicePayment.objects.create(invoice=invoice, payment=payment, amount=payment.amount)

    return_url = getattr(settings, 'TUITION_RETURN_URL', '')
    redirect_url = gateway.create_checkout(payment, return_url=return_url or None)
    return payment, redirect_url


def complete_invoice_payment(payment):
    """Mark the linked invoice paid for a confirmed tuition ``Payment`` (webhook).

    Atomic + idempotent: a replayed/duplicate webhook is a no-op (guarded by the
    invoice already being settled and the ``InvoicePayment`` amount). Returns the
    ``Invoice`` (or ``None`` when the payment isn't linked to one).
    """
    link = getattr(payment, 'invoice_payment', None)
    if link is None:
        return None

    with transaction.atomic():
        invoice = Invoice.objects.select_for_update().get(pk=link.invoice_id)
        if invoice.status == Invoice.Status.PAID and invoice.is_settled:
            logger.info(f'Invoice #{invoice.id} already paid — webhook no-op.')
            return invoice

        invoice.amount_paid = q2(invoice.amount_paid) + q2(payment.amount)
        if invoice.balance_due <= 0:
            invoice.status = Invoice.Status.PAID
            invoice.paid_at = timezone.now()
        invoice.save(update_fields=['amount_paid', 'status', 'paid_at', 'updated_at'])

    logger.info(f'Invoice #{invoice.id} credited ${payment.amount} via payment #{payment.id}.')
    return invoice


def fail_invoice_payment(payment):
    """No-op bookkeeping for a failed tuition payment (invoice stays unpaid).

    Returns the linked ``Invoice`` (or ``None``). Nothing is credited — the
    invoice simply remains payable so the parent can retry.
    """
    link = getattr(payment, 'invoice_payment', None)
    return link.invoice if link is not None else None


def notify_invoice_result(payment, *, success: bool) -> int:
    """Notify the student's guardians of a tuition-payment outcome. Best-effort.

    Call **after** the DB transaction commits. Returns guardians notified.
    """
    link = getattr(payment, 'invoice_payment', None)
    if link is None:
        return 0
    invoice = link.invoice
    if success:
        title = 'Pago de colegiatura confirmado'
        message = (f'Se registró el pago de ${payment.amount:.2f} de la colegiatura de '
                   f'{_period_label(invoice.period)} de {invoice.student.user.full_name}. '
                   f'Referencia: {payment.gateway_tx_id or payment.id}. Gracias por su pago.')
    else:
        title = 'Pago de colegiatura no completado'
        message = (f'No fue posible procesar el pago de ${payment.amount:.2f} de la '
                   f'colegiatura de {_period_label(invoice.period)} de '
                   f'{invoice.student.user.full_name}. No se realizó ningún cargo; '
                   f'puede intentarlo nuevamente desde el portal.')
    return _notify_invoice(invoice, title, message)


# ── manual admin changes (audited) ────────────────────────────────────────────

def mark_invoice_paid(invoice, reason='', admin=None, method='efectivo'):
    """Manually settle an invoice (e.g. cash at the cashier). Audited & idempotent.

    Records a ``MARK_PAID`` ``InvoiceAdjustment``. Returns it, or ``None`` if the
    invoice was already settled.
    """
    with transaction.atomic():
        inv = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if inv.status == Invoice.Status.PAID and inv.is_settled:
            return None
        applied = inv.balance_due
        inv.amount_paid = inv.amount
        inv.status = Invoice.Status.PAID
        inv.paid_at = timezone.now()
        inv.save(update_fields=['amount_paid', 'status', 'paid_at', 'updated_at'])

        adj = InvoiceAdjustment.objects.create(
            invoice=inv, admin=admin, kind=InvoiceAdjustment.Kind.MARK_PAID,
            amount=applied, reason=reason or f'Pago registrado manualmente ({method})',
            status_after=inv.status, amount_after=inv.amount, amount_paid_after=inv.amount_paid,
        )

    _notify_invoice(
        inv, 'Colegiatura pagada',
        (f'Se registró el pago de la colegiatura de {_period_label(inv.period)} de '
         f'{inv.student.user.full_name}. Gracias.'))
    logger.info(f'Invoice #{inv.id} manually marked paid by {admin} — {reason!r}.')
    return adj


def adjust_invoice(invoice, amount, reason, admin=None):
    """Apply a signed manual adjustment (credit/charge) to an invoice. Audited.

    ``amount`` is a signed ``Decimal`` added as an ``ADJUSTMENT`` line item
    (negative = credit/discount, positive = extra charge). Recomputes totals and
    re-derives status. Raises ``ValueError`` on zero or if it overdraws the total.
    """
    amount = q2(amount)
    if amount == 0:
        raise ValueError('El monto del ajuste no puede ser cero.')
    if not (reason or '').strip():
        raise ValueError('El ajuste requiere un motivo.')

    with transaction.atomic():
        inv = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if inv.status == Invoice.Status.CANCELLED:
            raise ValueError('No se puede ajustar una factura cancelada.')

        InvoiceLineItem.objects.create(
            invoice=inv, kind=InvoiceLineItem.Kind.ADJUSTMENT,
            description=f'Ajuste manual: {reason}', amount=amount)
        inv.recalculate(save=False)
        if inv.amount < 0:
            raise ValueError('El ajuste dejaría un total negativo.')

        # Re-derive status against the new total.
        if inv.is_settled and inv.amount_paid > 0:
            inv.status = Invoice.Status.PAID
            inv.paid_at = inv.paid_at or timezone.now()
        elif inv.status == Invoice.Status.PAID and not inv.is_settled:
            inv.status = (Invoice.Status.OVERDUE
                          if inv.due_date < timezone.localdate() else Invoice.Status.PENDING)
        inv.save(update_fields=['subtotal', 'discount_total', 'late_fee_total', 'amount',
                                'status', 'paid_at', 'updated_at'])

        adj = InvoiceAdjustment.objects.create(
            invoice=inv, admin=admin, kind=InvoiceAdjustment.Kind.ADJUST,
            amount=amount, reason=reason,
            status_after=inv.status, amount_after=inv.amount, amount_paid_after=inv.amount_paid,
        )

    verb = 'cargo' if amount > 0 else 'crédito'
    _notify_invoice(
        inv, 'Ajuste en su colegiatura',
        (f'Se aplicó un {verb} de ${amount.copy_abs():.2f} a la colegiatura de '
         f'{_period_label(inv.period)} de {inv.student.user.full_name}. '
         f'Motivo: {reason}. Saldo actual: ${inv.balance_due:.2f}.'))
    logger.info(f'Invoice #{inv.id} adjusted ${amount} by {admin} — {reason!r}.')
    return adj


def cancel_invoice(invoice, reason, admin=None):
    """Cancel an invoice (no longer owed). Audited. Raises if already paid."""
    if not (reason or '').strip():
        raise ValueError('La cancelación requiere un motivo.')
    with transaction.atomic():
        inv = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if inv.status == Invoice.Status.PAID:
            raise ValueError('No se puede cancelar una factura ya pagada.')
        if inv.status == Invoice.Status.CANCELLED:
            return None
        inv.status = Invoice.Status.CANCELLED
        inv.save(update_fields=['status', 'updated_at'])
        adj = InvoiceAdjustment.objects.create(
            invoice=inv, admin=admin, kind=InvoiceAdjustment.Kind.CANCEL,
            amount=Decimal('0.00'), reason=reason,
            status_after=inv.status, amount_after=inv.amount, amount_paid_after=inv.amount_paid,
        )
    logger.info(f'Invoice #{inv.id} cancelled by {admin} — {reason!r}.')
    return adj


# ── dashboard ─────────────────────────────────────────────────────────────────

def dashboard_summary(period=None):
    """Finance KPIs for the admin dashboard: revenue, outstanding, collection rate.

    Scoped to ``period`` when given, else across all non-cancelled invoices.
    """
    qs = Invoice.objects.exclude(status=Invoice.Status.CANCELLED)
    if period:
        qs = qs.filter(period=period)

    agg = qs.aggregate(
        billed=Sum('amount'),
        collected=Sum('amount_paid'),
        invoices=Count('id'),
        paid=Count('id', filter=Q(status=Invoice.Status.PAID)),
        overdue=Count('id', filter=Q(status=Invoice.Status.OVERDUE)),
        pending=Count('id', filter=Q(status=Invoice.Status.PENDING)),
    )
    billed = q2(agg['billed'])
    collected = q2(agg['collected'])
    outstanding = q2(billed - collected)
    rate = float((collected / billed * 100).quantize(Decimal('0.1'))) if billed > 0 else 0.0

    return {
        'period': period or 'all',
        'billed': str(billed),
        'collected': str(collected),
        'outstanding': str(outstanding),
        'collection_rate': rate,
        'invoices': agg['invoices'] or 0,
        'paid': agg['paid'] or 0,
        'overdue': agg['overdue'] or 0,
        'pending': agg['pending'] or 0,
    }


# ── notification helper ───────────────────────────────────────────────────────

def _notify_invoice(invoice, title, message, *, whatsapp=False) -> int:
    """Fan out an in-app + email (and optional WhatsApp) notice to every guardian."""
    from apps.portal.models import Notification
    from apps.portal.services import notify

    notified = 0
    for parent in invoice.student.parents.all():
        notify(parent, Notification.NotifType.PAYMENT, title, message, whatsapp=whatsapp)
        notified += 1
    return notified
