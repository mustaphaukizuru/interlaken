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


class PaymentInitiateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('1.00'))
    payment_type = serializers.ChoiceField(choices=['tuition', 'enrollment', 'cafeteria', 'other'])
    description = serializers.CharField(max_length=255, required=False, default='')
