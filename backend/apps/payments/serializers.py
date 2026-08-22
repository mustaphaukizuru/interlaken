from decimal import Decimal

from rest_framework import serializers

from .models import Payment


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = [
            'id', 'payment_type', 'amount', 'currency', 'description',
            'status', 'gateway_tx_id', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'status', 'gateway_tx_id', 'created_at', 'updated_at']


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
