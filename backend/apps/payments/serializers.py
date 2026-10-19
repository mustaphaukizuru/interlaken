from decimal import Decimal

from rest_framework import serializers

from .models import Payment


class PaymentSerializer(serializers.ModelSerializer):
    """A payment as the family (and the return page) sees it.

    ``failure_reason``/``failure_label`` say WHY a failed payment failed
    (cancelled, expired, declined...); ``bank_reference``/``auth_code`` are the
    Payworks referencia and número de autorización the parent's bank statement
    shows (``gateway_tx_id`` is only our número de control). Querysets should
    ``select_related('banorte')``.
    """
    student_id = serializers.IntegerField(source='related_topup.student_id', read_only=True, default=None)
    student_name = serializers.CharField(source='related_topup.student.user.full_name', read_only=True, default='')
    gateway_label = serializers.CharField(source='get_gateway_display', read_only=True)
    failure_reason = serializers.CharField(read_only=True)
    failure_label = serializers.CharField(read_only=True)
    bank_reference = serializers.SerializerMethodField()
    auth_code = serializers.SerializerMethodField()
    # The cafetería top-up this payment pays for: ``status`` ``paid`` means
    # received and waiting for its POS load, due at ``apply_due_at``.
    topup = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            'id', 'payment_type', 'amount', 'currency', 'description',
            'status', 'failure_reason', 'failure_label',
            'gateway', 'gateway_label', 'gateway_tx_id', 'gateway_ref',
            'bank_reference', 'auth_code',
            'student_id', 'student_name', 'topup', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_topup(self, obj):
        topup = obj.related_topup
        if topup is None:
            return None
        return {
            'id': topup.pk,
            'status': topup.status,
            'apply_due_at': topup.apply_due_at,
            'applied_at': topup.applied_at,
        }

    def get_bank_reference(self, obj):
        checkout = obj.banorte_checkout()
        return (checkout.referencia if checkout else '') or obj.gateway_ref or ''

    def get_auth_code(self, obj):
        checkout = obj.banorte_checkout()
        return checkout.codigo_aut if checkout else ''


class AdminPaymentSerializer(PaymentSerializer):
    """Staff ledger row: who paid, and the Banorte operation as MultiCobros shows it."""
    payer_name = serializers.CharField(source='user.full_name', read_only=True, default='')
    payer_email = serializers.CharField(source='user.email', read_only=True, default='')
    control_number = serializers.SerializerMethodField()
    mode = serializers.SerializerMethodField()
    simulation = serializers.SerializerMethodField()
    needs_verification = serializers.SerializerMethodField()

    class Meta(PaymentSerializer.Meta):
        fields = PaymentSerializer.Meta.fields + [
            'payer_name', 'payer_email', 'control_number', 'mode', 'simulation',
            'needs_verification',
        ]
        read_only_fields = fields

    def get_control_number(self, obj):
        checkout = obj.banorte_checkout()
        return checkout.control_number if checkout else ''

    def get_mode(self, obj):
        checkout = obj.banorte_checkout()
        return checkout.mode if checkout else ''

    def get_simulation(self, obj):
        return obj.is_simulation()

    def get_needs_verification(self, obj):
        return obj.needs_bank_verification()


# Bare initiate credits nothing on SUCCESS: cafeteria needs its linked top-up
# endpoint and ``other`` is a free-amount orphan path. Fail closed until a real
# linked fee type exists (the app only sells cafetería top-ups).
_BLOCKED_PAYMENT_TYPES = frozenset({'cafeteria', 'other'})

_TYPE_HELP = {
    'cafeteria': 'Use POST /cafeteria/topup/ para recargas de cafetería.',
    'other': 'Use la recarga de cafetería desde el portal familiar.',
}


class PaymentInitiateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('1.00'))
    payment_type = serializers.ChoiceField(choices=['cafeteria', 'other'])
    description = serializers.CharField(max_length=255, required=False, default='')

    def validate_payment_type(self, value):
        if value in _BLOCKED_PAYMENT_TYPES:
            raise serializers.ValidationError(
                f'No se puede iniciar un pago de tipo "{value}" sin vínculo. '
                f'{_TYPE_HELP[value]}'
            )
        return value
