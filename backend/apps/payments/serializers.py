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


# Bare initiate credits nothing on SUCCESS for any type today: tuition/cafeteria
# need their linked endpoints; enrollment has no Registration fee link yet; other
# is a free-amount orphan path. Fail closed until a real linked fee exists.
_BLOCKED_PAYMENT_TYPES = frozenset({'tuition', 'cafeteria', 'enrollment', 'other'})

_TYPE_HELP = {
    'tuition': 'Use POST /finance/invoices/<id>/pay/ para colegiatura.',
    'cafeteria': 'Use POST /cafeteria/topup/ para recargas de cafetería.',
    'enrollment': 'El pago de inscripción aún no está disponible por esta vía.',
    'other': 'Use colegiaturas o cafetería desde el portal familiar.',
}


class PaymentInitiateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('1.00'))
    payment_type = serializers.ChoiceField(choices=['tuition', 'enrollment', 'cafeteria', 'other'])
    description = serializers.CharField(max_length=255, required=False, default='')

    def validate_payment_type(self, value):
        if value in _BLOCKED_PAYMENT_TYPES:
            raise serializers.ValidationError(
                f'No se puede iniciar un pago de tipo "{value}" sin vínculo. '
                f'{_TYPE_HELP[value]}'
            )
        return value
