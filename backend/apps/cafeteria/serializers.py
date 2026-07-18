from rest_framework import serializers

from apps.accounts.serializers import StudentProfileSerializer

from .models import (BalanceAdjustment, CafeteriaBalance, CafeteriaTransaction,
                     LoyverseProfile, TopUpRequest)


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

    class Meta:
        model = CafeteriaBalance
        fields = ['id', 'student', 'balance', 'low_balance_threshold', 'last_synced', 'is_low_balance']


class CafeteriaTransactionSerializer(serializers.ModelSerializer):
    student_id = serializers.IntegerField(source='student.id', read_only=True)

    class Meta:
        model = CafeteriaTransaction
        fields = [
            'id', 'student_id', 'transaction_type', 'amount', 'description',
            'items', 'balance_after', 'date', 'loyverse_receipt_id',
        ]


class TopUpRequestSerializer(serializers.ModelSerializer):
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
