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


# Money types that must go through their linked endpoints (invoice pay / cafeteria
# top-up). An unlinked initiate would create a SUCCESS webhook with nothing to credit.
_LINKED_PAYMENT_TYPES = frozenset({'tuition', 'cafeteria'})

_LINKED_TYPE_HELP = {
    'tuition': 'Use POST /finance/invoices/<id>/pay/ para colegiatura.',
    'cafeteria': 'Use POST /cafeteria/topup/ para recargas de cafetería.',
}


class PaymentInitiateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('1.00'))
    payment_type = serializers.ChoiceField(choices=['tuition', 'enrollment', 'cafeteria', 'other'])
    description = serializers.CharField(max_length=255, required=False, default='')

    def validate_payment_type(self, value):
        if value in _LINKED_PAYMENT_TYPES:
            raise serializers.ValidationError(
                f'No se puede iniciar un pago de tipo "{value}" sin vínculo. '
                f'{_LINKED_TYPE_HELP[value]}'
            )
        return value
