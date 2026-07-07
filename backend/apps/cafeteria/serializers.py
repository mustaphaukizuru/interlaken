from rest_framework import serializers

from apps.accounts.serializers import StudentProfileSerializer

from .models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest


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
