from datetime import timedelta
from decimal import Decimal

from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.serializers import StudentProfileSerializer

from .models import (
    BalanceAdjustment,
    CafeteriaBalance,
    CafeteriaTransaction,
    LoyverseProfile,
    TopUpRequest,
)

# Minimum top-up. The $1 test amount used during Banorte certification was
# removed on 2026-10-20 (owner: "everything is working"): $20 for everyone.
TOPUP_MIN_AMOUNT = Decimal('20.00')


def topup_min_amount(user) -> Decimal:
    """The smallest top-up ``user`` may request."""
    return TOPUP_MIN_AMOUNT


class LoyverseProfileSerializer(serializers.ModelSerializer):
    """Read-only Loyverse customer snapshot for the admin student console."""
    class Meta:
        model = LoyverseProfile
        fields = [
            'customer_code', 'name', 'email', 'phone_number', 'address_code',
            'note', 'first_visit', 'last_visit', 'total_visits', 'total_spent',
            'total_points', 'loyverse_created_at', 'synced_at',
        ]
        read_only_fields = fields


class LoyverseCustomerSerializer(serializers.ModelSerializer):
    """One row of the store-wide customer directory (students, staff, tests).

    ``receipts`` is the number of wallet receipts parked for a card with no
    student (staff meals); it comes from the view's one grouped query via
    ``context['receipt_counts']`` so listing 400 cards is not 400 queries.
    """
    student = serializers.SerializerMethodField()
    receipts = serializers.SerializerMethodField()
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = LoyverseProfile
        fields = [
            'loyverse_id', 'kind', 'kind_display', 'customer_code', 'name', 'email',
            'phone_number', 'address_code', 'note', 'first_visit', 'last_visit',
            'total_visits', 'total_spent', 'total_points', 'loyverse_created_at',
            'loyverse_updated_at', 'synced_at', 'missing_since', 'student', 'receipts',
        ]
        read_only_fields = fields

    def get_student(self, obj):
        s = obj.student
        if s is None:
            return None
        return {'id': s.id, 'name': s.user.full_name, 'grade': s.grade,
                'group': s.group, 'student_id': s.student_id}

    def get_receipts(self, obj):
        return (self.context.get('receipt_counts') or {}).get(obj.loyverse_id, 0)


def build_spend_map(students):
    """Today/week purchase totals per student in ONE grouped aggregate.

    Passed as ``spend_map`` serializer context by family balance reads so the
    per-balance ``_spend_since`` pair (2 queries × N children) never runs.
    Window bounds match ``get_today_spend``/``get_week_spend`` exactly.
    """
    now = timezone.localtime()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=now.weekday())
    return {
        row['student']: row
        for row in (CafeteriaTransaction.objects
                    .filter(student__in=students,
                            transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                            date__gte=week_start)
                    .values('student')
                    .annotate(week=Sum('amount'),
                              today=Sum('amount', filter=Q(date__gte=today_start))))
    }


def build_pending_topups_map(students) -> dict:
    """``{student_id: [pending top-up, ...]}`` in ONE pair of queries.

    The paid online top-ups a family is still waiting for (scheduled apply
    mode): shown next to the balance with the promised load time, so a paid
    recarga is never "lost" between the bank and the POS. ``folio`` is the
    payment id printed on the comprobante.
    """
    from apps.cafeteria.services import paid_topups_pending
    from apps.payments.models import Payment

    topups = list(paid_topups_pending().filter(student__in=students)
                  .order_by('processed_at', 'pk'))
    if not topups:
        return {}
    folios = dict(Payment.objects.filter(related_topup__in=topups, status=Payment.Status.SUCCESS)
                  .order_by('created_at', 'pk').values_list('related_topup_id', 'pk'))
    out: dict = {}
    for t in topups:
        out.setdefault(t.student_id, []).append({
            'id': t.pk,
            'amount': f'{t.amount:.2f}',
            'paid_at': t.processed_at.isoformat() if t.processed_at else None,
            'apply_due_at': t.apply_due_at.isoformat() if t.apply_due_at else None,
            'folio': folios.get(t.pk),
        })
    return out


class CafeteriaBalanceSerializer(serializers.ModelSerializer):
    student = StudentProfileSerializer(read_only=True)
    is_low_balance = serializers.BooleanField(read_only=True)
    # Paid online top-ups not applied yet (family views; see build_pending_topups_map).
    pending_topups = serializers.SerializerMethodField()
    # Running spend for budget progress bars (F13). Two extra queries each, so
    # only computed for family views that pass ``include_spend`` in context —
    # admin balance lists (large N) keep them null and stay cheap.
    today_spend = serializers.SerializerMethodField()
    week_spend  = serializers.SerializerMethodField()

    class Meta:
        model = CafeteriaBalance
        fields = ['id', 'student', 'balance', 'low_balance_threshold', 'last_synced',
                  'is_low_balance', 'daily_spend_limit', 'weekly_spend_limit',
                  'today_spend', 'week_spend', 'pending_topups']

    def get_pending_topups(self, obj):
        pending = self.context.get('pending_topups')
        if pending is None:
            return []
        return pending.get(obj.student_id, [])

    def _spend_since(self, obj, start):
        total = (CafeteriaTransaction.objects
                 .filter(student=obj.student,
                         transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                         date__gte=start)
                 .aggregate(t=Sum('amount'))['t'])
        return str(total or Decimal('0'))

    def get_today_spend(self, obj):
        if not self.context.get('include_spend'):
            return None
        spend_map = self.context.get('spend_map')
        if spend_map is not None:
            row = spend_map.get(obj.student_id) or {}
            return str(row.get('today') or Decimal('0'))
        now = timezone.localtime()
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return self._spend_since(obj, start)

    def get_week_spend(self, obj):
        if not self.context.get('include_spend'):
            return None
        spend_map = self.context.get('spend_map')
        if spend_map is not None:
            row = spend_map.get(obj.student_id) or {}
            return str(row.get('week') or Decimal('0'))
        now = timezone.localtime()
        start = (now.replace(hour=0, minute=0, second=0, microsecond=0)
                 - timedelta(days=now.weekday()))
        return self._spend_since(obj, start)


class CafeteriaTransactionSerializer(serializers.ModelSerializer):
    # No source= here: DRF reads ``obj.student_id``, the FK column already on
    # the row. ``source='student.id'`` fetched the whole related object once per
    # row (N+1 on every ledger page).
    student_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = CafeteriaTransaction
        fields = [
            'id', 'student_id', 'transaction_type', 'amount', 'description',
            'items', 'balance_after', 'date', 'loyverse_receipt_id', 'applied',
        ]


class TopUpRequestSerializer(serializers.ModelSerializer):
    # The model DecimalField has no validators, so without this floor a parent
    # could POST amount=0 or a NEGATIVE value; a later admin "apply" would then
    # DEBIT the child's balance (add_points_to_customer(points<0)). Match the
    # payment-initiation floor and add a sane ceiling against fat-finger typos.
    # Match parent UI copy: mínimo $20 · máximo $2,000 (fat-finger guard).
    # Test accounts (PAYMENTS_TEST_EMAILS) may go down to $1 to try the
    # Banorte checkout cheaply; validate_amount applies the per-user floor.
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2,
        min_value=TOPUP_MIN_AMOUNT, max_value=Decimal('2000.00'))

    def validate_amount(self, value):
        request = self.context.get('request')
        if value < topup_min_amount(getattr(request, 'user', None)):
            raise serializers.ValidationError(
                f'El monto mínimo por recarga es ${TOPUP_MIN_AMOUNT:.0f}.')
        return value

    class Meta:
        model = TopUpRequest
        fields = ['id', 'student', 'amount', 'method', 'status', 'created_at', 'processed_at',
                  'apply_due_at', 'applied_at']
        read_only_fields = ['status', 'created_at', 'processed_at', 'apply_due_at', 'applied_at']


class TopUpLogSerializer(serializers.ModelSerializer):
    """A deposit-log row: a ``TopUpRequest`` enriched with student + payment info.

    Used by the admin deposits log (spec §5). The gateway/payment fields are pulled
    from the linked online ``Payment`` (via ``related_topup``) when one exists;
    office (cash) top-ups leave them blank.
    """
    student_id   = serializers.IntegerField(source='student.id', read_only=True)
    student_name = serializers.CharField(source='student.user.full_name', read_only=True)
    student_code = serializers.CharField(source='student.student_id', read_only=True)
    method_display = serializers.CharField(source='get_method_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    gateway        = serializers.SerializerMethodField()
    payment_status = serializers.SerializerMethodField()
    gateway_tx_id  = serializers.SerializerMethodField()
    payment_id     = serializers.SerializerMethodField()
    banorte        = serializers.SerializerMethodField()
    needs_pos_load = serializers.SerializerMethodField()
    needs_pos_unload = serializers.SerializerMethodField()
    pos_loaded_by_name = serializers.CharField(
        source='pos_loaded_by.full_name', read_only=True, default='')
    pos_unloaded_by_name = serializers.CharField(
        source='pos_unloaded_by.full_name', read_only=True, default='')
    applied_by_name = serializers.CharField(
        source='applied_by.full_name', read_only=True, default='')
    applied_via_display = serializers.CharField(
        source='get_applied_via_display', read_only=True)
    needs_apply = serializers.SerializerMethodField()
    apply_overdue = serializers.SerializerMethodField()
    payer = serializers.SerializerMethodField()
    loyverse_code = serializers.SerializerMethodField()
    loyverse_points = serializers.SerializerMethodField()
    wallet_balance = serializers.SerializerMethodField()

    class Meta:
        model = TopUpRequest
        fields = [
            'id', 'student_id', 'student_name', 'student_code', 'amount',
            'method', 'method_display', 'status', 'status_display',
            'gateway', 'payment_status', 'gateway_tx_id', 'payment_id', 'banorte',
            'created_at', 'processed_at',
            'pos_loaded_at', 'pos_loaded_by_name', 'needs_pos_load',
            'pos_unload_needed_at', 'pos_unloaded_at', 'pos_unloaded_by_name',
            'needs_pos_unload',
            'apply_due_at', 'applied_at', 'applied_via', 'applied_via_display',
            'applied_by_name', 'needs_apply', 'apply_overdue',
            'loyverse_code', 'loyverse_points', 'wallet_balance', 'payer',
        ]

    def get_payer(self, obj):
        """The account that paid a card top-up, and when (``None`` for cash)."""
        p = self._payment(obj)
        if p is None or p.user_id is None:
            return None
        user = p.user
        checkout = p.banorte_checkout()
        return {
            'name': user.full_name,
            'email': user.email,
            'phone': user.whatsapp,
            'paid_at': p.completed_at or p.created_at,
            'card_brand': checkout.marca_tarjeta if checkout else '',
        }

    def get_needs_apply(self, obj):
        if obj.method != TopUpRequest.Method.ONLINE or obj.status != TopUpRequest.Status.PAID:
            return False
        from apps.payments.models import Payment
        p = self._payment(obj)
        return p is not None and p.status == Payment.Status.SUCCESS

    def get_apply_overdue(self, obj):
        return bool(self.get_needs_apply(obj) and obj.apply_due_at
                    and obj.apply_due_at <= timezone.now())

    @staticmethod
    def _related(obj, name):
        # Reverse one-to-ones raise when absent, even after select_related.
        try:
            return getattr(obj.student, name)
        except Exception:  # noqa: BLE001 — RelatedObjectDoesNotExist
            return None

    def get_loyverse_code(self, obj):
        profile = self._related(obj, 'loyverse_profile')
        return profile.customer_code if profile else ''

    def get_loyverse_points(self, obj):
        """Loyverse points from the last sync snapshot (the queue's "¿ya se cargó?")."""
        profile = self._related(obj, 'loyverse_profile')
        return f'{profile.total_points:.2f}' if profile else None

    def get_wallet_balance(self, obj):
        cb = self._related(obj, 'cafeteria_balance')
        return f'{cb.balance:.2f}' if cb else None

    def get_needs_pos_load(self, obj):
        if not (
            obj.method == TopUpRequest.Method.ONLINE
            and obj.status == TopUpRequest.Status.COMPLETED
            and obj.pos_loaded_at is None
        ):
            return False
        # Refunded before POS load: do not ask staff to credit Loyverse. A
        # Payworks simulation (AUT) moved no money: never load it either.
        from apps.payments.models import Payment
        p = self._payment(obj)
        if p is not None and (p.status == Payment.Status.REFUNDED or p.is_simulation()):
            return False
        return True

    def get_needs_pos_unload(self, obj):
        return (
            obj.pos_unload_needed_at is not None
            and obj.pos_unloaded_at is None
        )

    def _payment(self, obj):
        # ``payments`` is the reverse accessor of Payment.related_topup. Read
        # via .all() so the view's ordered Prefetch is honoured (an .order_by()
        # here would discard the prefetch cache and re-query per row).
        if not hasattr(obj, '_cached_payment'):
            obj._cached_payment = next(iter(obj.payments.all()), None)
        return obj._cached_payment

    def get_gateway(self, obj):
        p = self._payment(obj)
        return p.gateway if p else ''

    def get_payment_status(self, obj):
        p = self._payment(obj)
        return p.status if p else ''

    def get_gateway_tx_id(self, obj):
        p = self._payment(obj)
        return (p.gateway_tx_id or '') if p else ''

    def get_payment_id(self, obj):
        p = self._payment(obj)
        return p.pk if p else None

    def get_banorte(self, obj):
        """What staff need to find the operation in MultiCobros (or ``None``).

        Staff-only (admin deposit log): includes Payworks' raw answer
        (``codigo_payw``, ``texto``) and our ``last_error``.
        """
        from apps.payments.multicobros import can_reconcile, review_reason

        p = self._payment(obj)
        checkout = p.banorte_checkout() if p else None
        if checkout is None:
            return None
        return {
            'control_number': checkout.control_number,
            'created_at': checkout.created_at,
            'referencia': checkout.referencia,
            'codigo_aut': checkout.codigo_aut,
            'resultado': checkout.resultado_payw,
            'resultado_label': (
                checkout.get_resultado_payw_display() if checkout.resultado_payw else ''),
            'codigo_payw': checkout.codigo_payw,
            'texto': checkout.texto,
            'last_error': checkout.last_error,
            'status_3d': checkout.status_3d,
            'mode': checkout.mode,
            'simulation': not checkout.is_live,
            'marca_tarjeta': checkout.marca_tarjeta,
            'verified_at': checkout.verified_at,
            'verified_by_name': checkout.verified_by.full_name if checkout.verified_by_id else '',
            'needs_verification': checkout.needs_verification,
            'failure_reason': p.failure_reason(),
            'failure_label': p.failure_label(),
            'review_reason': review_reason(p, checkout) or '',
            'can_reconcile': can_reconcile(p),
        }


class BalanceAdjustmentSerializer(serializers.ModelSerializer):
    admin_name    = serializers.CharField(source='admin.full_name', read_only=True, default='')
    kind_display  = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = BalanceAdjustment
        fields = [
            'id', 'kind', 'kind_display', 'amount', 'reason', 'balance_after',
            'admin_name', 'transaction', 'source_transaction', 'created_at',
        ]


class LowBalanceThresholdSerializer(serializers.Serializer):
    """Validates a family-set low-balance (saldo bajo) warning level."""
    threshold = serializers.DecimalField(
        max_digits=8, decimal_places=2,
        min_value=Decimal('0.00'), max_value=Decimal('100000.00'))


class SpendLimitsSerializer(serializers.Serializer):
    """Validates a family-set daily/weekly cafeteria spend budget (F13).

    Both fields are optional; 0 disables that cap. Either may be sent alone so a
    parent can set just a daily or just a weekly limit.
    """
    daily_spend_limit = serializers.DecimalField(
        max_digits=8, decimal_places=2, required=False,
        min_value=Decimal('0.00'), max_value=Decimal('100000.00'))
    weekly_spend_limit = serializers.DecimalField(
        max_digits=8, decimal_places=2, required=False,
        min_value=Decimal('0.00'), max_value=Decimal('100000.00'))

    def validate(self, attrs):
        if 'daily_spend_limit' not in attrs and 'weekly_spend_limit' not in attrs:
            raise serializers.ValidationError(
                'Envíe daily_spend_limit y/o weekly_spend_limit.')
        return attrs


class AdjustmentInputSerializer(serializers.Serializer):
    """Validates a manual adjustment request (signed amount + reason)."""
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    reason = serializers.CharField(max_length=500)

    def validate_amount(self, value):
        if value == 0:
            raise serializers.ValidationError('El monto no puede ser cero.')
        return value


class RefundInputSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')
    # Reversing a card top-up only moves the wallet: staff confirm they already
    # refunded the charge in MultiCobros (Banorte). Required for real card payments.
    bank_refund_confirmed = serializers.BooleanField(required=False, default=False)
