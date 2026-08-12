from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum
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


class CafeteriaBalanceSerializer(serializers.ModelSerializer):
    student = StudentProfileSerializer(read_only=True)
    is_low_balance = serializers.BooleanField(read_only=True)
    # Running spend for budget progress bars (F13). Two extra queries each, so
    # only computed for family views that pass ``include_spend`` in context —
    # admin balance lists (large N) keep them null and stay cheap.
    today_spend = serializers.SerializerMethodField()
    week_spend  = serializers.SerializerMethodField()

    class Meta:
        model = CafeteriaBalance
        fields = ['id', 'student', 'balance', 'low_balance_threshold', 'last_synced',
                  'is_low_balance', 'daily_spend_limit', 'weekly_spend_limit',
                  'today_spend', 'week_spend']

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
        now = timezone.localtime()
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return self._spend_since(obj, start)

    def get_week_spend(self, obj):
        if not self.context.get('include_spend'):
            return None
        now = timezone.localtime()
        start = (now.replace(hour=0, minute=0, second=0, microsecond=0)
                 - timedelta(days=now.weekday()))
        return self._spend_since(obj, start)


class CafeteriaTransactionSerializer(serializers.ModelSerializer):
    student_id = serializers.IntegerField(source='student.id', read_only=True)

    class Meta:
        model = CafeteriaTransaction
        fields = [
            'id', 'student_id', 'transaction_type', 'amount', 'description',
            'items', 'balance_after', 'date', 'loyverse_receipt_id',
        ]


class TopUpRequestSerializer(serializers.ModelSerializer):
    # The model DecimalField has no validators, so without this floor a parent
    # could POST amount=0 or a NEGATIVE value; a later admin "apply" would then
    # DEBIT the child's balance (add_points_to_customer(points<0)). Match the
    # payment-initiation floor and add a sane ceiling against fat-finger typos.
    # Match parent UI copy: mínimo $50 · máximo $2,000 (fat-finger guard).
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2,
        min_value=Decimal('50.00'), max_value=Decimal('2000.00'))

    class Meta:
        model = TopUpRequest
        fields = ['id', 'student', 'amount', 'method', 'status', 'created_at', 'processed_at']
        read_only_fields = ['status', 'created_at', 'processed_at']


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

    class Meta:
        model = TopUpRequest
        fields = [
            'id', 'student_id', 'student_name', 'student_code', 'amount',
            'method', 'method_display', 'status', 'status_display',
            'gateway', 'payment_status', 'gateway_tx_id',
            'created_at', 'processed_at',
        ]

    def _payment(self, obj):
        # ``payments`` is the reverse accessor of Payment.related_topup.
        if not hasattr(obj, '_cached_payment'):
            obj._cached_payment = obj.payments.order_by('-created_at').first()
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
